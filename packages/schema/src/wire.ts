import { z } from 'zod'
import { Id } from './id.js'
import { STATUSES } from './status.js'

/**
 * What the canvas is served, per node: id, title, derived status, dependencies
 * and nothing else (ADR 0008). The budget is ~200 active nodes (ADR 0016) and
 * the point of the projection is what it leaves out — a full record carries the
 * brief, the acceptance criteria, the declared files and the accept record, and
 * two hundred of those is a payload nobody asked for to draw two hundred
 * circles.
 *
 * `strictObject` is doing real work here rather than being a habit: it is what
 * makes sending a full record in a projection's place a parse failure instead
 * of a slow screen.
 *
 * Status is not on the node record — it is derived (DESIGN §3.2) — so it is
 * computed into the projection at the moment it is built.
 */
export const ProjectedNode = z.strictObject({
	id: Id,
	title: z.string().min(1),
	status: z.enum(STATUSES),
	dependsOn: z.array(Id),
	/**
	 * A bound decision moved after this node's brief was approved (§2.8). One
	 * boolean rather than the ids it was derived from: §7.2's list is which
	 * nodes, and the canvas is where the reader already is.
	 *
	 * It is here rather than only in the digest because the digest is read once,
	 * when the board is opened. Dismissing a flag has to take the node out of
	 * the list without a reload, and the projection is what the canvas polls.
	 */
	flagged: z.boolean(),
})

export type ProjectedNode = z.infer<typeof ProjectedNode>

/**
 * The edges are the `dependsOn` lists; there is no separate edge list, because
 * a graph that carries both can disagree with itself.
 */
export const Projection = z.strictObject({ nodes: z.array(ProjectedNode) })

export type Projection = z.infer<typeof Projection>

/**
 * The body of a failed response. HTTP's status code already says that it
 * failed, so nothing here repeats it; this carries the one thing the status
 * code cannot, which is what to tell the human.
 *
 * The message may not be empty. DESIGN §6.1 makes the same point about CI —
 * "could not be read" is not "passing" — and a failure whose message is blank
 * renders as a failure nobody can act on, which is the same defect wearing a
 * different hat.
 */
export const WireError = z.strictObject({ error: z.string().min(1) })

export type WireError = z.infer<typeof WireError>

/**
 * One thing standing between a node and starting, as it travels. Derived by
 * `core` and computed into the board read, because the browser cannot import
 * `core` and a second derivation is a second answer to the same question.
 *
 * It lives here rather than beside the derivation for the same reason
 * `ProjectedNode` does: a wire shape belongs to both ends of the wire.
 */
export const Waiting = z.strictObject({
	kind: z.enum(['decision', 'node']),
	id: Id,
	/**
	 * An archived decision is not in the open list, so a node held by one is
	 * waiting on something no surface offers to answer. Carried rather than
	 * rendered as an ordinary wait somebody chases.
	 */
	archived: z.boolean(),
})

export type Waiting = z.infer<typeof Waiting>

/**
 * What the board gained while you were away (DESIGN §7.1). Every entry is an
 * id the board already holds — the digest is a filter over existing records,
 * and there is no digest record to write or read.
 */
export const Delta = z.strictObject({
	/** Nodes the remote has that this board branch did not. */
	nodes: z.array(Id),
	/** Decisions whose `answer` went from null to a record. */
	answered: z.array(Id),
	/** Nodes whose `accepted` went from null to a record. */
	finished: z.array(Id),
})

export type Delta = z.infer<typeof Delta>

/**
 * The two halves, together and separable. `delta` is null exactly when
 * `unreachable` says why — no remote, no network, or a board that has never
 * been shared — and the snapshot half is unaffected either way, because it
 * asks the board on this machine and nothing else (§7.1).
 *
 * The message may not be empty for `WireError`'s reason: "the delta could not
 * be read" with nothing after it is a failure nobody can act on (§8.7).
 */
export const Digest = z.strictObject({
	delta: Delta.nullable(),
	unreachable: z.string().min(1).nullable(),
	/** Current state: results waiting for a human. */
	inReview: z.array(Id),
	/** Current state: nodes whose bound decision moved after approval (§2.8). */
	flagged: z.array(Id),
})

export type Digest = z.infer<typeof Digest>

/**
 * What editing an answered decision reaches (§2.8, D19). It is a read
 * (`/read/impact`) rather than a stored dry run: a preview with a lifetime is a
 * record to write, migrate, merge and expire, and §7.1 already refused that
 * trade for the digest (ADR 0044).
 *
 * One entry per node the save touches, and nothing for a node it leaves alone.
 * A node bound to the decision whose brief was never approved is absent, not
 * listed as unchanged — the preview is what will happen, and a list padded with
 * nodes nothing happens to is the fan-out made harder to read.
 *
 * `status` is here because §2.8's reason for counting running nodes is that a
 * person can stop a run that is building against the answer they are about to
 * change. `effect` is here because the three rows have two outcomes, and three
 * surfaces deriving which is which from `status` is three answers to one
 * question (ADR 0035's rule, one level out).
 */
export const Impact = z.strictObject({
	decision: Id,
	nodes: z.array(
		z.strictObject({
			id: Id,
			title: z.string().min(1),
			status: z.enum(STATUSES),
			/** `rebrief` withdraws the brief; `flag` writes nothing at all. */
			effect: z.enum(['rebrief', 'flag']),
		}),
	),
})

export type Impact = z.infer<typeof Impact>

/**
 * One rendered line of a run log, as it travels (§5.5). The raw log is the
 * host's own JSON — machine-facing, like every internal format (`PR-09-03`) —
 * and this is what a person reads.
 *
 * It is an allowlist, not a denylist. A host adds event types between releases,
 * and a denylist turns every new one into noise in front of the user the day it
 * ships, which is exactly how a live tail becomes a thing nobody reads.
 *
 * The shape lives here rather than in `core` because both ends of the wire hold
 * it: `core` renders it off the log and the screen draws it, and a browser
 * cannot import `core` (ADR 0008).
 */
export const LogLine = z.strictObject({
	kind: z.enum(['started', 'text', 'tool', 'result', 'raw', 'answer']),
	text: z.string(),
})

export type LogLine = z.infer<typeof LogLine>

/**
 * What a screen watching a run is sent, one message at a time (ADR 0046).
 *
 * `offset` is a byte position in the log file, not a line count: it is what a
 * reconnecting screen hands back to resume, and bytes are the only unit that
 * survives a line the host wrote in two chunks.
 *
 * `live` is the reason the connection can close. A run that has ended will not
 * grow its log again, so a screen that has read to the end of a finished run is
 * finished too — which is what keeps a tab open on yesterday's node from
 * holding anything at all.
 */
export const LogWindow = z.strictObject({
	lines: z.array(LogLine),
	offset: z.number().int().nonnegative(),
	live: z.boolean(),
})

export type LogWindow = z.infer<typeof LogWindow>
