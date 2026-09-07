import type { Distribution, ProjectedNode } from '@besober/schema'
import type { Wire } from '../wire.js'

/** One proposed match, with the title the canvas is already drawing beside it. */
export interface Row {
	readonly node: string
	readonly title: string
	readonly handle: string
	readonly because: string
}

/**
 * The plan, joined to the board it is about. The title comes from the
 * projection rather than from the record: a plan proposed on Tuesday and read
 * on Thursday must show the node as it is now, and the id is the only thing the
 * two halves agree on.
 */
export const rows = (plan: Distribution, nodes: readonly ProjectedNode[]): Row[] => {
	const titles = new Map(nodes.map((node) => [node.id, node.title]))
	return plan.matches.map((one) => ({
		node: one.node,
		title: titles.get(one.node) ?? '',
		handle: one.handle,
		because: one.because,
	}))
}

/** The bar's sentence: how big the plan is, and whose it is. */
export const waiting = (plan: Distribution): string =>
	`${plan.matches.length === 0 ? 'nothing' : `${plan.matches.length} node${plan.matches.length === 1 ? '' : 's'}`} proposed by ${plan.by}`

/**
 * What the plan reached for and did not take (ADR 0051): a claim is a fact and
 * this is a plan. Said rather than dropped — eight matches on a board of twelve
 * reads as a plan that ran out of ideas unless the other four are named.
 */
export const passedOver = (plan: Distribution): string | null => {
	const many = plan.skipped.length
	if (many === 0) return null
	return `${many} node${many === 1 ? '' : 's'} passed over — somebody is already on ${many === 1 ? 'it' : 'them'}, or ${many === 1 ? 'it is' : 'they are'} done`
}

/** The plan, or the sentence saying why it could not be read. */
export interface PlanRead {
	readonly plan: Distribution | null
	readonly failure: string | null
}

/**
 * The plan's read, with its failure carried rather than thrown.
 *
 * It goes out beside the projection on the canvas's poll, and the two travel in
 * one `Promise.all` — so a plan that will not parse would take the canvas down
 * with it, which is the one rule §8.4 has ever had. The failure comes back as a
 * value instead, and the bar is where it is read.
 */
export const readPlan = async (surface: Wire): Promise<PlanRead> => {
	try {
		return { plan: await surface.read<Distribution | null>('distribution'), failure: null }
	} catch (error) {
		return { plan: null, failure: error instanceof Error ? error.message : String(error) }
	}
}
