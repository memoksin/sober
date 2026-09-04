/**
 * The seven statuses, in the order they are evaluated — the first that matches
 * wins (DESIGN §3.2). Status is derived by `core`, never stored on a record.
 */
export const STATUSES = [
	'done',
	'in-review',
	'running',
	'blocked',
	'held',
	'needs-brief',
	'ready',
] as const

export type Status = (typeof STATUSES)[number]
