import type { Decision, Node, Project, Run } from '@besober/schema'
import { type Feedback, readFeedbacks, readRuns } from './local.js'
import type { Paths } from './paths.js'
import type { BrokenRecord } from './read.js'
import { readArchivedDecisions, readDecisions, readNodes, readProject } from './records.js'

/**
 * Everything a surface needs to answer "what can start now", loaded once. The
 * board is read whole because status is derived from it (§3.2): a node's status
 * depends on its dependencies, its decisions and its last run.
 */
export interface Board {
	readonly project: Project | null
	readonly nodes: ReadonlyMap<string, Node>
	readonly decisions: ReadonlyMap<string, Decision>
	/**
	 * Which of those decisions are archived. They stay in `decisions` because a
	 * node that bound one keeps reading it (§8.3) — and they are named here
	 * because a surface that cannot tell them apart lists an archived decision
	 * as one still waiting on the human.
	 */
	readonly archivedDecisions: ReadonlySet<string>
	/** Local, disposable, and never shared: runs decide `running` and `in-review`. */
	readonly runs: ReadonlyMap<string, Run>
	/** Local too, and by node: a rejection is what takes a node back out of review (§6.4). */
	readonly feedback: ReadonlyMap<string, Feedback>
	/** Named, never thrown: one bad file does not take down the board (§8.4). */
	readonly broken: readonly BrokenRecord[]
}

export const loadBoard = async (paths: Paths): Promise<Board> => {
	const [project, nodes, decisions, archived, runs, feedback] = await Promise.all([
		readProject(paths),
		readNodes(paths),
		readDecisions(paths),
		// A node that bound a decision keeps pointing at it and keeps reading it
		// after it is archived (§8.3), so the board loads both.
		readArchivedDecisions(paths),
		readRuns(paths),
		readFeedbacks(paths),
	])
	return {
		project: project.kind === 'ok' ? project.value : null,
		nodes: nodes.records,
		decisions: new Map([...archived.records, ...decisions.records]),
		archivedDecisions: new Set(archived.records.keys()),
		runs: runs.records,
		feedback: feedback.records,
		broken: [
			...(project.kind === 'broken' ? [{ file: project.file, reason: project.reason }] : []),
			...nodes.broken,
			...decisions.broken,
			...archived.broken,
			...runs.broken,
			...feedback.broken,
		],
	}
}

/** The nodes that depend on this one — the direction the graph is not stored in. */
export const dependents = (nodes: ReadonlyMap<string, Node>, id: string): string[] =>
	[...nodes].filter(([, node]) => node.dependsOn.includes(id)).map(([dependent]) => dependent)

/**
 * The cycle a new dependency would close, as a path, or null when it would not
 * (§3.6). Refusing at the edge is one check; detecting it later is a class of bug.
 */
export const cycleFrom = (
	nodes: ReadonlyMap<string, Node>,
	from: string,
	to: string,
): string[] | null => {
	if (from === to) return [from, to]
	// `from` will depend on `to`, so a cycle exists when `to` already reaches `from`.
	const path: string[] = [to]
	const seen = new Set<string>()

	const walk = (id: string): boolean => {
		if (id === from) return true
		if (seen.has(id)) return false
		seen.add(id)
		for (const next of nodes.get(id)?.dependsOn ?? []) {
			path.push(next)
			if (walk(next)) return true
			path.pop()
		}
		return false
	}

	return walk(to) ? [from, ...path] : null
}

/** A cycle already on the board — the merge edge of §3.6, and a hand-edited file. */
export const findCycle = (nodes: ReadonlyMap<string, Node>): string[] | null => {
	for (const [id, node] of nodes) {
		for (const dependency of node.dependsOn) {
			const cycle = cycleFrom(nodes, id, dependency)
			if (cycle !== null) return cycle
		}
	}
	return null
}

/**
 * Dependencies before dependents, ties broken by id so two machines produce the
 * same order. Nodes in a cycle are left out — `findCycle` is what reports them.
 */
export const topological = (nodes: ReadonlyMap<string, Node>): string[] => {
	const order: string[] = []
	const placed = new Set<string>()
	const ids = [...nodes.keys()].sort()

	for (;;) {
		const next = ids.filter(
			(id) =>
				!placed.has(id) &&
				(nodes.get(id)?.dependsOn ?? []).every(
					(dependency) => placed.has(dependency) || !nodes.has(dependency),
				),
		)
		if (next.length === 0) return order
		for (const id of next) {
			placed.add(id)
			order.push(id)
		}
	}
}

/** A `dependsOn` or `decisions` entry naming a record the board does not hold. */
export interface DanglingEdge {
	readonly node: string
	readonly kind: 'dependsOn' | 'decisions'
	readonly missing: string
}

export const dangling = (board: Board): DanglingEdge[] => {
	const edges: DanglingEdge[] = []
	for (const [id, node] of board.nodes) {
		for (const dependency of node.dependsOn) {
			if (!board.nodes.has(dependency))
				edges.push({ node: id, kind: 'dependsOn', missing: dependency })
		}
		for (const decision of node.decisions) {
			if (!board.decisions.has(decision))
				edges.push({ node: id, kind: 'decisions', missing: decision })
		}
	}
	return edges
}
