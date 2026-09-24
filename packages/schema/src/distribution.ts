import { z } from 'zod'
import { Handle, Id, Timestamp } from './id.js'

/**
 * One node handed to one contributor, with the sentence that put it there.
 *
 * `because` is not decoration. The matching happens inside a host session
 * (ADR 0051), so the reasoning behind it exists only in a conversation nobody
 * else was in — this is the part of it that reaches the person who has to
 * accept the plan, on whichever surface they open next.
 */
export const Match = z.strictObject({
	node: Id,
	handle: Handle,
	because: z.string().min(1),
})

export type Match = z.infer<typeof Match>

/**
 * `.sober/distribution.json`. A proposed allocation waiting on a human, and
 * nothing more: no node changes until it is accepted (ADR 0004's rule, applied
 * to distribution by ADR 0051).
 *
 * Board state rather than local, for the reason `contributors.json` is board
 * state (DESIGN §3.3): who does what is a property of the project, and a plan
 * a teammate cannot see is a plan they cannot argue with.
 */
export const Distribution = z.strictObject({
	by: Handle,
	at: Timestamp,
	matches: z.array(Match),
	/**
	 * Nodes the proposal reached for and did not take: somebody is already on
	 * them, or they are finished. Kept rather than dropped, because eight
	 * matches on a board of twelve nodes reads as a proposal that ran out of
	 * ideas unless the other four are named.
	 */
	skipped: z.array(Id),
})

export type Distribution = z.infer<typeof Distribution>
