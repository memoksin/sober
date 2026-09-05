import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { SoberError } from './errors.js'

const run = promisify(execFile)

export class GitError extends SoberError {
	constructor(
		readonly args: readonly string[],
		readonly stderr: string,
	) {
		super('git', `git ${args.join(' ')} failed: ${stderr.trim().split('\n')[0] ?? 'no output'}`)
	}
}

/**
 * Every git call in SOBER goes through here: `execFile`, never a shell, so a
 * branch name or a path carrying a space or a semicolon is an argument and
 * never a second command.
 */
export const git = (cwd: string, ...args: string[]): Promise<string> => gitWithEnv(cwd, {}, args)

/**
 * The same call with extra environment. Only `GIT_INDEX_FILE` needs it today —
 * writing a tree with no working copy — and an env-based variant beats a second
 * `execFile` site that forgets the no-shell rule.
 */
export const gitWithEnv = async (
	cwd: string,
	env: Readonly<Record<string, string>>,
	args: readonly string[],
): Promise<string> => (await exec(cwd, env, args)).trimEnd()

/**
 * The same call, untrimmed. A blob's bytes are its bytes: records end in a
 * newline, and a sync that trimmed one would write back a file that no longer
 * matches the object it came from — every later sync would see a change that
 * nobody made.
 */
export const gitVerbatim = (cwd: string, ...args: string[]): Promise<string> => exec(cwd, {}, args)

const exec = async (
	cwd: string,
	env: Readonly<Record<string, string>>,
	args: readonly string[],
): Promise<string> => {
	try {
		const { stdout } = await run('git', [...args], {
			cwd,
			encoding: 'utf8',
			maxBuffer: 32 * 1024 * 1024,
			env: { ...process.env, ...env },
		})
		return stdout
	} catch (error) {
		throw new GitError(args, (error as { stderr?: string }).stderr ?? String(error))
	}
}

/**
 * Whoever git says is committing here. SOBER never asks for a second identity,
 * and every surface attributes with the same name — which is why this lives
 * beside the other git calls rather than in whichever surface asked first.
 */
export const whoami = async (root: string): Promise<string> => {
	const name = await git(root, 'config', 'user.name').catch(() => '')
	return name.trim() === '' ? 'unknown' : name.trim()
}

export const isRepo = async (dir: string): Promise<boolean> => {
	try {
		return (await git(dir, 'rev-parse', '--is-inside-work-tree')) === 'true'
	} catch {
		return false
	}
}

export const currentBranch = (dir: string): Promise<string> =>
	git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')

/**
 * The remote the board travels through. SOBER does not ask which one: a
 * repository with a second remote is rarer than a repository whose remote is
 * not called `origin`, and hardcoding the name would fail the second case
 * silently.
 */
export const remoteName = async (dir: string): Promise<string | null> => {
	const first = (await git(dir, 'remote')).split('\n')[0]?.trim()
	return first === undefined || first === '' ? null : first
}

export const hasRemote = async (dir: string): Promise<boolean> => (await remoteName(dir)) !== null

/** True when `maybe` is already contained in `of` — the question a pull asks. */
export const isAncestor = async (dir: string, maybe: string, of: string): Promise<boolean> => {
	try {
		await git(dir, 'merge-base', '--is-ancestor', maybe, of)
		return true
	} catch {
		return false
	}
}

export const refExists = async (dir: string, ref: string): Promise<boolean> => {
	try {
		await git(dir, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`)
		return true
	} catch {
		return false
	}
}

/** Uncommitted or untracked: what a worktree removal asks, because both are work. */
export const isDirty = async (dir: string): Promise<boolean> =>
	(await git(dir, 'status', '--porcelain')).length > 0

/**
 * Tracked changes only — the question a merge asks. Untracked files are not at
 * risk from a merge and git does not refuse one for them.
 *
 * Found in the M1 gate: `sober init` writes `.gitignore` and `.sober/` and does
 * not commit them, so the very first accept was refused by SOBER's own files,
 * on a repository where nothing was wrong.
 */
export const hasUncommitted = async (dir: string): Promise<boolean> =>
	(await git(dir, 'status', '--porcelain', '--untracked-files=no')).length > 0

/**
 * Configuration that governs a run or a review is read from the base ref, never
 * from the branch under review (ADR 0019). An agent that relaxes the scan or
 * rewrites `dispatch.setup` in its own branch does not change what is applied to
 * its own branch — the edit is a diff line a human reads first.
 *
 * A base that carries no such file returns null, and the caller falls back to
 * the bundled default.
 */
export const showFromRef = async (
	dir: string,
	ref: string,
	path: string,
): Promise<string | null> => {
	try {
		return await git(dir, 'show', `${ref}:${path}`)
	} catch {
		return null
	}
}

/** The repository root, so every other call can be given one place to stand. */
export const repoRoot = async (dir: string): Promise<string> => {
	const top = await git(dir, 'rev-parse', '--show-toplevel')
	return join(top)
}
