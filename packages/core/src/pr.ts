import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { SoberError } from './errors.js'
import { git, remoteName } from './git.js'
import type { Paths } from './paths.js'
import { readNode } from './records.js'
import { branchOf } from './worktree.js'

const run = promisify(execFile)

export interface PullRequest {
	readonly number: number
	readonly url: string
	/** A draft asks nobody to review anything — which is why it is the default (§6.1). */
	readonly draft: boolean
	readonly branch: string
}

/** CI, when there is any. "Unavailable" is not "passing", for the scan's reason (§6.2). */
export type Checks =
	| { readonly kind: 'none' }
	| { readonly kind: 'pending' }
	| { readonly kind: 'passing' }
	| { readonly kind: 'failing'; readonly failed: readonly string[] }
	| { readonly kind: 'unavailable'; readonly reason: string }

export type Published =
	| { readonly kind: 'opened'; readonly pr: PullRequest }
	| { readonly kind: 'updated'; readonly pr: PullRequest }
	/** Not a failure: with no remote or no `gh`, the flow is identical minus this step. */
	| { readonly kind: 'skipped'; readonly reason: string }

interface Ran {
	readonly ok: boolean
	readonly code: number
	readonly stdout: string
	readonly stderr: string
}

/**
 * The git host is talked to through its own CLI, as a subprocess — the same
 * shape as the agent host (§5.1). SOBER never asks for a token and never holds
 * one: `gh` is already installed and already logged in, or this step does not
 * happen. `SOBER_GH` names it for a `gh` that is not on the PATH, and is what
 * the tests point at a stand-in.
 *
 * It never throws. `gh pr checks` exits 8 while checks are pending and 1 when
 * one failed, so a non-zero exit here is an answer, not an error.
 */
const gh = async (cwd: string, ...args: string[]): Promise<Ran> => {
	const [command, ...prefix] = (process.env.SOBER_GH ?? 'gh').split(' ')
	try {
		const { stdout, stderr } = await run(command as string, [...prefix, ...args], {
			cwd,
			encoding: 'utf8',
			maxBuffer: 8 * 1024 * 1024,
		})
		return { ok: true, code: 0, stdout, stderr }
	} catch (error) {
		const failure = error as { code?: number; stdout?: string; stderr?: string; message?: string }
		return {
			ok: false,
			code: typeof failure.code === 'number' ? failure.code : 1,
			stdout: failure.stdout ?? '',
			stderr: failure.stderr ?? failure.message ?? '',
		}
	}
}

const firstLine = (text: string): string => text.trim().split('\n')[0] ?? 'no output'

/** Whether the git host can be reached at all, and what to say when it cannot. */
const reachable = async (root: string): Promise<string | null> => {
	const version = await gh(root, '--version')
	return version.ok ? null : firstLine(version.stderr)
}

export const pullRequestOf = async (paths: Paths, node: string): Promise<PullRequest | null> => {
	// No remote, no pull request — and no subprocess to find that out with. Every
	// review of a repository with no remote would otherwise spawn `gh` to be
	// told what the repository already knows.
	if ((await remoteName(paths.root)) === null) return null

	const branch = branchOf(node)
	const found = await gh(paths.root, 'pr', 'view', branch, '--json', 'number,url,isDraft,state')
	if (!found.ok) return null
	try {
		const raw = JSON.parse(found.stdout) as { number: number; url: string; isDraft: boolean }
		return { number: raw.number, url: raw.url, draft: raw.isDraft, branch }
	} catch {
		return null
	}
}

/**
 * When a run finishes, its branch is pushed and the node's draft pull request is
 * opened — one per node, never one per attempt (§5.0, D32). A pull request that
 * is already open needs nothing: the push is what updates it, and CI runs on the
 * push.
 *
 * Opening one pushes agent output to a remote, so it happens only when the
 * project asked for it (`dispatch.draftPr`) and never silently.
 */
export const publish = async (paths: Paths, node: string, base: string): Promise<Published> => {
	const remote = await remoteName(paths.root)
	if (remote === null) return { kind: 'skipped', reason: 'this repository has no remote' }

	const branch = branchOf(node)
	// A branch that holds no commit past its base has no diff, so there is
	// nothing for CI to run and nothing for anyone to review — and `gh` refuses
	// it anyway. Found by driving the demo: the agent wrote files and committed
	// none, which is the M1 gate's finding wearing a pull request.
	const commits = await git(paths.root, 'rev-list', '--count', `${base}..${branch}`)
	if (commits.trim() === '0')
		return { kind: 'skipped', reason: 'the branch has nothing committed on it yet' }

	const unreachable = await reachable(paths.root)
	if (unreachable !== null) return { kind: 'skipped', reason: unreachable }
	// `--force-with-lease`, because "start clean" rewrites the branch (§6.4) and
	// a plain push would refuse it — while a bare `--force` would overwrite work
	// somebody else put on the same branch.
	try {
		await git(paths.root, 'push', '--force-with-lease', '-u', remote, branch)
	} catch (error) {
		return { kind: 'skipped', reason: firstLine((error as Error).message) }
	}

	const existing = await pullRequestOf(paths, node)
	if (existing !== null) return { kind: 'updated', pr: existing }

	const record = await readNode(paths, node)
	const title = record.kind === 'ok' ? record.value.title : node
	const created = await gh(
		paths.root,
		'pr',
		'create',
		'--draft',
		'--head',
		branch,
		'--base',
		base,
		'--title',
		title,
		'--body',
		body(node, record.kind === 'ok' ? record.value.outcome : null),
	)
	if (!created.ok) return { kind: 'skipped', reason: firstLine(created.stderr) }

	const opened = await pullRequestOf(paths, node)
	return opened === null
		? { kind: 'skipped', reason: 'the pull request was opened but could not be read back' }
		: { kind: 'opened', pr: opened }
}

/** The review stays in SOBER (§6.1), and the pull request says so rather than inviting one. */
const body = (node: string, outcome: string | null): string =>
	`${outcome ?? 'Opened by SOBER when the run finished.'}\n\nThis is a draft: it exists so CI runs before a human looks. Review happens in SOBER — \`sober review ${node}\`.`

export const checksOf = async (paths: Paths, node: string): Promise<Checks> => {
	if ((await remoteName(paths.root)) === null) return { kind: 'none' }

	const unreachable = await reachable(paths.root)
	if (unreachable !== null) return { kind: 'unavailable', reason: unreachable }
	if ((await pullRequestOf(paths, node)) === null) return { kind: 'none' }

	const result = await gh(paths.root, 'pr', 'checks', branchOf(node), '--json', 'name,state,bucket')
	if (result.stdout.trim() === '') return { kind: 'none' }

	let checks: { name: string; bucket: string }[]
	try {
		checks = JSON.parse(result.stdout) as { name: string; bucket: string }[]
	} catch {
		return { kind: 'unavailable', reason: firstLine(result.stderr) }
	}
	if (checks.length === 0) return { kind: 'none' }

	const failed = checks.filter((check) => check.bucket === 'fail').map((check) => check.name)
	if (failed.length > 0) return { kind: 'failing', failed }
	return checks.some((check) => check.bucket === 'pending')
		? { kind: 'pending' }
		: { kind: 'passing' }
}

/** Accept's other landing (D33): mark the draft ready, and let the host merge it. */
export const readyAndMerge = async (paths: Paths, node: string): Promise<PullRequest> => {
	const pr = await pullRequestOf(paths, node)
	if (pr === null)
		throw new SoberError(
			'merge-refused',
			`${node} has no pull request to merge — this project accepts through one (dispatch.accept), so open it with a run, or set dispatch.accept to "merge"`,
		)

	const branch = branchOf(node)
	if (pr.draft) {
		const ready = await gh(paths.root, 'pr', 'ready', branch)
		if (!ready.ok) throw new SoberError('merge-refused', firstLine(ready.stderr))
	}
	const merged = await gh(paths.root, 'pr', 'merge', branch, '--merge')
	if (!merged.ok) throw new SoberError('merge-refused', firstLine(merged.stderr))
	return pr
}
