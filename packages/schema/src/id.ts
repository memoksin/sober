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
