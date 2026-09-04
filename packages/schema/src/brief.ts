import { z } from 'zod'
import { Handle, Timestamp } from './id.js'

/**
 * One acceptance criterion: a command SOBER runs in the worktree, and the one
 * sentence saying what passing it proves (ADR 0027). `run` is the half the
 * machine reads; `proves` is the half the human approves.
 */
export const Criterion = z.strictObject({
	run: z.string().min(1),
	proves: z.string().min(1),
})

export type Criterion = z.infer<typeof Criterion>

/**
 * `queue: true` is ADR 0017's "approve and queue" — the same human approval,
 * plus the instruction to dispatch when the node becomes ready.
 */
export const Approval = z.strictObject({
	by: Handle,
	at: Timestamp,
	queue: z.boolean(),
})

export type Approval = z.infer<typeof Approval>

/**
 * The only stored parts of a brief. Everything else — intent, decisions,
 * declared files, upstream outcomes — is rendered from the records at read
 * time, so the skeleton cannot omit an answered decision (DESIGN §3.7).
 *
 * An empty `acceptance` list is not a brief: review is check results against
 * criteria the human approved, and a node with no criteria has none to read
 * (ADR 0022, ADR 0027).
 */
export const Brief = z.strictObject({
	approach: z.string().min(1),
	acceptance: z.array(Criterion).min(1),
	approval: Approval.nullable(),
})

export type Brief = z.infer<typeof Brief>
