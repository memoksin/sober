import { z } from 'zod'

/**
 * A slug plus a four-character random suffix — `auth-api-k7f2` (ADR 0020).
 * The id lives only in the file name; it is never a field inside the record.
 */
export const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*-[a-z0-9]{4}$/

export const Id = z.string().regex(ID_PATTERN, 'expected a slug with a four-character suffix')

export type Id = z.infer<typeof Id>

/** ISO 8601, UTC. `createdAt` is written once and never changed (ADR 0020). */
export const Timestamp = z.iso.datetime()

export type Timestamp = z.infer<typeof Timestamp>

/** A contributor handle. */
export const Handle = z.string().min(1)

export type Handle = z.infer<typeof Handle>

/**
 * The two ends of a run of linked nodes — `from..to` (ADR 0050). An id holds
 * no dot, so nothing else on the board can be read as one, and the two ends
 * are told apart by splitting rather than by a second pattern to keep in step
 * with `ID_PATTERN`.
 *
 * Null rather than a throw: every surface asks the same question of the same
 * argument — "is this one node or a run?" — before it knows which it has.
 */
export const chainEnds = (text: string): readonly [string, string] | null => {
	const ends = text.split('..')
	return ends.length === 2 && ends.every((end) => ID_PATTERN.test(end))
		? [ends[0] as string, ends[1] as string]
		: null
}
