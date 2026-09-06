/**
 * Every failure names what failed and what to do about it (DESIGN §8.7). None
 * of them is a stack trace: a message the user cannot act on turns a
 * recoverable state into a support request.
 *
 * The code is for surfaces that need to branch — the dashboard rendering a
 * refusal differently from a crash. The message is for the person.
 */
export const ERROR_CODES = [
	'git',
	'lock-busy',
	'dirty-worktree',
	'merge-refused',
	'not-on-board',
	'still-referenced',
	'not-answered',
	'host',
	'setup-failed',
	'answer-locked',
	'no-such-option',
	'no-brief',
	'accepted-already',
	'no-board',
	'cycle',
	'schema',
	'overlap',
	// DESIGN §7.2's three actions, each with the one state it refuses. Named
	// for what is missing, like `no-brief` and `no-board` above.
	'no-reason',
	'no-title',
	'not-finished',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

export class SoberError extends Error {
	constructor(
		readonly code: ErrorCode,
		message: string,
	) {
		super(message)
		this.name = new.target.name
	}
}

/** A record the board does not hold, named so the caller can say which one. */
export class NotOnBoardError extends SoberError {
	constructor(
		readonly kind: 'node' | 'decision',
		readonly id: string,
	) {
		super('not-on-board', `${kind} ${id} is not on this board`)
	}
}

/**
 * A delete that severs a reference leaves nodes waiting on something that no
 * longer exists — a broken graph, and nobody was told (§8.3, D41). The
 * referencing records are named, because the next question is always "by what".
 */
export class StillReferencedError extends SoberError {
	constructor(
		readonly id: string,
		readonly referencedBy: readonly string[],
	) {
		super(
			'still-referenced',
			`${id} is still referenced by ${referencedBy.join(', ')} — archive it instead, or change those first`,
		)
	}
}

/** An answered decision archives, never deletes (§8.3, ADR 0006). */
export class AnsweredDecisionError extends SoberError {
	constructor(readonly id: string) {
		super(
			'not-answered',
			`${id} has an answer — archive it instead, so the nodes it binds keep their reason`,
		)
	}
}
