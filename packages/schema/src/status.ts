/**
 * The eight statuses, in the order they are evaluated — the first that matches
 * wins (DESIGN §3.2). Status is derived by `core`, never stored on a record, so
 * adding one is not a schema migration.
 *
 * `needs-brief` and `needs-approval` were one status until the M2 gate: a node
 * whose brief was written but not approved read exactly like a node with no
 * brief at all, and the human could not tell whether the next move was to write
 * one or to approve one.
 */
export const STATUSES = [
	'done',
	'in-review',
	'running',
	'blocked',
	'held',
	'needs-brief',
	'needs-approval',
	'ready',
] as const

export type Status = (typeof STATUSES)[number]
