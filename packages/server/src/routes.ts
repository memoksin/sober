import {
	acceptWork,
	addContributor,
	answerDecision,
	answerRun,
	approveBrief,
	archiveNode,
	assignNode,
	bind,
	claimNode,
	createNode,
	currentBranch,
	digest,
	dismissFlag,
	dispatch,
	editDecision,
	flagsOf,
	followRun,
	impactOf,
	initBoard,
	lastRun,
	loadBoard,
	NotOnBoardError,
	type Paths,
	rejectWork,
	releaseNode,
	removeContributor,
	reopenNode,
	resolveConflict,
	reviewNode,
	SoberError,
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
	type Digest,
	Id,
	type Impact,
	type LogWindow,
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

	/**
	 * §2.8's edit. `anyway` is the confirmation, exactly as it is on `run`
	 * (ADR 0032): without it `core` refuses with the fan-out and writes nothing,
	 * so the screen that renders the preview and the terminal that prints it are
	 * answered by one operation.
	 */
	edit_decision: route(
		z.strictObject({
			decision: Id,
			option: z.string().min(1),
			rationale: z.string().optional(),
			anyway: z.boolean().optional(),
		}),
		async (paths, { decision, option, rationale, anyway }) =>
			editDecision(paths, decision, {
				option,
				rationale,
				anyway,
				by: await whoami(paths.root),
			}),
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

	/**
	 * `attended` is opt-in and never the default, including here. An attended run
	 * stays open for a reply, so a person who starts one and walks away leaves a
	 * session waiting until `stop` or the dispatch timeout — which is a fine
	 * trade for somebody who meant to watch it and a bad surprise for anybody
	 * else (ADR 0046).
	 */
	run: route(
		z.strictObject({
			node: Id,
			base: z.string().optional(),
			anyway: z.boolean().optional(),
			attended: z.boolean().optional(),
		}),
		async (paths, { node: id, base, anyway, attended }) =>
			dispatch(paths, id, { base: await baseOf(paths, base), anyway, attended }),
	),

	/**
	 * Talking to a run somebody is watching (ADR 0046). `done` closes the
	 * session's input, which is how an attended run ends on its own rather than
	 * being killed — the difference between finishing a conversation and hanging
	 * up on it.
	 */
	answer: route(
		z.strictObject({ node: Id, text: z.string().min(1), done: z.boolean().optional() }),
		async (paths, { node: id, text, done }) => answerRun(paths, id, text, { done }),
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
				// §2.8: if the human accepts a flagged node anyway, the `accepted`
				// record says so — which is what puts it in §7.2's stale list with
				// its three actions rather than letting the flag end at the accept.
				flagged: found.flagged,
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

	// DESIGN §7.2's three. None of them runs anything: a decision change can
	// reach thirty nodes, and re-running them unasked is what the impact preview
	// exists to prevent (D37).
	dismiss: route(
		z.strictObject({ node: Id, reason: z.string().min(1) }),
		async (paths, { node: id, reason }) =>
			dismissFlag(paths, id, { by: await whoami(paths.root), reason }),
	),

	reopen: route(node, async (paths, { node: id }) =>
		reopenNode(paths, id, await whoami(paths.root)),
	),

	create_node: route(
		z.strictObject({
			title: z.string().min(1),
			description: z.string().optional(),
			dependsOn: z.array(Id).optional(),
			decisions: z.array(Id).optional(),
			files: z.array(z.string().min(1)).optional(),
		}),
		async (paths, opening) => createNode(paths, { ...opening, by: await whoami(paths.root) }),
	),
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
 * Reads. Four now: what the canvas draws, what `sober status` says, what a
 * human reads before accepting, and what changed since they last looked. The
 * panel and the decision screen added none — `board` already carried what they
 * needed — which is what "a read written before a screen asks for it is a shape
 * guessed from nothing" was protecting.
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
				: [
						{
							id,
							title: record.title,
							status,
							dependsOn: [...record.dependsOn],
							flagged: flagsOf(board, id).flagged,
						},
					]
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

	/**
	 * What changing an answer would reach (§2.8). A read rather than a stored dry
	 * run: `review` and `digest` are shaped this way for the reason §7.1 gives,
	 * and a preview with a lifetime is a record to write, migrate and expire in
	 * exchange for pinning a list the save recomputes anyway (ADR 0044).
	 */
	impact: route(z.strictObject({ decision: Id }), async (paths, { decision }): Promise<Impact> => {
		const found = impactOf(await loadBoard(paths), decision)
		if (found === null) throw new NotOnBoardError('decision', decision)
		return found
	}),

	/**
	 * What changed since you last looked (§7.1). `fetch` is the caller saying
	 * this read may touch the network — §1.2 permits an automatic fetch and
	 * forbids an automatic pull, and the flag is what keeps the permission
	 * something a caller asks for rather than something a route does on every
	 * poll.
	 */
	digest: route(
		z.strictObject({ fetch: z.stringbool().default(false) }),
		async (paths, { fetch }): Promise<Digest> => digest(paths, { fetch }),
	),
}

/**
 * How often the server looks at a live run's log. This is a `stat` on a local
 * file the same machine is writing, not a request — ADR 0036's objection to
 * polling is about the wire, and the wire here carries a line exactly when
 * there is one.
 *
 * A quarter-second is under the threshold where output reads as arriving rather
 * than appearing, and it is the cadence of one process reading one file, which
 * is the cost floor `core` already pays for everything else.
 */
const WATCH_MS = 250

/**
 * A held-open channel, as opposed to a read that answers once (ADR 0046).
 *
 * `open` resolves the subject before the first byte goes out, so "that node has
 * never run" is still a status code rather than an empty stream the screen has
 * to interpret. Everything after that is the iterable, and the caller leaving
 * is an `abort` rather than an error.
 */
export interface Watch {
	readonly accepts: z.ZodType
	readonly open: (
		paths: Paths,
		query: unknown,
		signal: AbortSignal,
	) => Promise<AsyncIterable<LogWindow>>
}

/** `route`'s twin, for the channels: parse first, so `open` never sees an unchecked query. */
const watch = <I>(
	accepts: z.ZodType<I>,
	open: (paths: Paths, input: I, signal: AbortSignal) => Promise<AsyncIterable<LogWindow>>,
): Watch => ({
	accepts,
	open: async (paths, query, signal) => open(paths, accepts.parse(query), signal),
})

/**
 * The run log, and nothing else (ADR 0046). ADR 0036 named it as the one place
 * polling is the wrong shape, and this is that one place — a sixth entry here
 * wants the same argument made again for whatever it is.
 *
 * A screen names a node, because a run id is local and disposable (§5.5) and
 * the canvas has never seen one. `run` is accepted too, so a screen already
 * watching one attempt is not moved to a newer one underneath it.
 */
export const WATCHES: Readonly<Record<string, Watch>> = {
	logs: watch(
		z
			.strictObject({
				node: Id.optional(),
				run: z.string().min(1).optional(),
				/** Where a reconnecting screen left off, in bytes. */
				from: z.coerce.number().int().nonnegative().optional(),
			})
			.refine(
				(query) => query.node !== undefined || query.run !== undefined,
				'name a node or a run to watch',
			),

		async (paths, { node, run, from }, signal) => {
			const id = run ?? (node === undefined ? undefined : lastRun(await loadBoard(paths), node)?.id)
			// A `SoberError`, not an `Error`: the request was understood and the
			// state said no, which is a 409 rather than a 500 on the wire — and it
			// is refused here, before a byte of the channel goes out, because after
			// that there is no status left to send.
			if (id === undefined)
				throw new SoberError(
					'no-run',
					`${node} has not run yet — there is no log to read until it is dispatched`,
				)

			return follow(paths, id, from, signal)
		},
	),
}

/**
 * The loop behind the channel. It yields a window when there is something to
 * say and when the run ends, and stays quiet in between — a live run that is
 * thinking sends no bytes, which is what makes an open tab cheap.
 *
 * It ends itself on a run that is over. Nothing will append to that log again,
 * so holding the connection would be a promise the file cannot keep, and a tab
 * left open on yesterday's node costs nothing once this returns.
 */
async function* follow(
	paths: Paths,
	id: string,
	from: number | undefined,
	signal: AbortSignal,
): AsyncIterable<LogWindow> {
	let offset = from
	let first = true

	while (!signal.aborted) {
		const window = await followRun(paths, id, { from: offset })
		// The first window always goes out, even empty: it carries the offset a
		// reconnecting screen resumes from, and `live`, which is how the screen
		// knows whether to expect anything at all.
		if (first || window.lines.length > 0 || !window.live) yield window
		offset = window.offset
		first = false

		if (!window.live) return
		await new Promise((resolve) => {
			const timer = setTimeout(resolve, WATCH_MS)
			signal.addEventListener(
				'abort',
				() => {
					clearTimeout(timer)
					resolve(null)
				},
				{ once: true },
			)
		})
	}
}

export { OPERATIONS }
