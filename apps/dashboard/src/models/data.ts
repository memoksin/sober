import type { Candidate, ListedModel, ModelList } from '@besober/core'

// `core`'s HOSTS, spelled again: the browser cannot import `core` at runtime.
const HOSTS = ['claude', 'codex', 'openrouter'] as const

export interface HostGroup {
	readonly host: string
	readonly models: readonly ListedModel[]
	/** The lowest and highest score any of its models takes; null when none does. */
	readonly covers: readonly [number, number] | null
	/** Catalogue entries not already on the list. */
	readonly addable: readonly Candidate[]
	/** False when the catalogue could not be read, so nothing can be picked from it. */
	readonly reachable: boolean
	/** Named in `dispatch.sources`, so a pick can come back without a range. */
	readonly sourced: boolean
}

const coverOf = (models: readonly ListedModel[]): HostGroup['covers'] =>
	models.length === 0
		? null
		: [
				Math.min(...models.map((m) => m.complexity[0])),
				Math.max(...models.map((m) => m.complexity[1])),
			]

/**
 * The screen's three hosts, in order, and one group more for a pin on any other
 * adapter — without it such a pin would be on Jev's list with no way to remove it.
 */
export const byHost = (list: ModelList): HostGroup[] => {
	const groups: HostGroup[] = HOSTS.map((host) => {
		const models = list.models.filter((m) => m.host === host)
		const catalogue = list.catalogues[host]
		const taken = new Set(models.map((m) => m.run))
		return {
			host,
			models,
			covers: coverOf(models),
			addable: (catalogue ?? []).filter((c) => !taken.has(c.run)),
			reachable: catalogue !== null,
			sourced: list.sources[host] !== undefined,
		}
	})
	const others = list.models.filter((m) => !(HOSTS as readonly (string | null)[]).includes(m.host))
	if (others.length > 0)
		groups.push({
			host: 'other',
			models: others,
			covers: coverOf(others),
			addable: [],
			reachable: false,
			sourced: false,
		})
	return groups
}

/** Two score fields, both blank for "the source's own range", else a checked pair. */
export const rangeOf = (
	low: string,
	high: string,
): { readonly range: [number, number] | undefined } | { readonly error: string } => {
	if (low.trim() === '' && high.trim() === '') return { range: undefined }
	const pair = [Number(low), Number(high)] as [number, number]
	if (!pair.every((n) => Number.isInteger(n) && n >= 1 && n <= 10) || pair[0] > pair[1])
		return { error: 'a range runs from 1 to 10, low end first' }
	return { range: pair }
}
