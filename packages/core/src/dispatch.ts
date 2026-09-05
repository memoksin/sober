import { execFile } from 'node:child_process'
import type { CommandResult, RunExit } from '@besober/schema'
import { renderBrief } from './brief.js'
import { type Config, readConfig, readConfigFromBase } from './config.js'
import { NotOnBoardError, SoberError } from './errors.js'
import { loadBoard } from './graph.js'
import { checkHost, HostError, startAgent } from './host.js'
import {
	appendEvent,
	appendRunOutput,
	clearRunPid,
	clearStopped,
	markStopped,
	readRunPid,
	wasStopped,
	writeRunPid,
} from './local.js'
import type { Paths } from './paths.js'
import { type Published, publish } from './pr.js'
import { readNode, readNodes } from './records.js'
import { finishRun, startRun } from './run.js'
import { OverlapError, overlaps } from './team.js'
import { addWorktree } from './worktree.js'

/**
 * Dispatch (DESIGN §5): the node's worktree, the host launched headless in it,
 * its output streamed to the run log, and one run record saying how it exited.
 *
 * Everything that governs the run — the host, the setup command, the timeout —
 * is read from the base ref (ADR 0019). A run must not be able to raise its own
 * spending limit or rewrite what SOBER runs next time.
 */
export class SetupFailedError extends SoberError {
	constructor(
		readonly node: string,
		readonly command: string,
		readonly output: string,
	) {
		super(
			'setup-failed',
			`${node}: the setup command failed, so the agent was never started — \`${command}\`\n${output.trim()}`,
		)
	}
}

export interface DispatchOptions {
	/** The ref the node's branch is cut from, and the ref its settings are read from. */
	readonly base: string
	/**
	 * What the host is asked to do. Left out, it is built here: the rendered
	 * brief, with the last rejection's feedback above it. Building it in one
	 * place is what keeps a run started from a session identical to one started
	 * from the CLI (`PR-09-08`).
	 */
	readonly prompt?: string
	/** Called for every line the host writes, for a live tail (`PR-05-09`). */
	readonly onLine?: (line: string) => void
	/** The human saw the same-files warning and said go (§3.4). Never set by the queue. */
	readonly anyway?: boolean
	/** Nodes going out in the same command: unclaimed, and active all the same. */
	readonly alsoStarting?: readonly string[]
}

export interface Dispatched {
	readonly run: string
	readonly exit: RunExit
	readonly error: string | null
	readonly worktree: string
	/** False when the worktree was already there — setup runs once per node (§5.2). */
	readonly prepared: boolean
	/** What happened with the node's pull request, or null when nobody asked for one. */
	readonly pr: Published | null
}

export const dispatch = async (
	paths: Paths,
	node: string,
	options: DispatchOptions,
): Promise<Dispatched> => {
	// Before the worktree, the setup command and the invoice: two nodes heading
	// for the same files are heading for the same merge, and §3.4 wants a human
	// to have seen that before either one starts.
	if (options.anyway !== true) {
		const { records } = await readNodes(paths)
		const found = overlaps(records, node, options.alsoStarting ?? [])
		if (found.length > 0) throw new OverlapError(node, found)
	}

	const config = await settings(paths, options.base)

	// Before anything starts, and in this order: a login that expired should be
	// one sentence, not a failure three minutes into a worktree (`PR-05-04`).
	const host = await checkHost(config.dispatch.host)
	if (!host.ok) throw new HostError(`${node} was not started: ${host.reason}`)

	const prompt = options.prompt ?? (await promptFor(paths, node))

	const worktree = await addWorktree(paths, node, options.base)
	if (worktree.created && config.dispatch.setup !== null)
		await prepare(node, worktree.path, config.dispatch.setup)

	const { id } = await startRun(paths, node, config.dispatch.host)
	// The pid file holds the **agent's** pid and nothing else, written by
	// `onStart` below. It used to be seeded with this process's, so a `sober
	// stop` landing before the child started killed the process that owns the
	// run — which is also the process that would have recorded it.

	const control = new AbortController()
	let timedOut = false
	const timer = setTimeout(() => {
		timedOut = true
		control.abort()
	}, config.dispatch.timeoutMinutes * 60_000)

	// The log is appended from a stream callback, which cannot await. Chaining
	// the writes is what keeps the file in the order the host produced it: fired
	// and forgotten, two appends race and the tail reads back shuffled.
	let written: Promise<void> = Promise.resolve()

	try {
		const exit = await startAgent({
			host: config.dispatch.host,
			cwd: worktree.path,
			prompt,
			signal: control.signal,
			onStart: (pid) => void writeRunPid(paths, id, pid),
			onLine: (line) => {
				options.onLine?.(line)
				written = written.then(() => appendRunOutput(paths, id, `${line}\n`))
			},
		})
		await written

		// A run past its limit is killed and recorded as failed with a timeout
		// error, never as a stop (§5.4). Its worktree is preserved like any
		// other failure — whatever the agent wrote stays inspectable (§8.2).
		//
		// Otherwise, a run someone asked to stop is stopped however it died. The
		// signal is not portable evidence: Windows has none to report, so the
		// second process writes the fact down and this reads it.
		const asked = !timedOut && (await wasStopped(paths, id))
		const result =
			timedOut && exit.kind === 'stopped'
				? {
						exit: 'failed' as const,
						error: `the run passed its ${config.dispatch.timeoutMinutes}-minute limit and was killed`,
					}
				: asked
					? { exit: 'stopped' as const, error: undefined }
					: { exit: exit.kind, error: exit.kind === 'failed' ? exit.reason : undefined }

		// The run is judged where it worked (§6.0): `dispatch.verify` first, then
		// every acceptance criterion the human approved, each in the node's own
		// worktree. Both are read from the base (ADR 0019) — work under review
		// does not get to write the test it is judged by.
		const judged =
			result.exit === 'finished'
				? {
						verify: await judge(worktree.path, config.dispatch.verify),
						acceptance: await Promise.all(
							(await criteriaOf(paths, node)).map((criterion) =>
								judge(worktree.path, criterion.run),
							),
						),
					}
				: {}

		const run = await finishRun(paths, id, { ...result, ...judged })
		return {
			run: id,
			exit: run.exit ?? 'failed',
			error: run.error,
			worktree: worktree.path,
			prepared: worktree.created,
			pr: await published(paths, node, options.base),
		}
	} finally {
		clearTimeout(timer)
		await clearRunPid(paths, id)
		await clearStopped(paths, id)
	}
}

/**
 * Stopping is available from every surface (§5.4), which means it is usually a
 * second process: the run was started in another terminal, or by the dashboard.
 * The pid file is the only thing the two share.
 *
 * The worktree is preserved and nothing is deleted. The stopping process does
 * not write the run record — the process that owns the run does, when its child
 * dies.
 */
export const stopRun = async (paths: Paths, id: string): Promise<boolean> => {
	const pid = await readRunPid(paths, id)
	if (pid === null) return false
	// Written before the kill, so the run finds it when it dies — and taken back
	// if the kill does not land, because a run that finished on its own was not
	// stopped, whatever anyone asked for.
	await markStopped(paths, id)
	try {
		process.kill(pid, 'SIGTERM')
	} catch {
		// Already gone: a run that ended between the read and the kill is not
		// an error, it is the outcome the caller wanted.
		await clearStopped(paths, id)
		await clearRunPid(paths, id)
		return false
	}
	await appendEvent(paths, { action: 'run.stopped', run: id })
	return true
}

export interface Wave {
	readonly node: string
	readonly options: DispatchOptions
}

/**
 * Several ready nodes at once, capped by `dispatch.concurrency` (§5.3). The
 * default is conservative on purpose: a first dispatch should not open twelve
 * sessions and twelve invoices.
 *
 * The chain stops at the first run that does not finish (`PR-05-08`). Nothing
 * is built on top of a result a human has not seen — the runs already in flight
 * are left to end on their own, and the queued ones never start.
 */
export const dispatchWave = async (
	paths: Paths,
	wave: readonly Wave[],
	base: string,
): Promise<readonly (Dispatched | SoberError)[]> => {
	const config = await settings(paths, base)
	// Dense from the start, so "nobody reached this one" is a value and not a
	// hole every array method quietly skips.
	const results: (Dispatched | SoberError | undefined)[] = Array.from({ length: wave.length })
	let halted = false
	let next = 0

	// The wave counts as active against itself (§3.4): its members are not
	// claimed yet, because nothing has started them. Refused up front rather than
	// as they come up, so a wave never spends on its first node and then tells
	// the human about a collision its second one was always going to have.
	const members = wave.map((item) => item.node)
	const { records } = await readNodes(paths)
	for (const [index, item] of wave.entries()) {
		if (item.options.anyway === true) continue
		const found = overlaps(records, item.node, members)
		if (found.length > 0) results[index] = new OverlapError(item.node, found)
	}

	const worker = async (): Promise<void> => {
		for (;;) {
			if (halted) return
			const index = next++
			const item = wave[index]
			if (item === undefined) return
			// A warning is not a failed result, so it stops nothing but itself.
			if (results[index] !== undefined) continue
			try {
				const done = await dispatch(paths, item.node, {
					...item.options,
					alsoStarting: members,
				})
				results[index] = done
				if (done.exit !== 'finished') halted = true
			} catch (error) {
				results[index] = error instanceof SoberError ? error : new HostError(String(error))
				halted = true
			}
		}
	}

	const workers = Math.min(config.dispatch.concurrency, wave.length)
	await Promise.all(Array.from({ length: workers }, worker))
	// Truncated at the first index nobody reached, never compacted: a caller
	// reads these against the wave it passed in, and dropping a hole from the
	// middle would put one node's result under another node's name.
	const stopped = results.indexOf(undefined)
	return (stopped === -1 ? results : results.slice(0, stopped)) as (Dispatched | SoberError)[]
}

/**
 * The brief, and above it what the human wrote when they turned the last
 * attempt down (§6.4). Feedback goes first because it is the only part the
 * agent has not already seen, and "rejecting is correcting" only works if the
 * correction is not buried under a page the agent wrote itself.
 */
/**
 * What SOBER does after the run, and what it therefore needs the agent to have
 * done. Found in the M1 gate: an agent wrote the files, left them uncommitted,
 * and the review that followed was empty — correctly, because a diff against
 * the base has nothing in it until there is a commit. Nothing had told it.
 *
 * It is not part of the brief. The brief is what a human approves, and this is
 * a fact about the machinery around the run.
 */
const HOW_IT_ENDS = `

---

## When you are done

Commit your work on this branch. Nothing outside a commit is reviewed: SOBER
reads \`git diff <base>...<this branch>\`, so uncommitted files are invisible to
the human who has to accept them.

Do not push, do not merge, and do not switch branches. Landing the work is a
human's decision, made after the review.
`

const promptFor = async (paths: Paths, node: string): Promise<string> => {
	const board = await loadBoard(paths)
	const brief = renderBrief(board, node)
	if (brief === null) throw new NotOnBoardError('node', node)

	const feedback = board.feedback.get(node)
	if (feedback === undefined) return `${brief}${HOW_IT_ENDS}`
	return `# The last attempt was turned down

${feedback.text}

What follows is the brief, unchanged.

${brief}${HOW_IT_ENDS}`
}

const settings = async (paths: Paths, base: string): Promise<Config> => {
	const config = await readConfigFromBase(paths, base)
	if (config.kind !== 'ok')
		throw new HostError(`config.jsonc on ${base} cannot be read: ${config.reason}`)
	return config.value
}

/**
 * `git worktree add` produces a tree with no `node_modules`, no `venv`, no
 * `target/` — so an agent cannot build or test what it writes, and the review
 * gets an unverified diff. If this fails the agent is never started: otherwise
 * you pay for a session that cannot work (§5.2).
 */
const prepare = (node: string, cwd: string, command: string): Promise<void> =>
	new Promise((resolve, reject) => {
		// A shell here, unlike everywhere else in SOBER: this value is written by
		// the user into their own config and is expected to be a shell line
		// (`pnpm install && pnpm build`). It is read from the base ref, so an
		// agent cannot put anything into it that a human has not merged.
		execFile(command, { cwd, shell: true, encoding: 'utf8' }, (error, stdout, stderr) => {
			if (error) return reject(new SetupFailedError(node, command, `${stdout}${stderr}`))
			resolve()
		})
	})

/**
 * The pull request, after the run and never before it (§6.1): a branch with
 * nothing on it has nothing for CI to run. `draftPr` governs neither how the
 * run is prepared nor how it is judged, so it is read normally rather than from
 * the base (§5.2) — the person deciding to push work outward is the one at this
 * machine, not the branch under review.
 *
 * Nothing here can fail a run. The work is committed and the record is written
 * by the time this runs; a git host that is down is a step that did not happen,
 * reported and never fatal.
 */
const published = async (paths: Paths, node: string, base: string): Promise<Published | null> => {
	const config = await readConfig(paths)
	if (config.kind !== 'ok' || !config.value.dispatch.draftPr) return null
	return publish(paths, node, base).catch((error: Error) => ({
		kind: 'skipped' as const,
		reason: error.message,
	}))
}

/**
 * One command, in the worktree, reduced to the one thing anyone reads later: the
 * exit code. `null` means it did not run, and never that it passed (ADR 0021) —
 * which is why a command that was never configured returns null rather than 0.
 *
 * A shell, like the setup command and for the same reason: the value is a shell
 * line a human wrote into their own config on the base ref.
 */
const judge = (cwd: string, command: string | null): Promise<CommandResult | null> =>
	command === null
		? Promise.resolve(null)
		: new Promise((resolve) => {
				execFile(command, { cwd, shell: true, encoding: 'utf8' }, (error) => {
					const code = (error as { code?: number } | null)?.code
					resolve({ exit: error === null ? 0 : typeof code === 'number' ? code : 1 })
				})
			})

const criteriaOf = async (paths: Paths, node: string) => {
	const record = await readNode(paths, node)
	return record.kind === 'ok' ? (record.value.brief?.acceptance ?? []) : []
}
