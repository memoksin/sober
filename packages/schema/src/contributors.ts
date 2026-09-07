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
	role: z.string(),
	// A list rather than a sentence: globs where somebody wrote one, words
	// where they did not. The matching happens in a host session (ADR 0051) and
	// a session reads both, but only entry-by-entry can a glob be run against a
	// node's files — which is the half a comma-separated string cannot give.
	focus: z.array(z.string()),
})

export type Contributor = z.infer<typeof Contributor>

export const Contributors = z.strictObject({
	contributors: z.array(Contributor),
})

export type Contributors = z.infer<typeof Contributors>
