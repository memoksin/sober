import { expect, test } from 'vitest'
import { AGENT_OPERATIONS, OPERATIONS } from './operation.js'

test('every state-changing operation is named once', () => {
	expect(new Set(OPERATIONS).size).toBe(OPERATIONS.length)
})

test('the catalogue carries the wire spelling, so a route can be named from it', () => {
	for (const operation of OPERATIONS) expect(operation, operation).toMatch(/^[a-z]+(_[a-z]+)*$/)
})

test('the catalogue is what PR-09-08 binds, so growing it is visible in review', () => {
	expect([...OPERATIONS].sort()).toMatchSnapshot()
})

test('editing an answered decision waits for the session that wires all three surfaces', () => {
	expect(OPERATIONS).not.toContain('edit_decision')
})

test('accepting every green node is batching, not a state change of its own', () => {
	expect(OPERATIONS).not.toContain('accept_green')
})

test('reading is not in the catalogue — a surface may read in its own shape', () => {
	for (const read of ['board', 'projection', 'decisions', 'logs', 'review', 'digest']) {
		expect(OPERATIONS, read).not.toContain(read)
	}
})

test('what an agent authors is a second list, because a terminal has no agent', () => {
	expect(AGENT_OPERATIONS).toContain('propose')
	expect(AGENT_OPERATIONS).toContain('open_decision')
	for (const authored of AGENT_OPERATIONS) expect(OPERATIONS, authored).not.toContain(authored)
})

test('the two lists never name the same operation twice', () => {
	const all = [...OPERATIONS, ...AGENT_OPERATIONS]
	expect(new Set(all).size).toBe(all.length)
})
