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
 * An approval or acceptance made under `sober:auto` rather than by a person
 * (ADR 0065 §6). `invokedBy` is who ran the invocation; the record's own `by`
 * is that same handle and never reads as their approval. Absent means a human.
 */
export const AutoProvenance = z.strictObject({
	invocation: z.literal('sober:auto'),
	invokedBy: Handle,
})

export type AutoProvenance = z.infer<typeof AutoProvenance>

/**
 * The words after "approved" or "accepted", worded once for every surface: an
 * autonomous record never reads as a person's act (ADR 0065 §6).
 */
export const byWhom = (record: { by: string; autonomous?: AutoProvenance }): string =>
	record.autonomous === undefined
		? `by ${record.by}`
		: `autonomously under ${record.autonomous.invocation} (invoked by ${record.autonomous.invokedBy})`

/**
 * `queue: true` is ADR 0017's "approve and queue" — the same human approval,
 * plus the instruction to dispatch when the node becomes ready.
 */
export const Approval = z.strictObject({
	by: Handle,
	at: Timestamp,
	queue: z.boolean(),
	autonomous: AutoProvenance.optional(),
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
	// How hard the node is for one agent in one run. `null` is a brief written
	// before the score existed, which dispatch runs on `dispatch.host`.
	complexity: z.int().min(1).max(10).nullable(),
	acceptance: z.array(Criterion).min(1),
	approval: Approval.nullable(),
})

export type Brief = z.infer<typeof Brief>
