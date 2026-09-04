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

export const writeRun = (paths: Paths, id: string, run: Run): Promise<void> =>
	writeRecord(recordFile(paths.runs, id), run)

export const readRuns = (paths: Paths): Promise<ReadRecords<Run>> => readRecords(paths.runs, Run)

/** The agent's raw output, beside the record: a run killed mid-write tears the log, never the record. */
export const runLog = (paths: Paths, id: string): string => join(paths.runs, `${id}.log`)

export const appendRunOutput = (paths: Paths, id: string, chunk: string): Promise<void> =>
	append(runLog(paths, id), chunk)

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
