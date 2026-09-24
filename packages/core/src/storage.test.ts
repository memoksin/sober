import { readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Node, SCHEMA_VERSION } from '@besober/schema'
import { beforeEach, expect, test } from 'vitest'
import { initBoard } from './board.js'
import {
	DEFAULT_CONFIG,
	hostForTier,
	modelForScore,
	modelsFor,
	parseConfig,
	readConfig,
	setSetting,
	tierFor,
} from './config.js'
import { findRoot, paths, recordFile } from './paths.js'
import { readRecord, readRecords } from './read.js'
import { readNodes, readProject, writeNode } from './records.js'
import { tmpRoot } from './tmp.fixture.js'
import { writeRecord } from './write.js'

let root: string

const node = (title: string) => ({
	title,
	name: title,
	description: '',
	notes: '',
	dependsOn: [],
	decisions: [],
	files: [],
	brief: null,
	outcome: null,
	assignee: null,
	claim: null,
	accepted: null,
	dismissal: null,
	createdAt: '2026-09-04T00:00:00.000Z',
})

beforeEach(async () => {
	root = await tmpRoot('sober-storage-')
})

test('init creates a board, and running it again leaves it alone', async () => {
	const first = await initBoard(root, { title: 'SOBER', intent: 'ship', constraints: [] })
	expect(first.created).toBe(true)

	const project = await readProject(first.paths)
	expect(project).toMatchObject({
		kind: 'ok',
		value: { title: 'SOBER', schemaVersion: SCHEMA_VERSION },
	})

	const second = await initBoard(root, { title: 'Something else', intent: '', constraints: [] })
	expect(second.created).toBe(false)
	expect(await readProject(second.paths)).toMatchObject({ value: { title: 'SOBER' } })
})

test('init gitignores the board and keeps config.jsonc tracked', async () => {
	await writeFile(join(root, '.gitignore'), 'node_modules\n')
	await initBoard(root, { title: 'SOBER', intent: '', constraints: [] })

	const ignore = await readFile(join(root, '.gitignore'), 'utf8')
	expect(ignore).toContain('node_modules')
	expect(ignore).toContain('.sober/*')
	expect(ignore).toContain('!.sober/config.jsonc')
})

test('findRoot walks up from anywhere inside the repository', async () => {
	await initBoard(root, { title: 'SOBER', intent: '', constraints: [] })

	expect(findRoot(join(root, 'packages', 'core', 'src'))).toBe(root)
	expect(findRoot(tmpdir())).toBe(null)
})

test('a record that will not parse is named, and the rest of the board still loads', async () => {
	const { paths: p } = await initBoard(root, { title: 'SOBER', intent: '', constraints: [] })
	await writeNode(p, 'good-node-a1b2', node('Good'))
	await writeFile(recordFile(p.nodes, 'torn-node-c3d4'), '{ "title": ')
	await writeFile(recordFile(p.nodes, 'wrong-node-e5f6'), '{ "title": 42 }')

	const { records, broken } = await readNodes(p)

	expect([...records.keys()]).toEqual(['good-node-a1b2'])
	expect(broken.map((entry) => entry.file)).toEqual([
		recordFile(p.nodes, 'torn-node-c3d4'),
		recordFile(p.nodes, 'wrong-node-e5f6'),
	])
	expect(broken[1]?.reason).toContain('title')
})

/**
 * §8.4 covers a file that will not parse. These two are the step before it: a
 * path that cannot be read at all, and a directory that is not one.
 *
 * They are told apart on purpose. A record that is missing is a fact the board
 * lives with every day; a record that is there and unreadable is a finding. A
 * records directory that is a file is neither — it is a broken installation,
 * and reporting it as an empty board would put a person in front of a graph
 * with nothing on it and no reason given.
 */
test('a record path that cannot be read at all is a finding, not a missing record', async () => {
	const { paths: p } = await initBoard(root, { title: 'SOBER', intent: '', constraints: [] })

	const read = await readRecord(p.nodes, Node)

	expect(read.kind).toBe('broken')
	expect(read.kind === 'broken' && read.reason).toBeTruthy()
})

test('a records directory that is a file is loud, rather than an empty board', async () => {
	const { paths: p } = await initBoard(root, { title: 'SOBER', intent: '', constraints: [] })

	await expect(readRecords(p.project, Node)).rejects.toThrow()
})

test('a write leaves no temp file behind', async () => {
	const p = paths(root)
	await writeRecord(recordFile(p.nodes, 'a-node-a1b2'), node('A'))

	expect(await readdir(p.nodes)).toEqual(['a-node-a1b2.json'])
})

test('a missing config is the defaults', async () => {
	expect(await readConfig(paths(root))).toEqual({ kind: 'ok', value: DEFAULT_CONFIG })
})

test('the config init writes parses back to the defaults', async () => {
	const { paths: p } = await initBoard(root, { title: 'SOBER', intent: '', constraints: [] })

	expect(await readConfig(p)).toEqual({ kind: 'ok', value: DEFAULT_CONFIG })
})

test('dispatch.base parses, and a file without it targets nothing', () => {
	expect(parseConfig('c', '{ "dispatch": { "base": "development" } }')).toMatchObject({
		kind: 'ok',
		value: { dispatch: { base: 'development' } },
	})
	expect(parseConfig('c', '{ "dispatch": {} }')).toMatchObject({
		value: { dispatch: { base: null } },
	})
})

test('a setting missing from the file is the default, and an unknown one is reported', async () => {
	expect(parseConfig('c', '{ "dispatch": { "concurrency": 1 } }')).toEqual({
		kind: 'ok',
		value: { ...DEFAULT_CONFIG, dispatch: { ...DEFAULT_CONFIG.dispatch, concurrency: 1 } },
	})
	expect(parseConfig('c', '{ "dispatch": { "conccurency": 1 } }')).toMatchObject({ kind: 'broken' })
	expect(parseConfig('c', '{ "dispatch": ')).toMatchObject({
		kind: 'broken',
		reason: 'not valid JSONC',
	})
})

// The trap in DESIGN §1.3: JSON.stringify would delete every comment.
test('editing a setting keeps the comments around it', async () => {
	const { paths: p } = await initBoard(root, { title: 'SOBER', intent: '', constraints: [] })
	const before = await readFile(p.config, 'utf8')

	const after = setSetting(before, ['dispatch', 'concurrency'], 1)

	expect(after).toContain('// How many runs may burn at once.')
	expect(after).toContain('"concurrency": 1')
	expect(parseConfig(p.config, after)).toMatchObject({ value: { dispatch: { concurrency: 1 } } })
})

test('a partial tiers table parses, and the missing tiers are null', () => {
	expect(
		parseConfig('c', '{ "dispatch": { "tiers": { "low": "opencode --model minimax/m3-free" } } }'),
	).toMatchObject({
		kind: 'ok',
		value: {
			dispatch: { tiers: { high: null, mid: null, low: 'opencode --model minimax/m3-free' } },
		},
	})
})

test('thresholds out of order or out of range are broken, naming the path', () => {
	expect(parseConfig('c', '{ "dispatch": { "thresholds": { "mid": 5, "high": 5 } } }')).toEqual({
		kind: 'broken',
		file: 'c',
		reason: 'dispatch.thresholds: high must be above mid',
	})
	expect(
		parseConfig('c', '{ "dispatch": { "thresholds": { "mid": 4, "high": 11 } } }'),
	).toMatchObject({
		kind: 'broken',
		reason: expect.stringContaining('dispatch.thresholds.high'),
	})
})

test('jev mode is off and skill-less unless the config says otherwise', () => {
	expect(parseConfig('c', '{}')).toMatchObject({
		kind: 'ok',
		value: { dispatch: { jevMode: false, jevSkills: [] } },
	})
	expect(
		parseConfig('c', '{ "dispatch": { "jevMode": true, "jevSkills": ["ponytail"] } }'),
	).toMatchObject({
		kind: 'ok',
		value: { dispatch: { jevMode: true, jevSkills: ['ponytail'] } },
	})
})

test('the snake_case spelling of jevMode is broken, not silently ignored', () => {
	expect(parseConfig('c', '{ "dispatch": { "jev_mode": true } }')).toMatchObject({ kind: 'broken' })
})

test('thinkingVerbs is absent means the built-in pool, extend by default', () => {
	expect(parseConfig('c', '{}')).toMatchObject({
		kind: 'ok',
		value: { dashboard: { thinkingVerbs: { mode: 'extend', words: [] } } },
	})
})

test('thinkingVerbs extends or replaces the built-in pool', () => {
	expect(
		parseConfig(
			'c',
			'{ "dashboard": { "thinkingVerbs": { "mode": "extend", "words": ["Vibing"] } } }',
		),
	).toMatchObject({
		kind: 'ok',
		value: { dashboard: { thinkingVerbs: { mode: 'extend', words: ['Vibing'] } } },
	})
	expect(
		parseConfig(
			'c',
			'{ "dashboard": { "thinkingVerbs": { "mode": "replace", "words": ["Vibing"] } } }',
		),
	).toMatchObject({
		kind: 'ok',
		value: { dashboard: { thinkingVerbs: { mode: 'replace', words: ['Vibing'] } } },
	})
})

test('a thinkingVerbs word with a space is broken, naming the key', () => {
	expect(
		parseConfig('c', '{ "dashboard": { "thinkingVerbs": { "words": ["two words"] } } }'),
	).toMatchObject({
		kind: 'broken',
		reason: expect.stringContaining('dashboard.thinkingVerbs.words'),
	})
})

const MODELS = [
	{ name: 'free', run: 'opencode --model free', complexity: [1, 3] as [number, number], about: '' },
	{ name: 'codex', run: 'codex --model x', complexity: [3, 7] as [number, number], about: 'Fast.' },
	{ name: 'big', run: 'claude --model big', complexity: [8, 10] as [number, number], about: '' },
]

test('models default to none, parse with about defaulted, and refuse a bad range or a repeated name', () => {
	expect(parseConfig('c', '{}')).toMatchObject({ kind: 'ok', value: { dispatch: { models: [] } } })
	expect(
		parseConfig(
			'c',
			'{ "dispatch": { "models": [{ "name": "free", "run": "opencode --model free", "complexity": [1, 3] }] } }',
		),
	).toMatchObject({
		kind: 'ok',
		value: { dispatch: { models: [{ name: 'free', complexity: [1, 3], about: '' }] } },
	})
	expect(
		parseConfig(
			'c',
			'{ "dispatch": { "models": [{ "name": "a", "run": "x", "complexity": [5, 2] }] } }',
		),
	).toMatchObject({
		kind: 'broken',
		reason: expect.stringContaining('dispatch.models.0.complexity'),
	})
	expect(
		parseConfig(
			'c',
			'{ "dispatch": { "models": [{ "name": "a", "run": "x", "complexity": [1, 2] }, { "name": "a", "run": "y", "complexity": [3, 4] }] } }',
		),
	).toMatchObject({ kind: 'broken', reason: expect.stringContaining('unique') })
})

test('dispatch.sources defaults to none, parses per-source, and refuses a bad range', () => {
	expect(parseConfig('c', '{}')).toMatchObject({
		kind: 'ok',
		value: { dispatch: { sources: {}, catalogueSeconds: 3600 } },
	})
	expect(
		parseConfig(
			'c',
			'{ "dispatch": { "sources": { "openrouter": { "complexity": [1, 3], "only": ["*:free"] }, "codex": { "complexity": [4, 10], "deny": ["*astra*"] } } } }',
		),
	).toMatchObject({
		kind: 'ok',
		value: {
			dispatch: {
				sources: {
					openrouter: { complexity: [1, 3], only: ['*:free'] },
					codex: { complexity: [4, 10], deny: ['*astra*'] },
				},
			},
		},
	})
	expect(
		parseConfig('c', '{ "dispatch": { "sources": { "claude": { "complexity": [5, 2] } } } }'),
	).toMatchObject({
		kind: 'broken',
		reason: expect.stringContaining('dispatch.sources.claude.complexity'),
	})
})

test('dispatch.catalogueSeconds parses and defaults to an hour', () => {
	expect(parseConfig('c', '{ "dispatch": { "catalogueSeconds": 60 } }')).toMatchObject({
		kind: 'ok',
		value: { dispatch: { catalogueSeconds: 60 } },
	})
})

test('dispatch.probeSeconds parses and defaults to fifteen minutes', () => {
	expect(parseConfig('c', '{}')).toMatchObject({
		kind: 'ok',
		value: { dispatch: { probeSeconds: 900 } },
	})
	expect(parseConfig('c', '{ "dispatch": { "probeSeconds": 60 } }')).toMatchObject({
		kind: 'ok',
		value: { dispatch: { probeSeconds: 60 } },
	})
})

test('modelsFor keeps the list order where ranges overlap', () => {
	expect(modelsFor(MODELS, 3).map((m) => m.name)).toEqual(['free', 'codex'])
	expect(modelsFor(MODELS, 7).map((m) => m.name)).toEqual(['codex'])
	expect(modelsFor(MODELS, 5).map((m) => m.name)).toEqual(['codex'])
})

test('modelForScore runs the first cover, falls back when none covers, and never for an unscored node', () => {
	const dispatch = { ...DEFAULT_CONFIG.dispatch, models: MODELS }
	expect(modelForScore(dispatch, 3)).toEqual({
		host: 'opencode --model free',
		chose: 'free',
		fallback: false,
	})
	expect(modelForScore(dispatch, 10)).toEqual({
		host: 'claude --model big',
		chose: 'big',
		fallback: false,
	})
	expect(modelForScore({ ...dispatch, models: MODELS.slice(0, 2) }, 9)).toEqual({
		host: 'claude',
		chose: null,
		fallback: true,
	})
	expect(modelForScore(dispatch, null)).toEqual({ host: 'claude', chose: null, fallback: false })
})

test('tierFor splits complexity at the thresholds', () => {
	const t = DEFAULT_CONFIG.dispatch.thresholds
	expect([tierFor(t, 8), tierFor(t, 4), tierFor(t, 3), tierFor(t, null)]).toEqual([
		'high',
		'mid',
		'low',
		null,
	])
})

test('hostForTier falls back to dispatch.host when a tier names nothing', () => {
	const dispatch = {
		...DEFAULT_CONFIG.dispatch,
		tiers: { high: 'claude --model x', mid: null, low: null },
	}
	expect(hostForTier(dispatch, 'high')).toEqual({ host: 'claude --model x', fallback: false })
	expect(hostForTier(dispatch, 'low')).toEqual({ host: 'claude', fallback: true })
})

test('editing a tier keeps the comment above it', async () => {
	const { paths: p } = await initBoard(root, { title: 'SOBER', intent: '', constraints: [] })
	const after = setSetting(await readFile(p.config, 'utf8'), ['dispatch', 'tiers', 'low'], 'codex')

	expect(after).toContain('// A tier is how hard')
	expect(parseConfig(p.config, after)).toMatchObject({
		value: { dispatch: { tiers: { low: 'codex' } } },
	})
})
