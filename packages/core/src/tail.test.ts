import { expect, test } from 'vitest'
import { tail } from './tail.js'

const log = (...events: unknown[]): string => events.map((e) => JSON.stringify(e)).join('\n')

test('an event type the tail does not know is dropped, not shown', () => {
	// The allowlist is the point: a host adds event types between releases, and
	// a denylist puts every new one in front of the user the day it ships.
	const rendered = tail(
		log(
			{ type: 'system', subtype: 'hook_started', hook: 'noise' },
			{ type: 'rate_limit_event', limit: 1 },
			{ type: 'system', subtype: 'init' },
		),
	)
	expect(rendered).toEqual([{ kind: 'started', text: 'session started' }])
})

test('an assistant turn renders its text, and a tool call renders the tool', () => {
	const rendered = tail(
		log(
			{ type: 'assistant', message: { content: [{ type: 'text', text: '  wrote the file  ' }] } },
			{ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit' }] } },
		),
	)
	expect(rendered).toEqual([
		{ kind: 'text', text: 'wrote the file' },
		{ kind: 'tool', text: 'Edit' },
	])
})

test('a failing result says so, where the last line is what a reader looks at', () => {
	const rendered = tail(log({ type: 'result', subtype: 'error_during_execution', is_error: true }))
	expect(rendered.at(-1)).toEqual({ kind: 'result', text: 'failed: error_during_execution' })
})

test('a line that is not JSON is the host’s own stderr, and it is never hidden', () => {
	// The one thing a failing run always has, and the last thing to drop.
	expect(tail('claude: command not found\n')).toEqual([
		{ kind: 'raw', text: 'claude: command not found' },
	])
})

test('an empty log renders nothing rather than a blank line', () => {
	expect(tail('')).toEqual([])
	expect(tail('\n\n')).toEqual([])
})
