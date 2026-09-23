import { accessSync, constants } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import type { Config, Model } from './config.js'
import { adapterFor } from './hosts.js'
import type { Paths } from './paths.js'
import { writeAtomic } from './write.js'

/**
 * What `dispatch.models` could name, gathered from where each host already
 * keeps its list — so nobody types a model id from memory (ADR 0061). Three
 * sources, none needing a key:
 *
 * - Claude Code has no list command; the family is short and written here.
 * - Codex caches the list its login can see in `~/.codex/models_cache.json`.
 * - OpenRouter publishes its catalogue at `/api/v1/models`; SOBER's own loop
 *   is the host that reaches it (ADR 0062).
 *
 * Each candidate is a config entry short of its range: the range is a budget
 * decision, and this only says what exists.
 */
export interface Candidate extends Omit<Model, 'complexity'> {
	readonly host: 'claude' | 'codex' | 'openrouter'
	/** The literal `--model` argument — what `only`/`deny` and a pin's id match against. */
	readonly id: string
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

/**
 * ponytail: a fixed list, because the CLI has none to ask. Each id is the
 * alias Claude Code itself resolves — `claude --model opus` — so this table
 * only changes when the family gains or drops a member, never on a release.
 * Fable has no alias yet, so its id is still the dated one.
 */
const CLAUDE: readonly (readonly [string, string, string])[] = [
	['opus', 'opus', 'Claude Opus. Deep reasoning.'],
	['sonnet', 'sonnet', 'Claude Sonnet. Balanced.'],
	['haiku', 'haiku', 'Claude Haiku. Fastest and cheapest Claude.'],
	['fable', 'claude-fable-5-1', 'Claude Fable. The strongest Claude.'],
]

export const claudeModels = (): Candidate[] =>
	CLAUDE.map(([name, id, about]) => ({
		name,
		run: `claude --model ${id}`,
		about,
		host: 'claude',
		id,
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
			id: m.slug as string,
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
			run: `openrouter --model ${m.id}`,
			about: (m.description ?? '').split(/(?<=\.)\s/)[0] ?? '',
			host: 'openrouter',
			id: m.id,
			free: m.pricing?.prompt === '0' && m.pricing?.completion === '0',
		}))
}

/** The `--model` argument on a run line, e.g. `codex --model gpt-6-astra` → `gpt-6-astra`. */
const modelIdOf = (run: string): string | null => {
	const parts = run.trim().split(/\s+/)
	const at = parts.indexOf('--model')
	return at === -1 ? null : (parts[at + 1] ?? null)
}

const escapeRegExp = (text: string): string => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&')

/** A `*`-only glob, matched against a whole id — `*:free` matches `qwen/qwen3-8b:free`. */
const globToRegExp = (pattern: string): RegExp =>
	new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`)

export interface Catalogues {
	readonly claude: readonly Candidate[]
	/** `null` when the source could not be reached this dispatch. */
	readonly codex: readonly Candidate[] | null
	readonly openrouter: readonly Candidate[] | null
}

export interface BuiltModels {
	readonly models: readonly Model[]
	/** One line per pin retired or discovered entry dropped to a name clash. */
	readonly dropped: readonly string[]
}

/**
 * `dispatch.models` filtered and topped up from what the named `dispatch.sources`
 * can reach right now (ADR 0063). Pure: `liveModels` below is what gathers
 * `catalogues`.
 *
 * Pins go first and win a name clash. A pin on `codex` or `openrouter` whose id
 * is absent from a *reachable* catalogue has been retired and is dropped; a
 * claude pin, or a pin on a source this dispatch could not reach, is kept
 * unconditionally — there is nothing to check it against.
 */
export const candidatesFor = (dispatch: Config['dispatch'], catalogues: Catalogues): BuiltModels => {
	const dropped: string[] = []
	const kept: Model[] = []
	const names = new Set<string>()

	for (const pin of dispatch.models) {
		const host = ((): string | null => {
			try {
				return adapterFor(pin.run).id
			} catch {
				return null
			}
		})()
		if (host === 'codex' || host === 'openrouter') {
			const catalogue = catalogues[host]
			if (catalogue !== null) {
				const id = modelIdOf(pin.run)
				if (id === null || !catalogue.some((c) => c.id === id)) {
					dropped.push(`${pin.name}: pinned but retired from ${host}`)
					continue
				}
			}
		}
		kept.push(pin)
		names.add(pin.name)
	}

	for (const source of ['claude', 'codex', 'openrouter'] as const) {
		const rule = dispatch.sources[source]
		if (rule === undefined) continue
		const catalogue = catalogues[source]
		if (catalogue === null) continue
		const only = rule.only?.map(globToRegExp)
		const deny = rule.deny?.map(globToRegExp)
		for (const candidate of catalogue) {
			if (only !== undefined && !only.some((re) => re.test(candidate.id))) continue
			if (deny !== undefined && deny.some((re) => re.test(candidate.id))) continue
			if (names.has(candidate.name)) {
				dropped.push(`${candidate.name}: clashes with an earlier entry, dropped`)
				continue
			}
			kept.push({
				name: candidate.name,
				run: candidate.run,
				complexity: rule.complexity,
				about: candidate.about,
			})
			names.add(candidate.name)
		}
	}

	return { models: kept, dropped }
}

interface Catalogue {
	readonly at: number
	readonly models: Partial<Record<'claude' | 'codex' | 'openrouter', readonly Candidate[]>>
}

const readCatalogueCache = async (file: string): Promise<Catalogue> => {
	try {
		return JSON.parse(await readFile(file, 'utf8')) as Catalogue
	} catch {
		return { at: 0, models: {} }
	}
}

export interface LiveModelsDeps {
	readonly fetch?: typeof fetch
	readonly home?: string
	readonly now?: () => number
}

/**
 * `candidatesFor`, fed by the catalogues `dispatch.sources` actually names —
 * nothing is fetched for a source nobody configured. Cached at
 * `paths.catalogue`, fresh for `dispatch.catalogueSeconds`. A source that fails
 * to fetch is logged and treated as unreachable, never thrown — an OpenRouter
 * outage must not stop a dispatch.
 */
export const liveModels = async (
	paths: Paths,
	dispatch: Config['dispatch'],
	deps: LiveModelsDeps = {},
): Promise<BuiltModels> => {
	const named = (['claude', 'codex', 'openrouter'] as const).filter(
		(source) => dispatch.sources[source] !== undefined,
	)
	if (named.length === 0) return candidatesFor(dispatch, { claude: [], codex: [], openrouter: [] })

	const now = deps.now?.() ?? Date.now()
	const cache = await readCatalogueCache(paths.catalogue)
	const fresh = now < cache.at + dispatch.catalogueSeconds * 1000

	const fetchOne = async (
		source: 'claude' | 'codex' | 'openrouter',
	): Promise<readonly Candidate[] | null> => {
		try {
			if (source === 'claude') return claudeModels()
			if (source === 'codex') return await codexModels(deps.home ?? homedir())
			return await openRouterModels(deps.fetch ?? fetch)
		} catch (error) {
			console.error(`sober: the ${source} catalogue could not be reached: ${(error as Error).message}`)
			return null
		}
	}

	const found: Partial<Record<'claude' | 'codex' | 'openrouter', readonly Candidate[] | null>> = {}
	let fetched = false
	for (const source of named) {
		const known = fresh ? cache.models[source] : undefined
		found[source] = known !== undefined ? known : ((fetched = true), await fetchOne(source))
	}

	if (fetched) {
		const merged = { ...cache.models, ...found }
		await writeAtomic(paths.catalogue, JSON.stringify({ at: now, models: merged }))
	}

	return candidatesFor(dispatch, {
		claude: found.claude ?? [],
		codex: found.codex ?? null,
		openrouter: found.openrouter ?? null,
	})
}
