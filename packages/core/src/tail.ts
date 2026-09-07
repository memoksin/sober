import { open } from 'node:fs/promises'
import type { LogLine, LogWindow } from '@besober/schema'
import { readRun, runLog } from './local.js'
import type { Paths } from './paths.js'

/**
 * The run log holds the host's raw output (§5.5) — machine-facing, like every
 * internal format (`PR-09-03`). This renders it for the human watching a node
 * build (`PR-05-09`).
 *
 * It is an allowlist, not a denylist. A host adds event types between releases,
 * and a denylist turns every new one into noise in front of the user the day it
 * ships — which is exactly how a live tail becomes a thing nobody reads.
 */
export const tail = (log: string): readonly LogLine[] =>
	log
		.split('\n')
		.filter((line) => line.trim().length > 0)
		.map(tailLine)
		.filter((line): line is LogLine => line !== null)

/**
 * How much of a log a screen is sent when it opens one. A dispatch can run for
 * an hour, and the person opening it wants what the agent is saying now — the
 * beginning is a scroll nobody asked for and a payload nobody reads.
 */
const FIRST_LINES = 200

/**
 * The matching bound in bytes, so opening a long run reads the end of the file
 * rather than all of it. Generous against `FIRST_LINES` — a rendered line is a
 * sentence and the raw JSON behind it is a few hundred bytes — because
 * overshooting costs one local read and undershooting costs the user lines.
 */
const FIRST_BYTES = 256 * 1024

export interface Following {
	/** Where to start. Omitted, the window is the tail of the log rather than all of it. */
	readonly from?: number
	/** Cap on the lines a first window carries. Ignored once `from` is given. */
	readonly last?: number
}

/**
 * A window on a run's log: what is new since `from`, and where to ask again
 * (ADR 0046).
 *
 * The offset is a byte position rather than a line count. A host writes a JSON
 * event in chunks — `startAgent` splits on newlines across chunk boundaries for
 * exactly this reason — so a read can land mid-line, and bytes are the only
 * unit that survives that. A partial trailing line is left in the file for the
 * next read rather than parsed in pieces, which is what stops one torn event
 * rendering as two lines of broken JSON in front of the user.
 *
 * `live` is read **before** the file, and the order is the whole correctness
 * argument. A run that finishes between the two reads is reported as still
 * live, so the caller asks once more and collects the last lines. Read the
 * other way round, a run that finishes mid-read is reported as over while its
 * final lines are still unread, and the screen stops asking with the ending
 * missing — which is the one part of a run anybody re-reads.
 */
export const followRun = async (
	paths: Paths,
	id: string,
	{ from, last = FIRST_LINES }: Following = {},
): Promise<LogWindow> => {
	const record = await readRun(paths, id)
	// A run whose record cannot be read is not running. The log is still served
	// if it is there — a torn record is not a reason to hide what the agent
	// said — but nothing is going to append to it.
	const live = record.kind === 'ok' && record.value.exit === null

	const handle = await open(runLog(paths, id), 'r').catch(() => null)
	// A run with no log yet reads as empty, never as an error (`readRunOutput`
	// makes the same promise, and a screen opened a second before the host
	// writes its first line is the ordinary case rather than a failure).
	if (handle === null) return { lines: [], offset: from ?? 0, live }

	try {
		const { size } = await handle.stat()
		const start = from ?? Math.max(0, size - FIRST_BYTES)
		if (start >= size) return { lines: [], offset: start, live }

		const buffer = Buffer.alloc(size - start)
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, start)

		// Only whole lines. `end` is the byte after the last newline, and it is
		// what the caller comes back with — so a half-written line is read again
		// next time, from its own first byte, rather than skipped or split.
		const read = buffer.subarray(0, bytesRead)
		const end = read.lastIndexOf(0x0a) + 1
		if (end === 0) return { lines: [], offset: start, live }

		const lines = tail(read.subarray(0, end).toString('utf8'))
		return {
			lines: [
				// A first window opened partway into a big file starts mid-line, and
				// the byte bound is generous, so both ends are trimmed here rather
				// than guessed at in the seek.
				...(from === undefined && lines.length > last ? lines.slice(-last) : lines),
			],
			offset: start + end,
			live,
		}
	} finally {
		await handle.close()
	}
}

const tailLine = (line: string): LogLine | null => {
	let event: Event
	try {
		event = JSON.parse(line) as Event
	} catch {
		// Not JSON at all: the host's own stderr, which is the one thing a
		// failing run always has and the last thing to hide from the person
		// reading it.
		return { kind: 'raw', text: line.trim() }
	}

	if (event.type === 'system' && event.subtype === 'init')
		return { kind: 'started', text: 'session started' }

	// What the human said, echoed back by the host under `--replay-user-messages`
	// (ADR 0046). It is in the log so the transcript holds both halves: a
	// conversation where only one side was recorded is not one anybody can audit
	// afterwards, and the answers are the part nobody else can reconstruct.
	if (event.type === 'user') {
		const said = (event.message?.content ?? [])
			.map((part) => (part.type === 'text' ? part.text?.trim() : null))
			.filter((text): text is string => typeof text === 'string' && text.length > 0)
		return said.length > 0 ? { kind: 'answer', text: said.join(' · ') } : null
	}

	if (event.type === 'assistant') {
		const parts = event.message?.content ?? []
		const rendered = parts
			.map((part) =>
				part.type === 'text'
					? part.text?.trim()
					: part.type === 'tool_use'
						? `${part.name ?? 'tool'}`
						: null,
			)
			.filter((text): text is string => typeof text === 'string' && text.length > 0)
		const kind = parts.some((part) => part.type === 'tool_use') ? 'tool' : 'text'
		return rendered.length > 0 ? { kind, text: rendered.join(' · ') } : null
	}

	if (event.type === 'result')
		return {
			kind: 'result',
			text: event.is_error === true ? `failed: ${event.subtype ?? 'error'}` : 'finished',
		}

	return null
}

interface Event {
	readonly type?: string
	readonly subtype?: string
	readonly is_error?: boolean
	readonly message?: {
		readonly content?: readonly {
			readonly type?: string
			readonly text?: string
			readonly name?: string
		}[]
	}
}
