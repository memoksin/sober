import { join } from 'node:path'
import type {
	AuditResult,
	AutoProvenance,
	CommandResult,
	Criterion,
	CriterionResult,
	Handle,
	PullRequest,
	Review,
	ScanResult,
} from '@besober/schema'
import { judge } from './audit.js'
import { DEFAULT_CONFIG, readConfig } from './config.js'
import { NotOnBoardError } from './errors.js'
import { git, hasUncommitted, isAncestor, refExists } from './git.js'
import { type Board, loadBoard } from './graph.js'
import { appendEvent, type Feedback, writeFeedback } from './local.js'
import { withLock } from './lock.js'
import { deleteBranch, type Merged, MergeRefusedError, mergeNode, unmergeNode } from './merge.js'
import type { Paths } from './paths.js'
import { checksOf, pullRequestOf, readyAndMerge } from './pr.js'
import { readNode, writeNode } from './records.js'
import { acceptNode } from './run.js'
import { scanNode } from './scan.js'
import { flagsOf, lastRun, statusOf } from './status.js'
import { branchOf, removeWorktree, resetToBase, worktreeOf } from './worktree.js'

export const reviewNode = async (
	paths: Paths,
	node: string,
	base: string,
): Promise<Review | null> => {
	const board = await loadBoard(paths)
	const record = board.nodes.get(node)
	if (record === undefined) return null

	// A node nobody has run has no branch, and `git diff` against a ref that is
	// not there is a fatal error rather than an empty diff. Nothing has run, so
	// there is nothing to review — which `exit` already says (§8.7: no message
	// here is a stack trace).
	const started = await refExists(paths.root, branchOf(node))
	const diff = started ? await git(paths.root, 'diff', `${base}...${branchOf(node)}`) : ''
	const scan = started
		? await scanNode(paths, node, { base, diff: await unified0(paths, base, node) })
		: await scanNode(paths, node, { base, diff: '' })
	const run = lastRun(board, node)

	return {
		node,
		scan,
		diff,
		files: scan.files,
		run: run?.id ?? null,
		exit: run?.run.exit ?? null,
		// The criterion and what running it did, side by side (ADR 0049). Joined
		// here rather than by each surface: the browser cannot import `core`, and
		// three copies of an index join are three chances to read a `null` result
		// as a pass.
		acceptance: criterionResults(record.brief?.acceptance ?? [], run?.run.acceptance ?? []),
		verify: run?.run.verify ?? null,
		ci: await checksOf(paths, node),
		pr: await pullRequestOf(paths, node),
		uncommitted: await uncommittedIn(paths, node),
		accepted: record.accepted,
		// §2.8: the flag renders above the diff, beside the findings. Read here
		// rather than by each surface, so the browser — which cannot import
		// `core` — is looking at the same derivation as the terminal.
		flagged: flagsOf(board, node).flagged,
	}
}

const criterionResults = (
	criteria: readonly Criterion[],
	results: readonly (CommandResult | null)[],
): readonly CriterionResult[] =>
	// `?? null` and never `?? { exit: 0 }`: a list longer than its results is a
	// run that ended before it got there, and the two are told apart nowhere
	// else.
	criteria.map((criterion, at) => ({ ...criterion, result: results[at] ?? null }))

/**
 * How the acceptance list reads right now, in the one word the `accepted` record
 * keeps (ADR 0049). A node with no criteria is `none`; one criterion nobody
 * could run makes the whole audit `did-not-run`, because a list is only as read
 * as its least-read entry.
 */
export const auditOf = async (paths: Paths, node: string): Promise<AuditResult> => {
	const board = await loadBoard(paths)
	const run = lastRun(board, node)
	return auditResultOf(
		criterionResults(board.nodes.get(node)?.brief?.acceptance ?? [], run?.run.acceptance ?? []),
	)
}

export const auditResultOf = (criteria: readonly CriterionResult[]): AuditResult => {
	if (criteria.length === 0) return 'none'
	if (criteria.some((criterion) => criterion.result === null)) return 'did-not-run'
	return criteria.every((criterion) => criterion.result?.exit === 0) ? 'passed' : 'failed'
}

const uncommittedIn = async (paths: Paths, node: string): Promise<string[]> => {
	const path = worktreeOf(paths, node)
	// `--untracked-files=all`, because the default collapses a new directory to
	// `src/` and the human needs the file names to know what is missing.
	return (await git(path, 'status', '--porcelain', '--untracked-files=all').catch(() => ''))
		.split('\n')
		.map((line) => line.slice(3).trim())
		.filter((file) => file !== '')
}

const unified0 = (paths: Paths, base: string, node: string): Promise<string> =>
	git(paths.root, 'diff', '--unified=0', `${base}...sober/${node}`)

export interface AcceptOptions {
	readonly by: Handle
	readonly base: string
	readonly scan: ScanResult
	readonly flagged?: boolean
	/** Set only by `sober:auto` (ADR 0065 §6); no attended surface passes it. */
	readonly autonomous?: AutoProvenance
	/**
	 * Awaited before the merge and again under the lock that writes the record:
	 * a refusal in between takes the merge back like any failed record write.
	 */
	readonly guard?: () => Promise<void>
}

/**
 * Accepting lands the work (§6.3): the branch is merged and the `accepted`
 * record written — which is what makes the node `done`, with no boolean to
 * forget — then the worktree removed.
 *
 * A local merge comes **first**. It is the step that refuses — a conflict, a
 * dirty checkout, the wrong branch — and a record written before it left a
 * `done` node over a base that never took the work. A record that fails after
 * the merge takes the merge back, so either both land or neither does.
 *
 * A pull request is the other way round: the record goes first, because the
 * merge happens on the host and cannot be taken back from here.
 */
export type Landed =
	| ({ readonly kind: 'merged' } & Merged & {
				/**
				 * The draft this run opened, still open on the host. A local merge
				 * does not touch it: the host only notices when the base is pushed,
				 * and pushing the base is the human's (ADR 0026). Carried out so the
				 * surfaces can say so — the M2 gate left three drafts open on
				 * branches whose work was already merged, and nothing said why.
				 */
				readonly openPr: PullRequest | null
			})
	| { readonly kind: 'pull-request'; readonly pr: PullRequest; readonly base: string }

export const acceptWork = async (
	paths: Paths,
	node: string,
	options: AcceptOptions,
): Promise<Landed> =>
	withLock({ ...paths, lock: join(paths.local, 'accept.lock') }, 'merge acceptance', () =>
		acceptOne(paths, node, options),
	)

const acceptOne = async (paths: Paths, node: string, options: AcceptOptions): Promise<Landed> => {
	// Nothing to land is not something to accept. Found in the M1 gate: an agent
	// wrote its files and never committed them, the branch held no commit past
	// the base, and `git merge` on an ancestor succeeds by doing nothing — so
	// the node read `done` with an empty `main` behind it.
	//
	// This runs before the record is written, because the record is what makes
	// the node done: the safe order below only helps when there is a merge to
	// retry.
	//
	// The branch first, because `rev-list` on one that is not there is a git
	// error about an ambiguous argument, and §8.7 asks for a sentence. It is
	// reachable: accept deletes the branch, and a merge can put `accepted` back
	// to null on a clone where the branch is already gone.
	if (!(await refExists(paths.root, branchOf(node))))
		throw new MergeRefusedError(
			`${node} has no branch to merge — ${branchOf(node)} is not in this repository, so there is nothing here to land`,
		)
	const commits = await git(paths.root, 'rev-list', '--count', `${options.base}..${branchOf(node)}`)
	if (commits.trim() === '0') {
		const waiting = await uncommittedIn(paths, node)
		throw new MergeRefusedError(
			waiting.length > 0
				? `${node} has nothing committed to merge, and ${waiting.length} file(s) are sitting uncommitted in its worktree: ${waiting.join(', ')} — accepting now would land nothing and record it as done`
				: `${node} has nothing to merge: its branch holds no commit that ${options.base} does not`,
		)
	}

	// Which landing (D33) is the project's, not the run's: a protected main
	// cannot take a local merge, and a repository with no remote cannot take a
	// pull request. It governs neither how a run is prepared nor how it is
	// judged, so it is read normally rather than from the base (§5.2).
	const config = await readConfig(paths)
	const settings = config.kind === 'ok' ? config.value.dispatch : DEFAULT_CONFIG.dispatch
	const through = settings.accept

	const accepted = {
		by: options.by,
		at: new Date().toISOString(),
		flagged: options.flagged ?? false,
		// Recorded as it was at the moment a human accepted, including "the scan
		// did not run" — `PR-09-06` exists so that case cannot be dropped.
		scan: options.scan,
		// Derived here rather than passed in like `scan`: three surfaces accept,
		// and a field each of them has to remember to fill is a field that ends
		// up saying "passed" on the one that forgot.
		audit: await auditOf(paths, node),
		...(options.autonomous && { autonomous: options.autonomous }),
	}
	await options.guard?.()

	if (through === 'pull-request') {
		if (settings.waveVerify !== null)
			throw new MergeRefusedError(
				'dispatch.waveVerify requires local merge acceptance; a pull-request landing needs its full CI gate',
			)
		// The pull request has to be there before the record is written: a done
		// node whose work never landed is the one state this order prevents.
		await requirePullRequest(paths, node)
		await acceptNode(paths, node, accepted, options.guard)
		const pr = await readyAndMerge(paths, node)
		await removeWorktree(paths, node)
		// The merge happened on the host, so this branch is not an ancestor of
		// anything here — `-d` would refuse work that is already landed.
		await deleteBranch(paths, node, { force: true })
		return { kind: 'pull-request', pr, base: options.base }
	}

	// Read before the branch goes: the pull request is found by its branch.
	const openPr = await pullRequestOf(paths, node).catch(() => null)
	const merged = await mergeNode(paths, node, options.base)
	const verify = settings.waveVerify ?? settings.verify
	if (verify !== null) await verifyMerged(paths, merged, verify, settings.waveVerify !== null)
	try {
		await acceptNode(paths, node, accepted, options.guard)
	} catch (error) {
		if (await unmergeNode(paths, merged).catch(() => false)) throw error
		const reason = error instanceof Error ? error.message : String(error)
		throw new MergeRefusedError(
			`${merged.branch} was merged into ${merged.base} as ${merged.commit}, but the acceptance could not be recorded (${reason}), and the checkout is no longer exactly at that merge, so it was not taken back. The node is not done: undo the merge by hand (\`git reset --keep ${merged.commit}^1\` once nothing is on top of it), then accept again — the branch and worktree are kept`,
		)
	}
	// Nothing removes a dirty worktree (§8.2), so this can refuse — and it
	// refuses after the work is safely merged, which is the harmless order.
	await removeWorktree(paths, node)
	await deleteBranch(paths, node)
	return { kind: 'merged', ...merged, openPr }
}

/**
 * A run is verified alone, on its own branch. Three nodes accepted one after
 * another were each green that way, and together broke the base — shared route
 * lists, one entry file's imports, snapshots — because nothing ever ran on the
 * combination. So the merged tree is verified before the record is written.
 *
 * Only when the base moved since the branch was cut: otherwise the merge holds
 * exactly the tree the run's own verify already judged.
 */
const verifyMerged = async (
	paths: Paths,
	merged: Merged,
	verify: string,
	force = false,
): Promise<void> => {
	if (!force && (await isAncestor(paths.root, `${merged.commit}^1`, merged.branch))) return
	const judged = await judge(paths.root, verify)
	if (judged.result === null && !force) return
	if (judged.result?.exit === 0) return

	const output = judged.output.trimEnd().split('\n').slice(-40).join('\n')
	const fix = `merge ${merged.base} into ${merged.branch} and fix it there, or reject the node`
	if (await unmergeNode(paths, merged))
		throw new MergeRefusedError(
			`${merged.branch} merged with the current ${merged.base} fails dispatch.verify (\`${verify}\`), so ${merged.base} was put back where it was — ${fix}:\n${output}`,
		)
	throw new MergeRefusedError(
		`${merged.branch} merged with the current ${merged.base} fails dispatch.verify (\`${verify}\`), and the checkout changed while it ran, so the merge (${merged.commit}) was not taken back: undo it by hand (\`git reset --keep ${merged.commit}^1\`), then ${fix}:\n${output}`,
	)
}

/** Merge at most four reviewed nodes, verify their combined tree once, then mark them done. */
export const acceptWave = async (
	paths: Paths,
	nodes: readonly string[],
	options: Pick<AcceptOptions, 'by' | 'base'>,
): Promise<readonly Landed[]> =>
	withLock({ ...paths, lock: join(paths.local, 'accept.lock') }, 'wave acceptance', () =>
		landWave(paths, nodes, options),
	)

const landWave = async (
	paths: Paths,
	nodes: readonly string[],
	options: Pick<AcceptOptions, 'by' | 'base'>,
): Promise<readonly Landed[]> => {
	if (nodes.length === 0 || nodes.length > 4 || new Set(nodes).size !== nodes.length)
		throw new MergeRefusedError('a wave needs one to four distinct nodes')
	const config = await readConfig(paths)
	const settings = config.kind === 'ok' ? config.value.dispatch : DEFAULT_CONFIG.dispatch
	if (settings.accept !== 'merge')
		throw new MergeRefusedError('wave acceptance requires dispatch.accept = "merge"')
	const verify = settings.waveVerify
	if (verify === null)
		throw new MergeRefusedError('configure dispatch.waveVerify before accepting a wave')
	const board = await loadBoard(paths)
	const reviews: Review[] = []
	const branches = new Map<string, string>()
	for (const node of nodes) {
		const found = await reviewNode(paths, node, options.base)
		const run = lastRun(board, node)?.run
		if (
			found === null ||
			statusOf(board, node) !== 'in-review' ||
			found.flagged ||
			found.accepted !== null ||
			run?.exit !== 'finished' ||
			run.verify?.exit !== 0 ||
			found.scan.result !== 'clean' ||
			found.uncommitted.length > 0 ||
			found.acceptance.length === 0 ||
			found.acceptance.some((criterion) => criterion.result?.exit !== 0)
		)
			throw new MergeRefusedError(`${node} has not passed its node checks and clean review`)
		if (found.ci.kind !== 'none' && found.ci.kind !== 'passing')
			throw new MergeRefusedError(`${node} CI is ${found.ci.kind}`)
		reviews.push(found)
		branches.set(node, await git(paths.root, 'rev-parse', branchOf(node)))
		if (
			(
				await git(paths.root, 'rev-list', '--count', `${options.base}..${branchOf(node)}`)
			).trim() === '0'
		)
			throw new MergeRefusedError(`${node} has no new commits to merge`)
	}
	const before = await git(paths.root, 'rev-parse', 'HEAD')
	const merged: Merged[] = []
	let recordsWritten = false
	try {
		for (const node of nodes) {
			if (
				(
					await git(paths.root, 'rev-list', '--count', `${options.base}..${branchOf(node)}`)
				).trim() === '0'
			)
				throw new MergeRefusedError(`${node} has no new commits after the preceding wave merges`)
			merged.push(await mergeNode(paths, node, options.base))
		}
		const head = merged.at(-1)?.commit
		const changed = await git(paths.root, 'diff', '--name-only', before, 'HEAD')
		if (
			settings.setup !== null &&
			changed
				.split('\n')
				.some((file) => /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/.test(file))
		) {
			const setup = await judge(paths.root, settings.setup)
			if (setup.result?.exit !== 0)
				throw new MergeRefusedError(`wave setup failed:\n${setup.output}`)
		}
		const judged = await judge(paths.root, verify)
		if (judged.result?.exit !== 0)
			throw new MergeRefusedError(
				`wave verification failed; no node was accepted:\n${judged.output.trimEnd().split('\n').slice(-40).join('\n')}`,
			)
		await withLock(paths, 'accept wave', async () => {
			if (
				(await git(paths.root, 'rev-parse', 'HEAD')) !== head ||
				(await hasUncommitted(paths.root))
			)
				throw new MergeRefusedError(
					'the checkout moved during wave verification; no node was accepted',
				)
			const current = await loadBoard(paths)
			for (const found of reviews) {
				if (statusOf(current, found.node) !== 'in-review' || flagsOf(current, found.node).flagged)
					throw new MergeRefusedError(`${found.node} left review during wave verification`)
				const record = await readNode(paths, found.node)
				if (
					record.kind !== 'ok' ||
					JSON.stringify(record.value) !== JSON.stringify(board.nodes.get(found.node))
				)
					throw new MergeRefusedError(`${found.node} changed during wave verification`)
				if (
					(await git(paths.root, 'rev-parse', branchOf(found.node))) !== branches.get(found.node) ||
					JSON.stringify(lastRun(current, found.node)) !==
						JSON.stringify(lastRun(board, found.node))
				)
					throw new MergeRefusedError(
						`${found.node} branch or run changed during wave verification`,
					)
			}
			const written: string[] = []
			try {
				for (const found of reviews) {
					const record = board.nodes.get(found.node)
					if (!record) throw new MergeRefusedError(`${found.node} disappeared`)
					await writeNode(paths, found.node, {
						...record,
						accepted: {
							by: options.by,
							at: new Date().toISOString(),
							flagged: false,
							scan: found.scan.result,
							audit: auditResultOf(found.acceptance),
						},
					})
					written.push(found.node)
					recordsWritten = true
				}
				await appendEvent(paths, { action: 'wave.accepted', nodes, by: options.by, commit: head })
			} catch (error) {
				for (const node of written) {
					const original = board.nodes.get(node)
					if (original) await writeNode(paths, node, original)
				}
				recordsWritten = false
				throw error
			}
		})
	} catch (error) {
		if (recordsWritten)
			throw new MergeRefusedError(
				`wave records could not be restored; its merges were kept for manual recovery: ${String(error)}`,
			)
		for (const merge of [...merged].reverse()) {
			if (!(await unmergeNode(paths, merge)))
				throw new MergeRefusedError(
					`wave failed and the checkout changed; its merges were kept for manual recovery: ${String(error)}`,
				)
		}
		throw error
	}
	const landed: Landed[] = []
	for (const [index, node] of nodes.entries()) {
		await removeWorktree(paths, node)
		await deleteBranch(paths, node)
		const merge = merged[index]
		if (!merge) throw new MergeRefusedError(`${node} has no wave merge`)
		landed.push({ kind: 'merged', ...merge, openPr: reviews[index]?.pr ?? null })
	}
	return landed
}

/** Refusing here beats writing an `accepted` record for work that cannot land. */
const requirePullRequest = async (paths: Paths, node: string): Promise<void> => {
	if ((await pullRequestOf(paths, node)) === null)
		throw new MergeRefusedError(
			`${node} has no pull request to merge — this project accepts through one (dispatch.accept), so let a run open it, or set dispatch.accept to "merge"`,
		)
}

export interface RejectOptions {
	readonly by: Handle
	readonly text: string
	/** The rejection surface's "start clean": the branch goes back to its base (§5.0). */
	readonly clean?: boolean
	readonly base?: string
}

/**
 * Rejecting is correcting, not discarding (§6.4). Nothing is deleted: the
 * branch, the worktree and the draft pull request all stay as they are, and the
 * next run carries this text alongside the brief.
 */
export const rejectWork = async (
	paths: Paths,
	node: string,
	options: RejectOptions,
): Promise<Feedback> => {
	// The CLI never reached this without a node, because `widen` refuses an
	// unknown id before the command runs. The wire does, and wrote a feedback
	// record for a node that does not exist — local state describing nothing.
	// The guard belongs here rather than in each surface: found by the server's
	// route in phase 5.
	if ((await readNode(paths, node)).kind !== 'ok') throw new NotOnBoardError('node', node)

	const feedback: Feedback = {
		at: new Date().toISOString(),
		by: options.by,
		text: options.text,
		clean: options.clean ?? false,
	}
	await writeFeedback(paths, node, feedback)
	if (options.clean === true && options.base !== undefined)
		await resetToBase(paths, node, options.base)
	await appendEvent(paths, { action: 'node.rejected', node, by: options.by })
	return feedback
}

export interface Green {
	/** Every node in review whose checks are all clean, in id order. */
	readonly green: readonly string[]
	readonly held: readonly { readonly id: string; readonly why: string }[]
}

/**
 * Green is checks, not reading (ADR 0022): verification passed, every
 * acceptance command exited 0, the scan is clean, and CI is green (§6.0). Green
 * nodes are accepted together; a node that is not green takes the single-node
 * path, where a human reads what is wrong with it.
 *
 * "Did not run" is never "passed" — for the scan (`PR-09-06`), for an
 * acceptance command (ADR 0021), and for a git host that could not be reached.
 * A check nobody configured is a different thing from a check that failed to
 * answer, and only the first one is silence worth ignoring.
 */
export const greenNodes = async (paths: Paths, base: string): Promise<Green> => {
	const board = await loadBoard(paths)
	const config = await readConfig(paths)
	const wave = config.kind === 'ok' && config.value.dispatch.waveVerify !== null
	const green: string[] = []
	const held: { id: string; why: string }[] = []

	for (const id of [...board.nodes.keys()].sort()) {
		if (statusOf(board, id) !== 'in-review') continue
		const why = await notGreen(paths, board, id, base, wave)
		if (why === null) green.push(id)
		else held.push({ id, why })
	}
	return { green, held }
}

const notGreen = async (
	paths: Paths,
	board: Board,
	id: string,
	base: string,
	wave = false,
): Promise<string | null> => {
	const run = lastRun(board, id)?.run
	if (run === undefined || run.exit !== 'finished') return 'its last run did not finish'
	if (wave && run.verify?.exit !== 0) return 'node verification has not passed'
	if (run.verify !== null && run.verify.exit !== 0) return 'verification failed'

	const criteria = board.nodes.get(id)?.brief?.acceptance ?? []
	if (wave && criteria.length === 0) return 'it has no acceptance criteria'
	for (const [at, criterion] of criteria.entries()) {
		const result = run.acceptance[at]
		if (result === undefined || result === null) return `\`${criterion.run}\` did not run`
		if (result.exit !== 0) return `\`${criterion.run}\` failed`
	}

	const found = await reviewNode(paths, id, base)
	if (found === null) return 'it is not on this board'
	if (wave && found.flagged) return 'its decision flag needs individual review'
	if (wave && found.diff === '') return 'its branch has no new changes to merge'
	if (found.scan.result !== 'clean')
		return found.scan.result === 'did-not-run' ? 'the scan did not run' : 'the scan has findings'
	if (found.uncommitted.length > 0) return 'its worktree holds work nobody committed'

	if (found.ci.kind === 'failing') return `CI failed: ${found.ci.failed.join(', ')}`
	if (found.ci.kind === 'pending') return 'CI has not finished'
	if (found.ci.kind === 'unavailable') return 'CI could not be read'
	return null
}
