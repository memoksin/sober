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
