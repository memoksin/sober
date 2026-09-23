import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { DEFAULT_CONFIG } from './config.js'
import {
	candidatesFor,
	type Candidate,
	claudeModels,
	codexModels,
	installed,
	liveModels,
	openRouterModels,
} from './models.js'
import { paths } from './paths.js'
import { tmpRoot } from './tmp.fixture.js'

let home: string | undefined
afterEach(() => {
	if (home !== undefined) rmSync(home, { recursive: true, force: true })
})

test('the Claude family is a fixed list of aliases, on the claude line', () => {
	const found = claudeModels()
	expect(found.map((m) => m.name)).toEqual(['opus', 'sonnet', 'haiku', 'fable'])
	expect(found[0]).toMatchObject({
		run: 'claude --model opus',
		id: 'opus',
		host: 'claude',
		free: false,
	})
	// Fable has no alias yet, so its id is still the dated one.
	expect(found.at(-1)).toMatchObject({ run: 'claude --model claude-fable-5-1' })
})

test('codex models come from its own cache, listed ones only, and none without a cache', async () => {
	home = mkdtempSync(join(tmpdir(), 'sober-home-'))
	expect(await codexModels(home)).toEqual([])

	mkdirSync(join(home, '.codex'))
	writeFileSync(
		join(home, '.codex', 'models_cache.json'),
		JSON.stringify({
			models: [
				{ slug: 'gpt-6-astra', description: 'Most capable.', visibility: 'list' },
				{ slug: 'codex-auto-review', description: 'Internal.', visibility: 'hide' },
			],
		}),
	)
	expect(await codexModels(home)).toEqual([
		{
			name: 'gpt-6-astra',
			run: 'codex --model gpt-6-astra',
			about: 'Most capable.',
			host: 'codex',
			id: 'gpt-6-astra',
			free: false,
		},
	])
})

test('OpenRouter models are text-out only, named without the vendor, and free when both prices are zero', async () => {
	const fetchFn = (async () =>
		new Response(
			JSON.stringify({
				data: [
					{
						id: 'qwen/qwen3.8-27b:free',
						description: 'Qwen. Second sentence.',
						pricing: { prompt: '0', completion: '0' },
						architecture: { output_modalities: ['text'] },
					},
					{
						id: 'google/lyria-3',
						description: 'Audio.',
						pricing: { prompt: '0', completion: '0' },
						architecture: { output_modalities: ['audio'] },
					},
					{
						id: 'anthropic/claude-opus-5',
						description: 'Opus.',
						pricing: { prompt: '0.000015', completion: '0.000075' },
					},
				],
			}),
		)) as unknown as typeof fetch

	const found = await openRouterModels(fetchFn)

	expect(found).toEqual([
		{
			name: 'claude-opus-5',
			run: 'openrouter --model anthropic/claude-opus-5',
			about: 'Opus.',
			host: 'openrouter',
			id: 'anthropic/claude-opus-5',
			free: false,
		},
		{
			name: 'qwen3.8-27b',
			run: 'openrouter --model qwen/qwen3.8-27b:free',
			about: 'Qwen.',
			host: 'openrouter',
			id: 'qwen/qwen3.8-27b:free',
			free: true,
		},
	])
})

test('an OpenRouter refusal is an error with its status', async () => {
	const fetchFn = (async () => new Response('', { status: 503 })) as unknown as typeof fetch
	await expect(openRouterModels(fetchFn)).rejects.toThrow(/503/)
})

test('a cache that cannot be read for any other reason is an error, not an empty list', async () => {
	home = mkdtempSync(join(tmpdir(), 'sober-codex-'))
	// A directory where the file should be: EISDIR, which is not "not opened yet".
	mkdirSync(join(home, '.codex', 'models_cache.json'), { recursive: true })
	await expect(codexModels(home)).rejects.toThrow(/EISDIR/)
})

test('installed looks for an executable on the given PATH', () => {
	home = mkdtempSync(join(tmpdir(), 'sober-path-'))
	writeFileSync(join(home, 'present'), '#!/bin/sh\n')
	chmodSync(join(home, 'present'), 0o755)
	writeFileSync(join(home, 'plain'), '')
	expect(installed('present', home)).toBe(true)
	expect(installed('plain', home)).toBe(false)
	expect(installed('absent', home)).toBe(false)
})

const cand = (host: Candidate['host'], id: string, free = false): Candidate => ({
	name: id,
	run: `${host} --model ${id}`,
	about: '',
	host,
	id,
	free,
})

test('candidatesFor keeps only what a range covers, narrowed by only/deny globs', () => {
	const dispatch = {
		...DEFAULT_CONFIG.dispatch,
		sources: { openrouter: { complexity: [1, 3] as [number, number], only: ['*:free'] } },
	}
	const catalogue = [cand('openrouter', 'org/a:free', true), cand('openrouter', 'org/b', false)]
	const built = candidatesFor(dispatch, { claude: [], codex: [], openrouter: catalogue })
	expect(built.models).toEqual([
		{ name: 'org/a:free', run: 'openrouter --model org/a:free', complexity: [1, 3], about: '' },
	])
	expect(built.dropped).toEqual([])
})

test('candidatesFor drops what deny matches', () => {
	const dispatch = {
		...DEFAULT_CONFIG.dispatch,
		sources: { openrouter: { complexity: [1, 3] as [number, number], deny: ['*:free'] } },
	}
	const catalogue = [cand('openrouter', 'org/a:free', true), cand('openrouter', 'org/b', false)]
	const built = candidatesFor(dispatch, { claude: [], codex: [], openrouter: catalogue })
	expect(built.models.map((m) => m.name)).toEqual(['org/b'])
})

test('a source not named in dispatch.sources contributes nothing', () => {
	const dispatch = { ...DEFAULT_CONFIG.dispatch }
	const catalogue = [cand('openrouter', 'org/a:free', true)]
	const built = candidatesFor(dispatch, { claude: [], codex: [], openrouter: catalogue })
	expect(built).toEqual({ models: [], dropped: [] })
})

test('a pin wins a name clash with a discovered entry', () => {
	const dispatch = {
		...DEFAULT_CONFIG.dispatch,
		models: [
			{ name: 'free', run: 'claude --model opus', complexity: [1, 3] as [number, number], about: 'pinned' },
		],
		sources: { openrouter: { complexity: [1, 3] as [number, number] } },
	}
	const catalogue = [{ ...cand('openrouter', 'org/free:free', true), name: 'free' }]
	const built = candidatesFor(dispatch, { claude: [], codex: [], openrouter: catalogue })
	expect(built.models).toEqual(dispatch.models)
	expect(built.dropped).toEqual(['free: clashes with an earlier entry, dropped'])
})

test('two discovered entries sharing a name: the later source loses', () => {
	const dispatch = {
		...DEFAULT_CONFIG.dispatch,
		sources: {
			codex: { complexity: [4, 7] as [number, number] },
			openrouter: { complexity: [1, 3] as [number, number] },
		},
	}
	const built = candidatesFor(dispatch, {
		claude: [],
		codex: [{ ...cand('codex', 'dup'), name: 'dup' }],
		openrouter: [{ ...cand('openrouter', 'org/dup:free', true), name: 'dup' }],
	})
	expect(built.models.map((m) => m.run)).toEqual(['codex --model dup'])
	expect(built.dropped).toEqual(['dup: clashes with an earlier entry, dropped'])
})

test('a codex or openrouter pin missing from a reachable catalogue is dropped, retired', () => {
	const dispatch = {
		...DEFAULT_CONFIG.dispatch,
		models: [
			{ name: 'old', run: 'codex --model gpt-5-old', complexity: [4, 7] as [number, number], about: '' },
		],
	}
	const built = candidatesFor(dispatch, { claude: [], codex: [], openrouter: [] })
	expect(built).toEqual({ models: [], dropped: ['old: pinned but retired from codex'] })
})

test('a pin on a source this dispatch could not reach is kept, unchecked', () => {
	const dispatch = {
		...DEFAULT_CONFIG.dispatch,
		models: [
			{ name: 'old', run: 'codex --model gpt-5-old', complexity: [4, 7] as [number, number], about: '' },
		],
	}
	const built = candidatesFor(dispatch, { claude: [], codex: null, openrouter: [] })
	expect(built).toEqual({ models: dispatch.models, dropped: [] })
})

test('a claude pin is always kept, whatever the claude catalogue holds', () => {
	const dispatch = {
		...DEFAULT_CONFIG.dispatch,
		models: [
			{
				name: 'made-up',
				run: 'claude --model nonexistent',
				complexity: [1, 3] as [number, number],
				about: '',
			},
		],
	}
	const built = candidatesFor(dispatch, { claude: [], codex: [], openrouter: [] })
	expect(built).toEqual({ models: dispatch.models, dropped: [] })
})

test('no dispatch.sources named means liveModels fetches nothing', async () => {
	const root = await tmpRoot('sober-live-')
	const fetchFn = vi.fn()
	const built = await liveModels(paths(root), DEFAULT_CONFIG.dispatch, {
		fetch: fetchFn as unknown as typeof fetch,
	})
	expect(built).toEqual({ models: [], dropped: [] })
	expect(fetchFn).not.toHaveBeenCalled()
})

test('liveModels reuses a fresh cache and refetches once it is stale', async () => {
	const root = await tmpRoot('sober-live-')
	const p = paths(root)
	const dispatch = {
		...DEFAULT_CONFIG.dispatch,
		catalogueSeconds: 60,
		sources: { openrouter: { complexity: [1, 3] as [number, number] } },
	}
	let now = 1_000_000
	let version = 'a'
	const fetchFn = (async () =>
		new Response(
			JSON.stringify({
				data: [
					{
						id: `org/${version}:free`,
						description: '',
						pricing: { prompt: '0', completion: '0' },
						architecture: { output_modalities: ['text'] },
					},
				],
			}),
		)) as unknown as typeof fetch

	const first = await liveModels(p, dispatch, { fetch: fetchFn, now: () => now })
	expect(first.models.map((m) => m.run)).toEqual(['openrouter --model org/a:free'])

	version = 'b'
	now += 30_000
	const second = await liveModels(p, dispatch, { fetch: fetchFn, now: () => now })
	expect(second.models.map((m) => m.run)).toEqual(['openrouter --model org/a:free'])

	now += 40_000
	const third = await liveModels(p, dispatch, { fetch: fetchFn, now: () => now })
	expect(third.models.map((m) => m.run)).toEqual(['openrouter --model org/b:free'])
})

test('a fetch failure is logged, never thrown, and that source is treated as unreachable', async () => {
	const root = await tmpRoot('sober-live-')
	const dispatch = {
		...DEFAULT_CONFIG.dispatch,
		models: [
			{
				name: 'pinned',
				run: 'openrouter --model org/x:free',
				complexity: [1, 3] as [number, number],
				about: '',
			},
		],
		sources: { openrouter: { complexity: [1, 3] as [number, number] } },
	}
	const fetchFn = (async () => new Response('', { status: 503 })) as unknown as typeof fetch
	const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

	const built = await liveModels(paths(root), dispatch, { fetch: fetchFn })

	expect(built).toEqual({ models: dispatch.models, dropped: [] })
	expect(spy).toHaveBeenCalledOnce()
	spy.mockRestore()
})
