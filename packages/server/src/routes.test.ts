import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { currentBranch, paths } from '@besober/core'
import { AGENT_OPERATIONS, OPERATIONS } from '@besober/schema'
import { afterEach, expect, test } from 'vitest'
import { COVERS, GAPS, OPS, READS, WATCHES } from './routes.js'

const ROUTED = OPERATIONS.filter((operation) => !(GAPS as readonly string[]).includes(operation))

test('every operation PR-09-08 binds has a route, unless it is a declared gap', () => {
	for (const operation of ROUTED) expect(Object.keys(OPS), operation).toContain(operation)
})

test('the server routes nothing the catalogue does not name', () => {
	for (const routed of Object.keys(OPS)) expect(OPERATIONS, routed).toContain(routed)
})

test('what the server covers is the route table itself, so its manifest cannot drift', () => {
	expect([...COVERS].sort()).toEqual([...ROUTED].sort())
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
		'distance',
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

// The dashboard's `sync` and `resolve` never take a branch — a body that
// names one is exactly the hole that let f2592f9 land a board-only tree on
// `development`, so the schema now refuses it outright.
test('sync and resolve refuse a body that names a branch', () => {
	expect(() => OPS.sync.accepts.parse({ branch: 'main' })).toThrow()
	expect(() =>
		OPS.resolve.accepts.parse({ branch: 'main', record: 'some-node', choices: {} }),
	).toThrow()
})

let dir: string | undefined

afterEach(() => {
	if (dir !== undefined) rmSync(dir, { recursive: true, force: true, maxRetries: 10 })
	dir = undefined
})

test('sync run with no branch lands on the configured board branch, never the checked-out one', async () => {
	dir = mkdtempSync(join(tmpdir(), 'sober-routes-it-'))
	const run = (...args: string[]) =>
		execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim()
	run('init', '--initial-branch=main')
	run('config', 'user.name', 'SOBER Test')
	run('config', 'user.email', 'test@besober.dev')
	run('config', 'commit.gpgsign', 'false')
	writeFileSync(join(dir, 'README.md'), '# acme\n')
	run('add', '-A')
	run('commit', '-m', 'chore: first')

	const p = paths(dir)
	await OPS.init.run(p, { project: { title: 'acme', intent: '', constraints: [] } })
	const before = run('rev-parse', 'main')

	await OPS.sync.run(p, {})

	expect(run('rev-parse', 'main')).toBe(before)
	expect(await currentBranch(dir)).toBe('main')
	expect(run('log', 'sober-graph', '-1', '--format=%s')).toContain('sober: board from')
})

test('the board read carries thinkingVerbs — the default pool absent, the configured one set, null when the config is broken', async () => {
	dir = mkdtempSync(join(tmpdir(), 'sober-routes-it-'))
	const run = (...args: string[]) =>
		execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim()
	run('init', '--initial-branch=main')
	run('config', 'user.name', 'SOBER Test')
	run('config', 'user.email', 'test@besober.dev')
	run('config', 'commit.gpgsign', 'false')
	writeFileSync(join(dir, 'README.md'), '# acme\n')
	run('add', '-A')
	run('commit', '-m', 'chore: first')

	const p = paths(dir)
	await OPS.init.run(p, { project: { title: 'acme', intent: '', constraints: [] } })

	const withoutConfig = await READS.board.run(p, {})
	expect((withoutConfig as { thinkingVerbs: unknown }).thinkingVerbs).toEqual({
		mode: 'extend',
		words: [],
	})

	writeFileSync(
		p.config,
		JSON.stringify({ dashboard: { thinkingVerbs: { mode: 'extend', words: ['Vibing'] } } }),
	)
	const withConfig = await READS.board.run(p, {})
	expect((withConfig as { thinkingVerbs: unknown }).thinkingVerbs).toEqual({
		mode: 'extend',
		words: ['Vibing'],
	})

	writeFileSync(p.config, '{ not valid json')
	const withBrokenConfig = await READS.board.run(p, {})
	expect((withBrokenConfig as { thinkingVerbs: unknown }).thinkingVerbs).toBeNull()
})
