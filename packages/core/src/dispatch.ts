import { execFile } from 'node:child_process'
import type { RunExit } from '@besober/schema'
import { renderBrief } from './brief.js'
import { type Config, readConfigFromBase } from './config.js'
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
import { finishRun, startRun } from './run.js'
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
}

export interface Dispatched {
	readonly run: string
	readonly exit: RunExit
	readonly error: string | null
	readonly worktree: string
	/** False when the worktree was already there — setup runs once per node (§5.2). */
	readonly prepared: boolean
}

export const dispatch = async (
	paths: Paths,
	node: string,
	options: DispatchOptions,
): Promise<Dispatched> => {
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
	await writeRunPid(paths, id, process.pid)

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

		const run = await finishRun(paths, id, result)
		return {
			run: id,
			exit: run.exit ?? 'failed',
			error: run.error,
			worktree: worktree.path,
			prepared: worktree.created,
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
	// Written before the kill: the run has to find it when it dies, and a
	// process that ends between these two lines still ended because of this.
	await markStopped(paths, id)
	try {
		process.kill(pid, 'SIGTERM')
	} catch {
		// Already gone: a run that ended between the read and the kill is not
		// an error, it is the outcome the caller wanted.
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
	const results: (Dispatched | SoberError)[] = []
	let halted = false
	let next = 0

	const worker = async (): Promise<void> => {
		for (;;) {
			if (halted) return
			const index = next++
			const item = wave[index]
			if (item === undefined) return
			try {
				const done = await dispatch(paths, item.node, item.options)
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
	return results.filter((result) => result !== undefined)
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
