import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Run } from '@besober/schema'
import { z } from 'zod'
import type { Paths } from './paths.js'
import { recordFile } from './paths.js'
import type { BrokenRecord, ReadRecord, ReadRecords } from './read.js'
import { readRecord, readRecords } from './read.js'
import { append, appendLine, writeRecord } from './write.js'

/**
 * Local state is files, gitignored and disposable (ADR 0018): deleting
 * `.sober/local/` loses no decision and no graph data. One file per run, so
 * three parallel agents never contend for a writer (DESIGN §1.4).
 */
export const readRun = (paths: Paths, id: string): Promise<ReadRecord<Run>> =>
	readRecord(recordFile(paths.runs, id), Run)

/**
 * `z.input`, not `Run`: a field with a default may be omitted by a writer and is
 * always present to a reader. Without it, adding `attended` would have made
 * every existing caller name a value for something it does not care about.
 *
 * The default is filled rather than parsed. Writing has never validated here —
 * `readRun` is where a record meets its schema — and turning a write into a
 * parse would reject records these tests and this product have always written.
 */
export const writeRun = (paths: Paths, id: string, run: z.input<typeof Run>): Promise<void> =>
	writeRecord(recordFile(paths.runs, id), { attended: false, ...run })

export const readRuns = (paths: Paths): Promise<ReadRecords<Run>> => readRecords(paths.runs, Run)

/** The agent's raw output, beside the record: a run killed mid-write tears the log, never the record. */
export const runLog = (paths: Paths, id: string): string => join(paths.runs, `${id}.log`)

export const appendRunOutput = (paths: Paths, id: string, chunk: string): Promise<void> =>
	append(runLog(paths, id), chunk)

/** The same log, read back. A run with no log yet reads as empty, never as an error. */
export const readRunOutput = (paths: Paths, id: string): Promise<string> =>
	readFile(runLog(paths, id), 'utf8').catch(() => '')

/**
 * The other direction: what a human has said to a run they are watching
 * (ADR 0046).
 *
 * A file rather than a pipe, for the reason `stop` is a file. Answering is
 * available from every surface (`PR-09-08`), which means it is usually a second
 * process — the dashboard server, or a second terminal — and the process that
 * owns the host is the only one holding its stdin. The file is what the two
 * share, and it is the mechanism `markStopped` already proved across the three
 * platforms this has to work on.
 */
export const runInput = (paths: Paths, id: string): string => join(paths.runs, `${id}.in`)

export const appendRunInput = (paths: Paths, id: string, line: string): Promise<void> =>
	append(runInput(paths, id), `${line}\n`)

/** A run nobody has said anything to reads as empty, never as an error. */
export const readRunInput = (paths: Paths, id: string): Promise<string> =>
	readFile(runInput(paths, id), 'utf8').catch(() => '')

export const clearRunInput = async (paths: Paths, id: string): Promise<void> => {
	await rm(runInput(paths, id), { force: true })
}

/**
 * The host's pid, beside the run, for as long as it is running. `sober stop` is
 * a second process — usually a second terminal — so the pid has to survive the
 * gap between them. It is deleted when the run ends, and a stale one is treated
 * as no run at all.
 */
export const runPidFile = (paths: Paths, id: string): string => join(paths.runs, `${id}.pid`)

export const writeRunPid = (paths: Paths, id: string, pid: number): Promise<void> =>
	writeFile(runPidFile(paths, id), `${pid}\n`)

export const readRunPid = async (paths: Paths, id: string): Promise<number | null> => {
	try {
		const pid = Number.parseInt(await readFile(runPidFile(paths, id), 'utf8'), 10)
		return Number.isFinite(pid) ? pid : null
	} catch {
		return null
	}
}

export const clearRunPid = async (paths: Paths, id: string): Promise<void> => {
	await rm(runPidFile(paths, id), { force: true })
}

const stopFile = (paths: Paths, id: string): string => join(paths.runs, `${id}.stop`)

/**
 * That someone asked for this run to end, written down rather than inferred
 * from how it died. `sober stop` is a second process, and the signal it sends
 * is the only evidence the first one has — on POSIX. Windows has no SIGTERM to
 * report, so a stopped run there looked exactly like a crashed one, and the
 * work was recorded as failed.
 */
export const markStopped = (paths: Paths, id: string): Promise<void> =>
	writeFile(stopFile(paths, id), `${new Date().toISOString()}\n`)

export const wasStopped = async (paths: Paths, id: string): Promise<boolean> => {
	try {
		await readFile(stopFile(paths, id), 'utf8')
		return true
	} catch {
		return false
	}
}

export const clearStopped = async (paths: Paths, id: string): Promise<void> => {
	await rm(stopFile(paths, id), { force: true })
}

/**
 * What the human wrote when they rejected a result (§6.4). Local, like the run
 * it answers: rejecting is correcting, and the correction is for the next run
 * on this machine — a teammate needs to know the node is unfinished, not how
 * many times someone's laptop turned work down.
 *
 * It is also what takes the node out of the review queue. A finished run makes
 * a node `in-review`; a rejection written after that run ended is what makes it
 * `ready` again, with no field on the run to forget to set.
 */
export const Feedback = z.strictObject({
	at: z.iso.datetime(),
	by: z.string().min(1),
	text: z.string().min(1),
	/** "Start clean" reset the branch to its base rather than building on it (§5.0). */
	clean: z.boolean(),
})

export type Feedback = z.infer<typeof Feedback>

export const readFeedback = (paths: Paths, node: string): Promise<ReadRecord<Feedback>> =>
	readRecord(recordFile(paths.feedback, node), Feedback)

export const writeFeedback = (paths: Paths, node: string, feedback: Feedback): Promise<void> =>
	writeRecord(recordFile(paths.feedback, node), feedback)

export const readFeedbacks = (paths: Paths): Promise<ReadRecords<Feedback>> =>
	readRecords(paths.feedback, Feedback)

/**
 * `local/log.jsonl` — one line per event, with an `action` discriminator rather
 * than a file per event type. Loose on purpose: an event carries whatever its
 * action needs, and an audit log that refuses to record something is worse than
 * one that records a field nobody reads.
 */
export const LogEvent = z.looseObject({
	at: z.iso.datetime(),
	action: z.string().min(1),
})

export type LogEvent = z.infer<typeof LogEvent>

export const appendEvent = (
	paths: Paths,
	event: Omit<LogEvent, 'at'> & { at?: string },
): Promise<void> =>
	appendLine(paths.log, JSON.stringify({ at: new Date().toISOString(), ...event }))

export interface ReadLog {
	readonly events: readonly LogEvent[]
	/** A torn last line is reported like any broken record (DESIGN §8.4), not thrown. */
	readonly broken: readonly BrokenRecord[]
}

export const readLog = async (paths: Paths): Promise<ReadLog> => {
	let text: string
	try {
		text = await readFile(paths.log, 'utf8')
	} catch (error) {
		if ((error as { code?: string }).code === 'ENOENT') return { events: [], broken: [] }
		throw error
	}

	const events: LogEvent[] = []
	const broken: BrokenRecord[] = []
	text
		.split('\n')
		.filter((line) => line.trim().length > 0)
		.forEach((line, index) => {
			try {
				const parsed = LogEvent.safeParse(JSON.parse(line))
				if (parsed.success) events.push(parsed.data)
				else broken.push({ file: `${paths.log}:${index + 1}`, reason: 'not an event' })
			} catch {
				broken.push({ file: `${paths.log}:${index + 1}`, reason: 'not valid JSON' })
			}
		})
	return { events, broken }
}
