import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { claudeModels, codexModels, installed, openRouterModels } from './models.js'

let home: string | undefined
afterEach(() => {
	if (home !== undefined) rmSync(home, { recursive: true, force: true })
})

test('the Claude family is a fixed list on the claude line', () => {
	const found = claudeModels()
	expect(found.map((m) => m.name)).toEqual(['fable', 'opus', 'sonnet', 'haiku'])
	expect(found[0]).toMatchObject({
		run: 'claude --model claude-fable-5-1',
		host: 'claude',
		free: false,
	})
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
			free: false,
		},
		{
			name: 'qwen3.8-27b',
			run: 'openrouter --model qwen/qwen3.8-27b:free',
			about: 'Qwen.',
			host: 'openrouter',
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
