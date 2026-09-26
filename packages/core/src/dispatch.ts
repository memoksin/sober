import { execFile } from 'node:child_process'
import type { RunExit } from '@besober/schema'
import { posixShell, runAudit, unjudged } from './audit.js'
import { renderBrief } from './brief.js'
import {
	type Config,
	hostForTier,
	modelForScore,
	readConfig,
	readConfigFromBase,
	tierFor,
} from './config.js'
import { NotOnBoardError, SoberError } from './errors.js'
import { loadBoard } from './graph.js'
import {
	type AgentInput,
	checkHost,
	HostError,
	type HostReady,
	hostAvailability,
	recordAvailability,
	startAgent,
} from './host.js'
import {
	adapterFor,
	type Effort,
	EMPTY_TALLY,
	type Event,
	limitSpent,
	missingSkills,
	renderLine,
	type Tally,
	tally,
	UnknownHostError,
} from './hosts.js'
import { askJev, backupCandidates } from './jev.js'
import {
	appendEvent,
	appendRunOutput,
	clearRunInput,
	clearRunPid,
	clearStopped,
	markStopped,
	readRun,
	readRunInput,
	readRunOutput,
	readRunPid,
	wasStopped,
	writeRunPid,
} from './local.js'
import { liveModels } from './models.js'
import type { Paths } from './paths.js'
import { type Published, publish } from './pr.js'
import { readNode, readNodes } from './records.js'
import { finishRun, startRun } from './run.js'
import { lastRun } from './status.js'
import { tail } from './tail.js'
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
	/**
	 * Somebody is watching this one and can answer it (ADR 0046). Off by
	 * default, and never set by the queue or a wave: an unwatched run that stops
	 * to ask is the M2 gate's finding 1, and `NO_HUMAN` is what fixed it.
	 */
	readonly attended?: boolean
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

	// The tier comes from the node's score and the line from the base's config
	// (ADR 0019, ADR 0058): a run must not be able to raise its own model.
	const record = await readNode(paths, node)
	if (record.kind !== 'ok') throw new NotOnBoardError('node', node)

	// What Jev and the score-only path both choose among: `dispatch.models`
	// topped up from whatever `dispatch.sources` names (ADR 0063). Logged once
	// per dispatch so a retired pin or a clash dropped from the list is not a
	// silent change in what a node could run on.
	const built = await liveModels(paths, config.dispatch)
	await appendEvent(paths, {
		action: 'models',
		node,
		count: built.models.length,
		dropped: built.dropped,
	})

	// A host's limit is account-wide, so it is asked once per host, not once
	// per model (`limit-detect`). A host with no `availability` table
	// (`opencode`, `cursor`) never appears in `spent`, so it is never removed.
	const hostLines = new Map<string, string>()
	for (const model of built.models) {
		try {
			const id = adapterFor(model.run).id
			if (!hostLines.has(id)) hostLines.set(id, model.run)
		} catch {
			// An unknown host is refused later, at `checkHost` time.
		}
	}
	const spent =
		hostLines.size > 0
			? await hostAvailability(paths, [...hostLines.values()], config.dispatch.probeSeconds)
			: {}

	const removed: { host: string; reason: string }[] = []
	const unknown: string[] = []
	const eligible = built.models.filter((model) => {
		let id: string
		try {
			id = adapterFor(model.run).id
		} catch {
			return true
		}
		const state = spent[id]
		if (state === undefined || state.state === 'ready') return true
		if (state.state === 'unknown') {
			if (!unknown.includes(id)) unknown.push(id)
			return true
		}
		if (!removed.some((entry) => entry.host === id))
			removed.push({ host: id, reason: state.reason ?? 'the usage limit is spent' })
		return false
	})
	// A host whose window is nearly full is kept out while another host can
	// take the node, so the last of a week is not spent on work that fits
	// elsewhere (ADR 0069). With nothing else ready, it still runs.
	const strained = Object.entries(spent)
		.filter(([, state]) =>
			Object.values(state.windows ?? {}).some((window) => window.used >= config.dispatch.limitSoft),
		)
		.map(([id]) => id)
	const hostOf = (run: string): string | null => {
		try {
			return adapterFor(run).id
		} catch {
			return null
		}
	}
	const roomy = eligible.filter((model) => !strained.includes(hostOf(model.run) ?? ''))
	const available = roomy.length > 0 ? roomy : eligible
	const held = roomy.length > 0 && roomy.length < eligible.length ? strained : []
	if (removed.length > 0 || unknown.length > 0 || held.length > 0)
		await appendEvent(paths, { action: 'hosts', node, removed, unknown, strained: held })
	if (built.models.length > 0 && available.length === 0)
		throw new HostError(
			`${node} was not started: every host is out — ${removed
				.map((r) => `${r.host}: ${r.reason}`)
				.join('; ')}`,
		)

	// With jevMode on, the brief's own score is not consulted at all: the whole
	// point is that nobody has to guess a number (ADR 0059). A Jev that cannot
	// answer stops the dispatch here, before the worktree and before the spend.
	const jev = config.dispatch.jevMode
		? await askJev(await stateFor(paths, node), {
				skills: config.dispatch.jevSkills,
				models: available,
			})
		: null
	const complexity = jev?.complexity ?? record.value.brief?.complexity ?? null
	const chosen = chooseLine(
		{ ...config.dispatch, models: [...available] },
		complexity,
		jev?.model ?? null,
	)
	// Jev's backup when it picked the primary; otherwise the same rule Jev is
	// shown, first candidate taken, so both paths agree on what may stand in.
	let backup =
		jev?.model != null
			? (available.find((m) => m.name === jev.backup) ?? null)
			: (backupCandidates(available, chosen.host, complexity)[0] ?? null)
	// An attended run falls only to a host that can hear the human too; any
	// other backup counts as none, before start and after.
	if (backup !== null && options.attended === true) {
		let attendable = false
		try {
			attendable = adapterFor(backup.run).attendable
		} catch {
			// An unknown line is no backup, not a crash.
		}
		if (!attendable) {
			await appendEvent(paths, {
				action: 'backup',
				node,
				host: backup.run,
				reason: `skipped: ${backup.run} cannot be answered while it runs, and this run is attended`,
			})
			backup = null
		}
	}
	let line = chosen.host
	const named =
		chosen.chose === null
			? chosen.fallback
				? ` (no model covers score ${complexity}, falling back to \`dispatch.host\`)`
				: ''
			: ` (the ${chosen.chose} ${chosen.kind}${chosen.fallback ? ', falling back to `dispatch.host`' : ''})`
	// The key a person edits to fix a refusal: the tier's own line or the
	// model's entry when one named the host, `dispatch.host` when that is what ran.
	const refused = (reason: string, fix: string) =>
		new HostError(`${node} was not started${named}: ${reason} — ${fix} \`${chosen.key}\``)

	// Before anything starts, and in this order: a login that expired should be
	// one sentence, not a failure three minutes into a worktree (`PR-05-04`).
	let host: HostReady
	try {
		host = await checkHost(line)
	} catch (error) {
		// A typo in a tier names no host at all, and does not fall back.
		if (error instanceof UnknownHostError)
			throw refused(`SOBER has no adapter for \`${line}\``, 'change')
		throw error
	}
	// A primary that is refused, or whose account the probe already found spent,
	// hands over to the backup before the worktree — if the backup is ready.
	// Without one, the refusal is today's, and a spent-but-ready primary still runs.
	const primarySpent = spent[adapterFor(line).id]
	const primaryReason = !host.ok
		? (host.reason ?? 'the host is not ready')
		: primarySpent?.state === 'spent'
			? (primarySpent.reason ?? 'the usage limit is spent')
			: null
	let ran: 'primary' | 'backup' = 'primary'
	let fellBack: string | null = null
	if (primaryReason !== null && backup !== null && (await ready(backup.run))) {
		line = backup.run
		ran = 'backup'
		fellBack = primaryReason
		await appendEvent(paths, { action: 'backup', node, host: line, reason: primaryReason })
	} else if (!host.ok) throw refused(primaryReason ?? 'the host is not ready', 'or change')

	// Attended mode needs a host that reads stdin while it runs (ADR 0046), and
	// two of the three do not. Refusing is the honest answer: running it
	// headless anyway would put somebody in front of a session that cannot hear
	// them, which is worse than not offering it (§2.9).
	if (options.attended === true && !adapterFor(line).attendable)
		throw refused(
			`${line} takes one message and exits, so nobody can answer it while it runs. Start it without watching`,
			'or change',
		)

	const effort = effortFor(config.dispatch, complexity)

	// A node sent back by a human continues the session that built it, on the
	// same host (DESIGN §6.4, ADR 0069). Without one to continue, the next
	// attempt starts fresh from what the last one reported.
	const board = await loadBoard(paths)
	const previous = board.feedback.has(node) ? lastRun(board, node) : null
	const resumable =
		previous !== null && previous.run.session !== null && sameHost(previous.run.host, line)
			? previous.run
			: null
	const handoff = previous === null ? null : await lastWords(paths, previous.id)
	const skills = jev?.skills ?? []
	const freshPrompt = options.prompt ?? (await promptFor(paths, node, skills, handoff))
	const resumedPrompt = options.prompt ?? (await promptFor(paths, node, skills, null))

	const worktree = await addWorktree(paths, node, options.base)
	if (worktree.created && config.dispatch.setup !== null)
		await prepare(node, worktree.path, config.dispatch.setup)

	const attended = options.attended === true
	const { id } = await startRun(paths, node, line, {
		attended,
		tier: chosen.chose,
		fallback: chosen.fallback,
		backup: backup?.run ?? null,
		ran,
		fellBack,
		effort,
	})
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

	// What the human has said, relayed from the file every surface writes to
	// into the stdin only this process holds (ADR 0046). Nothing runs unless the
	// run is attended, so a headless dispatch pays for none of it.
	const relay = attended ? relayInput(paths, id) : null

	// What decides a fall after start: whether the primary reached a tool call,
	// and the tail of what it printed, for the host's own limit patterns.
	let sawTool = false
	let output = ''
	let sum: Tally = EMPTY_TALLY
	// The host's own word on its account, free with every Claude run (ADR 0069).
	let lastLimit: string | null = null
	let skillsChecked = false
	const emit = (raw: string): void => {
		options.onLine?.(raw)
		written = written.then(() => appendRunOutput(paths, id, `${raw}\n`))
	}
	const launch = (host: string, prompt: string, resume: string | null, runEffort = effort) =>
		startAgent({
			host,
			cwd: worktree.path,
			prompt,
			attended,
			signal: control.signal,
			run: {
				effort: runEffort,
				plugins: config.dispatch.plugins,
				settings: config.dispatch.workerSettings,
				resume,
			},
			onStart: (pid) => void writeRunPid(paths, id, pid),
			onInput: (input) => relay?.start(input),
			onLine: (raw) => {
				output = `${output}${raw}\n`.slice(-OUTPUT_KEPT)
				let event: Event | null = null
				try {
					event = JSON.parse(raw) as Event
				} catch {
					// Not JSON: a plain stderr line never counts as a tool call.
				}
				let missing: string[] | null = null
				if (event !== null && typeof event === 'object') {
					sum = tally(sum, event)
					if (event.type === 'rate_limit_event') lastLimit = raw
					if (!sawTool) sawTool = renderLine(event).some((l) => l.kind === 'tool')
					if (!skillsChecked) missing = missingSkills(skills, event)
				}
				emit(raw)
				if (missing === null) return
				skillsChecked = true
				// The prompt names these skills; a worker without them guesses instead.
				if (missing.length > 0)
					emit(
						`the host did not load ${missing.join(', ')} — check \`dispatch.plugins\` and \`dispatch.jevSkills\``,
					)
			},
		})
	const cold = () => {
		sum = EMPTY_TALLY
		return launch(line, freshPrompt, null)
	}

	try {
		let resume = resumable?.session ?? null
		// A big session is compacted before it is resumed: resumed as it is, every
		// turn of the retry would re-read the whole first attempt, which measured
		// 1.8x a fresh retry over 26 retries (ADR 0069). The compaction itself is
		// written at low effort: its output is most of what it costs.
		if (
			resume !== null &&
			adapterFor(line).id === 'claude' &&
			(resumable?.usage?.contextPeak ?? 0) > COMPACT_ABOVE
		) {
			emit(`compacting session ${resume} before resuming it`)
			const compacted = await launch(line, COMPACT, resume, 'low')
			await written
			if (compacted.kind !== 'finished') resume = null
		}
		let exit = resume === null ? await cold() : await launch(line, resumedPrompt, resume)
		await written

		// A session that cannot be resumed — gone, or refused — fails before it
		// touches anything. The node starts cold instead; it never tries the id
		// again, because the run record now holds the fresh session's.
		if (
			resume !== null &&
			exit.kind === 'failed' &&
			!sawTool &&
			!control.signal.aborted &&
			!(await wasStopped(paths, id))
		) {
			emit(`session ${resume} could not be resumed: ${exit.reason} — starting a fresh one`)
			exit = await cold()
			await written
		}

		// A primary that stopped on a spent limit before touching anything runs
		// once more on the backup, in the same worktree and under the same run.
		// A stop, a timeout, or anything after a tool call is final.
		const spentReason =
			exit.kind === 'failed' && !sawTool && ran === 'primary' && backup !== null
				? limitSpent(line, `${output}\n${exit.reason}`)
				: null
		if (
			spentReason !== null &&
			backup !== null &&
			!control.signal.aborted &&
			!(await wasStopped(paths, id)) &&
			(await ready(backup.run))
		) {
			// The second launch hands `onInput` a fresh stdin; the first relay's timer must not outlive it.
			relay?.stop()
			emit(`primary ${line} stopped: ${spentReason} — running on ${backup.run}`)
			line = backup.run
			ran = 'backup'
			fellBack = spentReason
			sum = EMPTY_TALLY
			exit = await launch(line, freshPrompt, null)
			await written
		}
		relay?.stop()

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
		//
		// A run that did not finish is not judged, and says so criterion by
		// criterion: nothing ran, and nothing ran is not nothing to run.
		const judged =
			result.exit === 'finished'
				? await runAudit(paths, node, id, {
						base: options.base,
						verify: config.dispatch.verify,
					})
				: await unjudged(paths, node)

		if (lastLimit !== null) await recordAvailability(paths, line, lastLimit)

		const run = await finishRun(paths, id, {
			...result,
			...judged,
			host: line,
			ran,
			...(fellBack === null ? {} : { fellBack }),
			session: sum.session,
			usage:
				sum.turns === null && sum.contextPeak === null && sum.cost === null
					? null
					: { turns: sum.turns, contextPeak: sum.contextPeak, cost: sum.cost },
		})
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
		relay?.stop()
		await clearRunPid(paths, id)
		await clearStopped(paths, id)
		await clearRunInput(paths, id)
	}
}

/** How much of the primary's output is kept for the limit patterns to read. */
const OUTPUT_KEPT = 64 * 1024

/**
 * Below this peak context a session is resumed as it is; above it, compacted
 * first. Measured on four real worker sessions (ADR 0069): one compaction costs
 * about one turn of the old context plus a 5–13k summary, and leaves ~35–44k.
 * At 110k and up it pays back on the first retry turn with a cold cache; at
 * 50–76k it needs 12–16 turns, more than a typical resumed retry takes.
 */
const COMPACT_ABOVE = 100_000

const COMPACT =
	'/compact Keep what the brief asked for, which files were changed and why, what was checked, and what is unfinished. Drop file contents and command output.'

/** How long the last attempt's own report may be when it heads a fresh retry's prompt. */
const HANDOFF_KEPT = 4000

/** The score's tier, as an effort: the same bands `thresholds` draws for the tiers (ADR 0068). */
const effortFor = (dispatch: Config['dispatch'], complexity: number | null): Effort | null => {
	if (dispatch.effort !== 'auto') return dispatch.effort
	const tier = tierFor(dispatch.thresholds, complexity)
	return tier === null ? null : tier === 'mid' ? 'medium' : tier
}

/** The same host CLI, whatever model either line names: a session belongs to the host. */
const sameHost = (left: string, right: string): boolean => {
	try {
		return adapterFor(left).id === adapterFor(right).id
	} catch {
		return false
	}
}

/** The last thing a run's agent said — its own account of what it did and what is left. */
const lastWords = async (paths: Paths, run: string): Promise<string | null> => {
	const said = tail(await readRunOutput(paths, run))
		.filter((line) => line.kind === 'text')
		.at(-1)?.text
	return said === undefined || said.trim() === '' ? null : said.trim().slice(0, HANDOFF_KEPT)
}

/** A backup line that names no host is not ready; it is never a crash. */
const ready = async (line: string): Promise<boolean> => {
	try {
		return (await checkHost(line)).ok
	} catch (error) {
		if (error instanceof UnknownHostError) return false
		throw error
	}
}

/**
 * How much of the answer file has already been handed to the host, and how
 * often this looks for more. The cadence is a `stat` on a local file this
 * machine wrote — the same shape `stop` uses, and the same reason: answering is
 * available from every surface (`PR-09-08`), so the writer is usually a second
 * process and a file is what the two share.
 */
const RELAY_MS = 150

/**
 * The bridge between the file anybody may append to and the stdin only this
 * process holds. Each line is one thing the human said; `done` ends the
 * session's input, which is how an attended host exits on its own instead of
 * waiting for the dispatch timeout.
 */
const relayInput = (paths: Paths, id: string) => {
	let timer: NodeJS.Timeout | null = null
	let read = 0

	const stop = (): void => {
		if (timer !== null) clearInterval(timer)
		timer = null
	}

	return {
		stop,
		start: (input: AgentInput): void => {
			timer = setInterval(() => {
				void readRunInput(paths, id).then((text) => {
					const lines = text.split('\n').filter((line) => line.trim() !== '')
					// Only what has arrived since the last look. Re-reading the file
					// each tick is cheap; re-saying what was already said is not.
					for (const line of lines.slice(read)) {
						const said = JSON.parse(line) as { text?: string; done?: boolean }
						if (typeof said.text === 'string' && said.text !== '') input.say(said.text)
						if (said.done === true) {
							input.done()
							stop()
						}
					}
					read = lines.length
				})
			}, RELAY_MS)
			// Nothing else is waiting on this process, so a relay that outlived its
			// run must not be what keeps node alive.
			timer.unref?.()
		},
	}
}

/**
 * Stopping is available from every surface (§5.4), which means it is usually a
 * second process: the run was started in another terminal, or by the dashboard.
 * The pid file is the only thing the two share.
 *
 * The worktree is preserved and nothing is deleted. The stopping process does
 * not write the run record — the process that owns the run does, when its child
 * dies. The one exception is an owner that is already gone: nobody will ever
 * write that record, so the stopper closes it as failed and the node can run
 * again. Still `false`, because nothing was killed.
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
		// Already gone. A run that ended between the read and the kill has its
		// record written; one whose owner died never will, so it is closed here.
		await clearStopped(paths, id)
		await clearRunPid(paths, id)
		const run = await readRun(paths, id)
		if (run.kind === 'ok' && run.value.exit === null) {
			await finishRun(paths, id, {
				exit: 'failed',
				error: 'the process that owned this run is gone',
				acceptance: (await unjudged(paths, run.value.node)).acceptance,
			})
		}
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
 * host-avail-7f0g's first run backgrounded its test suite, ended its turn to wait, and the run ended uncommitted.
 *
 * It is not part of the brief. The brief is what a human approves, and this is
 * a fact about the machinery around the run.
 */
const HOW_IT_ENDS = `

---

## When you are done

This is a headless run and nobody is watching it. The turn you end is the run you end: when you stop, the process exits, and nothing that was still running reports back. Run every command in the foreground and wait for it to finish — never background a command, schedule a wakeup, or stop to wait for a notification. Long commands (the full test suite, coverage) are part of the work; wait for them.

Read files with an offset and a limit around what a search found. Read a whole file only when it is short: everything you read stays in the session for every turn after it.

Commit your work on this branch. Nothing outside a commit is reviewed: SOBER
reads \`git diff <base>...<this branch>\`, so uncommitted files are invisible to
the human who has to accept them.

Do not push, do not merge, and do not switch branches. Landing the work is a
human's decision, made after the review.

End with a short final message: the files you changed, the decisions you made,
and anything left unfinished. If the node is sent back, that message is where
the next attempt starts.
`

/**
 * Which line runs the node. A `models` list wins over the tiers (ADR 0061):
 * Jev's pick when it made one, else the first entry covering the score. With
 * no list, the score picks a tier as before (ADR 0058). `chose` is what the
 * run record keeps — a model's name or a tier's.
 */
const chooseLine = (
	dispatch: Config['dispatch'],
	complexity: number | null,
	picked: string | null,
): {
	host: string
	chose: string | null
	kind: 'model' | 'tier'
	fallback: boolean
	/** The config key a person edits when this line is refused. */
	key: string
} => {
	if (dispatch.models.length > 0) {
		const entry = dispatch.models.find((m) => m.name === picked)
		const line =
			entry === undefined
				? modelForScore(dispatch, complexity)
				: { host: entry.run, chose: entry.name, fallback: false }
		const key = line.chose === null ? 'dispatch.host' : `dispatch.models (${line.chose})`
		return { ...line, kind: 'model', key }
	}
	const tier = tierFor(dispatch.thresholds, complexity)
	if (tier === null)
		return { host: dispatch.host, chose: null, kind: 'tier', fallback: false, key: 'dispatch.host' }
	const line = hostForTier(dispatch, tier)
	return {
		...line,
		chose: tier,
		kind: 'tier',
		key: line.fallback ? 'dispatch.host' : `dispatch.tiers.${tier}`,
	}
}

/** What Jev is shown: the brief alone, without the closing instructions. */
const stateFor = async (paths: Paths, node: string): Promise<string> => {
	const brief = renderBrief(await loadBoard(paths), node)
	if (brief === null) throw new NotOnBoardError('node', node)
	return brief
}

/** Named, never described: the agent looks the skill up by the name its host knows. */
const skillsBlock = (skills: readonly string[]): string =>
	skills.length === 0
		? ''
		: `
# Skills

${skills.map((name) => `Use the \`${name}\` skill.`).join('\n')}
`

const promptFor = async (
	paths: Paths,
	node: string,
	skills: readonly string[],
	handoff: string | null,
): Promise<string> => {
	const board = await loadBoard(paths)
	const brief = renderBrief(board, node)
	if (brief === null) throw new NotOnBoardError('node', node)

	const body = `${brief}${skillsBlock(skills)}${HOW_IT_ENDS}`
	const feedback = board.feedback.get(node)
	if (feedback === undefined) return body
	const reported = handoff === null ? '' : `\n\n# What the last attempt reported\n\n${handoff}`
	return `# The last attempt was turned down

${feedback.text}${reported}

What follows is the brief, unchanged.

${body}`
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
const prepare = (node: string, cwd: string, command: string): Promise<void> => {
	// A shell here, unlike everywhere else in SOBER: this value is written by
	// the user into their own config and is expected to be a shell line
	// (`pnpm install && pnpm build`). It is read from the base ref, so an
	// agent cannot put anything into it that a human has not merged.
	const shell = posixShell()
	if (shell === null)
		return Promise.reject(
			new SetupFailedError(node, command, 'no POSIX shell found: install Git for Windows'),
		)
	return new Promise((resolve, reject) => {
		execFile(command, { cwd, shell, encoding: 'utf8' }, (error, stdout, stderr) => {
			if (error) return reject(new SetupFailedError(node, command, `${stdout}${stderr}`))
			resolve()
		})
	})
}

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
