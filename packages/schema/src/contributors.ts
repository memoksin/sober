import { z } from 'zod'
import { Handle } from './id.js'

/**
 * `.sober/contributors.json`. Board state, not configuration: the team is a
 * property of the project rather than of one machine, so it syncs with the
 * graph (DESIGN §3.3).
 */
export const Contributor = z.strictObject({
	handle: Handle,
	name: z.string(),
	// Free text on purpose. Allocating work by matching a role and a focus is
	// v1.x; until something reads them, a fixed vocabulary is a guess.
	role: z.string(),
	focus: z.string(),
})

export type Contributor = z.infer<typeof Contributor>

export const Contributors = z.strictObject({
	contributors: z.array(Contributor),
})

export type Contributors = z.infer<typeof Contributors>
