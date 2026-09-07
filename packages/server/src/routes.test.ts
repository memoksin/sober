import { AGENT_OPERATIONS, OPERATIONS } from '@besober/schema'
import { expect, test } from 'vitest'
import { COVERS, OPS, READS, WATCHES } from './routes.js'

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

test('every read a screen asked for, and no speculative seventh', () => {
	// The digest is the fourth, the impact preview the fifth and the waiting
	// distribution the sixth, and each was written when its screen asked for it
	// rather than beside the first three — which is the property this guards.
	expect(Object.keys(READS).sort()).toEqual([
		'board',
		'digest',
		'distribution',
		'impact',
		'projection',
		'review',
	])
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

test('the log is watched, not read, so no sixth read appears beside the first five', () => {
	// ADR 0036 named the run log as the one place polling is the wrong shape,
	// and ADR 0046 built the channel rather than a sixth `READS` entry. This is
	// the assertion that keeps the two from quietly becoming the same thing.
	expect(Object.keys(READS)).not.toContain('logs')
	expect(Object.keys(WATCHES)).toEqual(['logs'])
})

test('a watch says what it accepts, so a query is parsed before core sees it', () => {
	for (const [name, route] of Object.entries(WATCHES)) {
		expect(route.accepts, name).toBeDefined()
		expect(typeof route.open, name).toBe('function')
	}
})

test.each(Object.keys(WATCHES))('the %s watch refuses a query that is not its shape', (name) => {
	const route = WATCHES[name] as (typeof WATCHES)[string]

	expect(() => route.accepts.parse({ definitely: 'not the shape' })).toThrow()
})

test('a watch is never spelled like an operation or a read', () => {
	for (const watched of Object.keys(WATCHES)) {
		expect(OPERATIONS, watched).not.toContain(watched)
		expect(Object.keys(READS), watched).not.toContain(watched)
	}
})
