import { accessSync, constants, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { applySetting, type Config, type Model, readConfig } from './config.js'
import { SoberError } from './errors.js'
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
		if (process.platform === 'win32')
			return (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').some((ext) => {
				try {
					return statSync(join(dir, command + ext)).isFile()
				} catch {
					return false
				}
			})
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
export const candidatesFor = (
	dispatch: Config['dispatch'],
	catalogues: Catalogues,
): BuiltModels => {
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
			if (deny?.some((re) => re.test(candidate.id))) continue
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

export const HOSTS = ['claude', 'codex', 'openrouter'] as const
export type Host = (typeof HOSTS)[number]

type SourceRule = NonNullable<Config['dispatch']['sources'][Host]>

const namedSources = (dispatch: Config['dispatch']): Host[] =>
	HOSTS.filter((source) => dispatch.sources[source] !== undefined)

/**
 * The catalogues of `hosts`, cached at `paths.catalogue` and fresh for
 * `dispatch.catalogueSeconds`. A source that fails to fetch is logged and
 * treated as unreachable, never thrown — an OpenRouter outage must not stop a
 * dispatch. A host not asked for is unreachable too, so a pin on it is kept
 * unchecked rather than read as retired.
 */
const cataloguesFor = async (
	paths: Paths,
	dispatch: Config['dispatch'],
	hosts: readonly Host[],
	deps: LiveModelsDeps,
): Promise<Catalogues> => {
	const found: Partial<Record<Host, readonly Candidate[] | null>> = {}
	if (hosts.length > 0) {
		const now = deps.now?.() ?? Date.now()
		const cache = await readCatalogueCache(paths.catalogue)
		const fresh = now < cache.at + dispatch.catalogueSeconds * 1000

		const fetchOne = async (source: Host): Promise<readonly Candidate[] | null> => {
			try {
				if (source === 'claude') return claudeModels()
				if (source === 'codex') return await codexModels(deps.home ?? homedir())
				return await openRouterModels(deps.fetch ?? fetch)
			} catch (error) {
				console.error(
					`sober: the ${source} catalogue could not be reached: ${(error as Error).message}`,
				)
				return null
			}
		}

		let fetched = false
		for (const source of hosts) {
			const known = fresh ? cache.models[source] : undefined
			if (known !== undefined) {
				found[source] = known
			} else {
				fetched = true
				found[source] = await fetchOne(source)
			}
		}

		if (fetched) {
			const merged = { ...cache.models, ...found }
			await writeAtomic(paths.catalogue, JSON.stringify({ at: now, models: merged }))
		}
	}
	return {
		claude: found.claude ?? [],
		codex: found.codex ?? null,
		openrouter: found.openrouter ?? null,
	}
}

/**
 * `candidatesFor`, fed by the catalogues `dispatch.sources` actually names —
 * nothing is fetched for a source nobody configured.
 */
export const liveModels = async (
	paths: Paths,
	dispatch: Config['dispatch'],
	deps: LiveModelsDeps = {},
): Promise<BuiltModels> =>
	candidatesFor(dispatch, await cataloguesFor(paths, dispatch, namedSources(dispatch), deps))

export interface ListedModel extends Model {
	/** The adapter the run line names, e.g. `claude`; null when none does. */
	readonly host: string | null
	/** Its `--model` argument — what a `deny` entry names. */
	readonly id: string | null
	/** In `dispatch.models`, rather than brought by `dispatch.sources`. */
	readonly pinned: boolean
}

/**
 * The dashboard's model screen: the list Jev would see, each entry with its
 * host and where it came from, and every host's whole catalogue to add from —
 * a host `dispatch.sources` does not name included.
 */
export interface ModelList {
	readonly models: readonly ListedModel[]
	readonly dropped: readonly string[]
	readonly sources: Config['dispatch']['sources']
	readonly catalogues: Catalogues
}

const hostOf = (run: string): string | null => {
	try {
		return adapterFor(run).id
	} catch {
		return null
	}
}

const settings = async (paths: Paths): Promise<Config['dispatch']> => {
	const config = await readConfig(paths)
	if (config.kind !== 'ok')
		throw new SoberError('schema', `${config.file} cannot be read: ${config.reason}`)
	return config.value.dispatch
}

const listOf = async (
	paths: Paths,
	dispatch: Config['dispatch'],
	deps: LiveModelsDeps,
): Promise<ModelList> => {
	const all = await cataloguesFor(paths, dispatch, HOSTS, deps)
	const named = namedSources(dispatch)
	// From the named sources only, so the list is the one a dispatch sees.
	const built = candidatesFor(dispatch, {
		claude: named.includes('claude') ? all.claude : [],
		codex: named.includes('codex') ? all.codex : null,
		openrouter: named.includes('openrouter') ? all.openrouter : null,
	})
	const pins = new Set(dispatch.models.map((m) => m.name))
	return {
		models: built.models.map((m) => ({
			...m,
			host: hostOf(m.run),
			id: modelIdOf(m.run),
			pinned: pins.has(m.name),
		})),
		dropped: built.dropped,
		sources: dispatch.sources,
		catalogues: all,
	}
}

export const listModels = async (paths: Paths, deps: LiveModelsDeps = {}): Promise<ModelList> =>
	listOf(paths, await settings(paths), deps)

type Range = readonly [number, number]

const checkRange = ([low, high]: Range): [number, number] => {
	if (!Number.isInteger(low) || !Number.isInteger(high) || low < 1 || high > 10 || low > high)
		throw new SoberError('bad-model', 'a range runs from 1 to 10, low end first')
	return [low, high]
}

/** The source's filters, less any `deny` entry that is exactly this id. */
const passes = (rule: SourceRule, id: string): boolean =>
	(rule.only === undefined || rule.only.some((glob) => globToRegExp(glob).test(id))) &&
	!(rule.deny ?? []).some((glob) => glob !== id && globToRegExp(glob).test(id))

export type AddModel =
	| { readonly host: Host; readonly id: string; readonly complexity?: Range }
	| {
			readonly name: string
			readonly run: string
			readonly complexity: Range
			readonly about?: string
	  }

export type Added =
	| { readonly kind: 'pinned'; readonly model: Model }
	/** Exact `deny` entries were taken out, and the source brings the model back. */
	| { readonly kind: 'lifted'; readonly model: Model; readonly host: Host }

/**
 * One model more for Jev. Typed by hand, it is a pin. Picked from a host's
 * catalogue with no range given, the smallest change wins: lifting an exact
 * `deny` entry when the source's filters then let it through, and a pin when
 * they still keep it out. Every write goes through `applySetting`, so the
 * config keeps its comments.
 */
export const addModel = async (
	paths: Paths,
	adding: AddModel,
	deps: LiveModelsDeps = {},
): Promise<Added> => {
	const dispatch = await settings(paths)
	const pin = async (model: Model): Promise<Added> => {
		if (dispatch.models.some((m) => m.name === model.name))
			throw new SoberError('bad-model', `${model.name} is already in dispatch.models`)
		await applySetting(paths, ['dispatch', 'models', dispatch.models.length], model)
		return { kind: 'pinned', model }
	}

	if ('name' in adding) {
		if (adding.name.trim() === '' || adding.run.trim() === '')
			throw new SoberError('bad-model', 'a model needs a name and a run line')
		return pin({
			name: adding.name,
			run: adding.run,
			complexity: checkRange(adding.complexity),
			about: adding.about ?? '',
		})
	}

	const list = await listOf(paths, dispatch, deps)
	const candidate = list.catalogues[adding.host]?.find((c) => c.id === adding.id)
	if (candidate === undefined)
		throw new SoberError('bad-model', `${adding.id} is not in the ${adding.host} catalogue`)
	if (list.models.some((m) => m.run === candidate.run))
		throw new SoberError('bad-model', `${candidate.name} is already a model Jev can pick`)

	const rule = dispatch.sources[adding.host]
	if (
		rule !== undefined &&
		adding.complexity === undefined &&
		passes(rule, candidate.id) &&
		!list.models.some((m) => m.name === candidate.name)
	) {
		const deny = rule.deny ?? []
		// From the end, so each index still points where it did when read.
		for (let at = deny.length - 1; at >= 0; at--)
			if (deny[at] === candidate.id)
				await applySetting(paths, ['dispatch', 'sources', adding.host, 'deny', at], undefined)
		return {
			kind: 'lifted',
			host: adding.host,
			model: {
				name: candidate.name,
				run: candidate.run,
				complexity: rule.complexity,
				about: candidate.about,
			},
		}
	}

	const complexity = adding.complexity ?? rule?.complexity
	if (complexity === undefined)
		throw new SoberError(
			'bad-model',
			`${adding.host} is not in dispatch.sources, so say which scores ${candidate.name} takes`,
		)
	return pin({
		name: candidate.name,
		run: candidate.run,
		complexity: checkRange(complexity),
		about: candidate.about,
	})
}

export type Removed =
	| { readonly kind: 'unpinned'; readonly name: string }
	/** A source brought it, so its id is now in that source's `deny`. */
	| { readonly kind: 'denied'; readonly name: string; readonly host: Host; readonly id: string }

/**
 * One model fewer for Jev, by the name the list shows. A pin is deleted from
 * `dispatch.models`; a model a source brought is denied by its exact id in that
 * source's `dispatch.sources` block, so the next catalogue refresh does not
 * bring it back.
 */
export const removeModel = async (
	paths: Paths,
	name: string,
	deps: LiveModelsDeps = {},
): Promise<Removed> => {
	const dispatch = await settings(paths)
	const at = dispatch.models.findIndex((m) => m.name === name)
	if (at !== -1) {
		await applySetting(paths, ['dispatch', 'models', at], undefined)
		return { kind: 'unpinned', name }
	}

	const listed = (await listOf(paths, dispatch, deps)).models.find((m) => m.name === name)
	const host = HOSTS.find((h) => h === listed?.host)
	const rule = host === undefined ? undefined : dispatch.sources[host]
	if (listed?.id == null || host === undefined || rule === undefined)
		throw new SoberError('bad-model', `${name} is not a model Jev can pick`)
	await applySetting(
		paths,
		['dispatch', 'sources', host, 'deny', ...(rule.deny === undefined ? [] : [rule.deny.length])],
		rule.deny === undefined ? [listed.id] : listed.id,
	)
	return { kind: 'denied', name, host, id: listed.id }
}
