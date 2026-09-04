/**
 * The run log holds the host's raw output (§5.5) — machine-facing, like every
 * internal format (`PR-09-03`). This renders it for the human watching a node
 * build (`PR-05-09`).
 *
 * It is an allowlist, not a denylist. A host adds event types between releases,
 * and a denylist turns every new one into noise in front of the user the day it
 * ships — which is exactly how a live tail becomes a thing nobody reads.
 */
export interface TailLine {
	readonly kind: 'started' | 'text' | 'tool' | 'result' | 'raw'
	readonly text: string
}

export const tail = (log: string): readonly TailLine[] =>
	log
		.split('\n')
		.filter((line) => line.trim().length > 0)
		.map(tailLine)
		.filter((line): line is TailLine => line !== null)

const tailLine = (line: string): TailLine | null => {
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
