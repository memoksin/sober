import type { Digest } from '@besober/schema'

/**
 * One thing that happened, counted. `kind` is kept beside the sentence so the
 * strip can colour a line by what it is about rather than by parsing its own
 * text back out.
 */
export interface Line {
	readonly kind: 'nodes' | 'answered' | 'finished' | 'inReview' | 'flagged'
	readonly count: number
	readonly text: string
}

/**
 * DESIGN §7.1's five things, in its order: the delta half first, because it is
 * what happened while you were away, and the snapshot half after, because it is
 * what is waiting for you now.
 *
 * A count of zero writes no line. A digest that lists three things you have
 * already dealt with and two you have not makes the reader do the filtering the
 * digest exists to do.
 */
export const lines = (digest: Digest): Line[] =>
	(
		[
			['nodes', digest.delta?.nodes.length ?? 0, 'new node', 'new nodes'],
			['answered', digest.delta?.answered.length ?? 0, 'decision answered', 'decisions answered'],
			['finished', digest.delta?.finished.length ?? 0, 'node finished', 'nodes finished'],
			[
				'inReview',
				digest.inReview.length,
				'result waiting for review',
				'results waiting for review',
			],
			['flagged', digest.flagged.length, 'node flagged', 'nodes flagged'],
		] as const
	).flatMap(([kind, count, one, many]) =>
		count === 0 ? [] : [{ kind, count, text: `${count} ${count === 1 ? one : many}` }],
	)

/**
 * Whether reopening the board has anything to say. A remote that could not be
 * checked is worth saying on its own (§8.7): "nothing changed" and "nothing was
 * checked" are opposite facts, and a strip that hides the second reports it as
 * the first.
 */
export const worthShowing = (digest: Digest): boolean =>
	lines(digest).length > 0 || digest.unreachable !== null
