import { AGENT_OPERATIONS, OPERATIONS } from '@besober/schema'
import { expect, test } from 'vitest'
import { COVERS, OPS, READS } from './routes.js'

test('every operation PR-09-08 binds has a route', () => {
	for (const operation of OPERATIONS) expect(Object.keys(OPS), operation).toContain(operation)
})

test('the server routes nothing the catalogue does not name', () => {
	for (const routed of Object.keys(OPS)) expect(OPERATIONS, routed).toContain(routed)
})

test('what the server covers is the route table itself, so its manifest cannot drift', () => {
	expect([...COVERS].sort()).toEqual([...OPERATIONS].sort())
})

test('every route says what it accepts, so a body is parsed before core sees it', () => {
	for (const [operation, route] of Object.entries(OPS)) {
		expect(route.accepts, operation).toBeDefined()
		expect(typeof route.run, operation).toBe('function')
	}
})

test('planning is not routed — M3 has no planning screen', () => {
	for (const authored of AGENT_OPERATIONS)
		expect(Object.keys(OPS), authored).not.toContain(authored)
})

test('a read is never spelled like an operation', () => {
	for (const read of Object.keys(READS)) expect(OPERATIONS, read).not.toContain(read)
})

test('S1 ships the three reads the hand-drive needs, and no speculative fourth', () => {
	expect(Object.keys(READS).sort()).toEqual(['board', 'projection', 'review'])
})

test.each(Object.keys(OPS))('%s refuses a body that is not its shape', async (operation) => {
	const route = OPS[operation as keyof typeof OPS]

	// Every route, not a sample. These handlers are thin, and thin is exactly
	// how a wrong field name reaches the screen unnoticed: the parse is the
	// only thing standing between a typo and `core`.
	await expect(route.run({} as never, { definitely: 'not the shape' })).rejects.toThrow()
})

test.each(Object.keys(READS))('the %s read refuses a query that is not its shape', async (name) => {
	const route = READS[name] as (typeof READS)[string]

	await expect(route.run({} as never, { definitely: 'not the shape' })).rejects.toThrow()
})

test('a route refuses a body it cannot parse rather than handing it to core', async () => {
	const archive = OPS.archive

	await expect(archive.run({} as never, { nothing: true })).rejects.toThrow()
})
