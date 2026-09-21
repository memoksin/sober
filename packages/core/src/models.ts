import { accessSync, constants } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import type { Model } from './config.js'

/**
 * What `dispatch.models` could name, gathered from where each host already
 * keeps its list — so nobody types a model id from memory (ADR 0061). Three
 * sources, none needing a key:
 *
 * - Claude Code has no list command; the family is short and written here.
 * - Codex caches the list its login can see in `~/.codex/models_cache.json`.
 * - OpenRouter publishes its catalogue at `/api/v1/models`, and opencode is
 *   the host that reaches it.
 *
 * Each candidate is a config entry short of its range: the range is a budget
 * decision, and this only says what exists.
 */
export interface Candidate extends Omit<Model, 'complexity'> {
	readonly host: 'claude' | 'codex' | 'opencode'
	readonly free: boolean
}

/** On the PATH and executable — not logged in, which is `checkHost`'s question. */
export const installed = (command: string, path = process.env.PATH ?? ''): boolean =>
	path.split(delimiter).some((dir) => {
		try {
			accessSync(join(dir, command), constants.X_OK)
			return true
		} catch {
			return false
		}
	})

/** ponytail: a fixed list, because the CLI has none to ask; update when the family does. */
const CLAUDE: readonly (readonly [string, string, string])[] = [
	['fable', 'claude-fable-5-1', 'Claude Fable 5.1. The strongest Claude.'],
	['opus', 'claude-opus-5', 'Claude Opus 5. Deep reasoning.'],
	['sonnet', 'claude-sonnet-5', 'Claude Sonnet 5. Balanced.'],
	['haiku', 'claude-haiku-4-5-20251001', 'Claude Haiku 4.5. Fastest and cheapest Claude.'],
]

export const claudeModels = (): Candidate[] =>
	CLAUDE.map(([name, id, about]) => ({
		name,
		run: `claude --model ${id}`,
		about,
		host: 'claude',
		free: false,
	}))

/** The cache is Codex's own; a missing one means Codex has not been opened here. */
export const codexModels = async (home = homedir()): Promise<Candidate[]> => {
	let text: string
	try {
		text = await readFile(join(home, '.codex', 'models_cache.json'), 'utf8')
	} catch (error) {
		if ((error as { code?: string }).code === 'ENOENT') return []
		throw error
	}
	const parsed = JSON.parse(text) as {
		models?: { slug?: string; description?: string; visibility?: string }[]
	}
	return (parsed.models ?? [])
		.filter((m) => m.visibility === 'list' && typeof m.slug === 'string')
		.map((m) => ({
			name: m.slug as string,
			run: `codex --model ${m.slug}`,
			about: m.description ?? '',
			host: 'codex',
			free: false,
		}))
}

interface OpenRouterModel {
	readonly id: string
	readonly description?: string
	readonly pricing?: { readonly prompt?: string; readonly completion?: string }
	readonly architecture?: { readonly output_modalities?: readonly string[] }
}

/** Text-out models only: an image or audio model is not something a node runs on. */
export const openRouterModels = async (fetchFn: typeof fetch = fetch): Promise<Candidate[]> => {
	const response = await fetchFn('https://openrouter.ai/api/v1/models')
	if (!response.ok) throw new Error(`OpenRouter answered ${response.status}`)
	const { data } = (await response.json()) as { data: OpenRouterModel[] }
	return [...data]
		.sort((a, b) => a.id.localeCompare(b.id))
		.filter((m) => {
			const out = m.architecture?.output_modalities
			return out === undefined || (out.length === 1 && out[0] === 'text')
		})
		.map((m) => ({
			name: m.id.replace(/^.*\//, '').replace(/:free$/, ''),
			run: `opencode --model openrouter/${m.id}`,
			about: (m.description ?? '').split(/(?<=\.)\s/)[0] ?? '',
			host: 'opencode',
			free: m.pricing?.prompt === '0' && m.pricing?.completion === '0',
		}))
}
