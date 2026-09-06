import {
	acceptWork,
	addContributor,
	answerDecision,
	approveBrief,
	archiveNode,
	assignNode,
	bind,
	claimNode,
	currentBranch,
	dispatch,
	initBoard,
	loadBoard,
	NotOnBoardError,
	type Paths,
	rejectWork,
	releaseNode,
	removeContributor,
	resolveConflict,
	reviewNode,
	statusOf,
	stopRun,
	sync,
	waitingOn,
	whoami,
	writeBrief,
} from '@besober/core'
import {
	Brief,
	Contributor,
	Id,
	OPERATIONS,
	type Operation,
	Project,
	type Projection,
} from '@besober/schema'
import { z } from 'zod'

/**
 * One route, with the shape it accepts and the work it does. `run` parses
 * before it calls `core`, so a handler never sees a body nobody checked — the
 * boundary `SCOPE.md` asks for, at the one place every request passes through.
 *
 * The type is flat rather than generic in its input, so the table can hold
 * seventeen routes of seventeen shapes without the table itself becoming a
 * type puzzle. The generic lives in `route` below, where it is useful.
 */
export interface Route {
	readonly accepts: z.ZodType
	readonly run: (paths: Paths, body: unknown) => Promise<unknown>
}

const route = <I>(
	accepts: z.ZodType<I>,
	run: (paths: Paths, input: I) => Promise<unknown>,
): Route => ({
	accepts,
	// `async` rather than returning the inner promise: a parse failure has to
	// reject like every other failure, not throw synchronously past the caller's
	// `.catch`. The HTTP layer has one error path and this is what keeps it one.
	run: async (paths, body) => run(paths, accepts.parse(body)),
})

/** Every request that lands on a ref uses the checked-out branch unless it says otherwise. */
const baseOf = async (paths: Paths, given: string | undefined): Promise<string> =>
	given ?? (await currentBranch(paths.root))

const node = z.strictObject({ node: Id })
const nothing = z.strictObject({})

/**
 * The seventeen. Keyed by the catalogue's own names (ADR 0036), so
 * `POST /op/accept` is not a mapping anybody maintains — the path *is* the
 * operation, and `COVERS` below is these keys rather than a list beside them
 * that can quietly disagree.
 *
 * Every handler is thin on purpose. The composition that decides what a
 * dispatch or an accept means lives in `core`, which is what makes a run
 * started from this surface the same run the command line starts (`PR-09-08`),
 * and what ADR 0035 was reading when it kept `core` one entry point.
 */
export const OPS: Readonly<Record<Operation, Route>> = {
	init: route(
		z.strictObject({ project: Project.omit({ schemaVersion: true }) }),
		async (paths, { project }) => initBoard(paths.root, project),
	),

	bind: route(
		z.strictObject({
			node: Id,
			decisions: z.array(Id).optional(),
			dependsOn: z.array(Id).optional(),
		}),
		async (paths, { node: id, decisions, dependsOn }) => bind(paths, id, { decisions, dependsOn }),
	),

	decide: route(
		z.strictObject({ decision: Id, option: z.string().min(1), rationale: z.string().optional() }),
		async (paths, { decision, option, rationale }) =>
			answerDecision(paths, decision, { option, rationale, by: await whoami(paths.root) }),
	),

	write_brief: route(
		z.strictObject({ node: Id, brief: Brief.omit({ approval: true }) }),
		async (paths, { node: id, brief }) => writeBrief(paths, id, brief),
	),

	approve: route(
		z.strictObject({ node: Id, queue: z.boolean().optional() }),
		async (paths, { node: id, queue }) =>
			approveBrief(paths, id, { by: await whoami(paths.root), queue }),
	),

	run: route(
		z.strictObject({ node: Id, base: z.string().optional(), anyway: z.boolean().optional() }),
		async (paths, { node: id, base, anyway }) =>
			dispatch(paths, id, { base: await baseOf(paths, base), anyway }),
	),

	stop: route(node, async (paths, { node: id }) => ({ stopped: await stopRun(paths, id) })),

	// Accept reads the review first, because `scan` is recorded as it read at
	// the moment a human accepted (`PR-09-06`) — including "it did not run".
	accept: route(
		z.strictObject({ node: Id, base: z.string().optional() }),
		async (paths, { node: id, base }) => {
			const ref = await baseOf(paths, base)
			const found = await reviewNode(paths, id, ref)
			// A `SoberError`, not an `Error`: the state said no, nothing broke,
			// and the difference is a 409 against a 500 on the wire.
			if (found === null) throw new NotOnBoardError('node', id)
			return acceptWork(paths, id, {
				by: await whoami(paths.root),
				base: ref,
				scan: found.scan.result,
			})
		},
	),

	reject: route(
		z.strictObject({
			node: Id,
			text: z.string().min(1),
			clean: z.boolean().optional(),
			base: z.string().optional(),
		}),
		async (paths, { node: id, text, clean, base }) =>
			rejectWork(paths, id, { by: await whoami(paths.root), text, clean, base }),
	),

	archive: route(node, async (paths, { node: id }) => {
		await archiveNode(paths, id)
		return { archived: id }
	}),

	sync: route(
		z.strictObject({ branch: z.string().optional(), push: z.boolean().optional() }),
		async (paths, { branch, push }) =>
			sync(paths, await baseOf(paths, branch), { push: push ?? true }),
	),

	resolve: route(
		z.strictObject({
			branch: z.string().optional(),
			record: Id,
			choices: z.record(z.string(), z.enum(['ours', 'theirs', 'keep', 'restore'])),
		}),
		async (paths, { branch, record, choices }) =>
			resolveConflict(paths, await baseOf(paths, branch), record, choices),
	),

	contributors_add: route(
		z.strictObject({ contributor: Contributor }),
		async (paths, { contributor }) => {
			await addContributor(paths, contributor)
			return { added: contributor.handle }
		},
	),

	contributors_remove: route(
		z.strictObject({ handle: z.string().min(1) }),
		async (paths, { handle }) => ({ removed: await removeContributor(paths, handle) }),
	),

	assign: route(
		z.strictObject({ node: Id, handle: z.string().min(1).nullable() }),
		async (paths, { node: id, handle }) => {
			await assignNode(paths, id, handle)
			return { node: id, handle }
		},
	),

	claim: route(node, async (paths, { node: id }) => claimNode(paths, id, await whoami(paths.root))),

	release: route(node, async (paths, { node: id }) => ({
		released: await releaseNode(paths, id),
	})),
}

/**
 * What this surface covers, read off the table rather than written beside it.
 * The command line and the host session declare theirs by hand — they have to,
 * because `resolve` is folded into the session's `sync` elicitation and
 * `release` is a flag on `claim`. The server spells every operation exactly
 * once, so it is given no room to claim an ability it does not have.
 */
export const COVERS: readonly Operation[] = Object.keys(OPS) as Operation[]

/**
 * Reads. Deliberately three: what the canvas draws, what `sober status` says,
 * and what a human reads before accepting. The panel, the decision screen and
 * the digest add theirs in the sessions that draw them — a read written before
 * a screen asks for it is a shape guessed from nothing.
 *
 * A read is a `GET`, so its input is the query string rather than a body, and
 * the same `Route` carries it: the only difference is where the object comes
 * from.
 */
export const READS: Readonly<Record<string, Route>> = {
	// The `done` filter is a view filter (ADR 0016), so it is not applied here.
	// Filtering on the server would make "show me everything" a second request.
	projection: route(nothing, async (paths): Promise<Projection> => {
		const board = await loadBoard(paths)
		const nodes = [...board.nodes].flatMap(([id, record]) => {
			const status = statusOf(board, id)
			return status === null
				? []
				: [{ id, title: record.title, status, dependsOn: [...record.dependsOn] }]
		})
		return { nodes }
	}),

	board: route(nothing, async (paths) => {
		const board = await loadBoard(paths)
		return {
			project: board.project,
			nodes: [...board.nodes].map(([id, record]) => ({
				id,
				...record,
				status: statusOf(board, id),
				// The panel's question, answered here because the browser cannot
				// import `core` and a second derivation is a second answer.
				waitingOn: waitingOn(board, id),
			})),
			decisions: [...board.decisions].map(([id, record]) => ({
				id,
				...record,
				archived: board.archivedDecisions.has(id),
			})),
			// One bad file does not take down the board (§8.4), and a surface
			// that drops the fact renders a board that is quietly incomplete.
			broken: board.broken,
		}
	}),

	review: route(
		z.strictObject({ node: Id, base: z.string().optional() }),
		async (paths, { node: id, base }) => reviewNode(paths, id, await baseOf(paths, base)),
	),
}

export { OPERATIONS }
