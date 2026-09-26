import type { BoardDistance, Resolution, SyncResult } from '@besober/core'
import type {
	Digest as DigestRead,
	Distribution,
	Impact,
	Projection,
	Review,
} from '@besober/schema'
import { decisionState } from '@besober/schema'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Canvas } from './canvas/Canvas.js'
import { visible } from './canvas/graph.js'
import { DecisionsScreen } from './decisions/Decisions.js'
import { Digest } from './digest/Digest.js'
import { worthShowing } from './digest/data.js'
import { DistributionScreen } from './distribute/Distribution.js'
import { readPlan, waiting } from './distribute/data.js'
import { mergeThinkingVerbs, THINKING_VERBS } from './logs/data.js'
import { LogScreen } from './logs/Logs.js'
import { DecisionScreen } from './panel/Decision.js'
import type { Action, BoardRead, FlagAction } from './panel/data.js'
import { flagOp } from './panel/data.js'
import { Panel } from './panel/Panel.js'
import { ReviewScreen } from './review/Review.js'
import { ConflictScreen } from './sync/Conflicts.js'
import { wire } from './wire.js'

/**
 * ADR 0036 chose polling over a push channel: one route per operation, and
 * freshness by asking again. Two seconds is below the time it takes to notice
 * and far above the cost of a loopback request against a board on disk.
 */
const POLL_MS = 2000

export const App = ({ token }: { readonly token: string | null }): React.JSX.Element => {
	const [projection, setProjection] = useState<Projection | null>(null)
	const [board, setBoard] = useState<BoardRead | null>(null)
	const [failure, setFailure] = useState<string | null>(null)
	const [withDone, setWithDone] = useState(false)
	const [picked, setPicked] = useState<string | null>(null)
	const [deciding, setDeciding] = useState<string | null>(null)
	const [reviewing, setReviewing] = useState<Review | null>(null)
	// Which node's run is open, or null. A node id rather than a run id: a run id
	// is local and disposable (§5.5), and the server resolves the newest one.
	const [watching, setWatching] = useState<string | null>(null)
	const [digest, setDigest] = useState<DigestRead | null>(null)
	// The plan a session proposed, when there is one (ADR 0051), and whether it
	// is open. Two pieces of state rather than one: the bar has to keep saying
	// a plan is waiting after the screen behind it is closed.
	const [plan, setPlan] = useState<Distribution | null>(null)
	const [planOpen, setPlanOpen] = useState(false)
	const [decisionsOpen, setDecisionsOpen] = useState(false)
	// A plan that will not parse is the bar's problem and never the canvas's
	// (§8.4): one bad record has never taken the board down, and a read added to
	// the poll is exactly how that stops being true.
	const [planFailure, setPlanFailure] = useState<string | null>(null)
	// §7.2's list, as a view over the canvas rather than a sixth screen. The
	// nodes are already drawn; what was missing is which of them are flagged.
	const [onlyFlagged, setOnlyFlagged] = useState(false)
	// A sync that ran and came back conflicted is a result; the op rejecting is
	// a failure. Kept apart so a thrown error is never read as a sync outcome.
	const [syncing, setSyncing] = useState(false)
	const [synced, setSynced] = useState<SyncResult | null>(null)
	const [syncFailure, setSyncFailure] = useState<string | null>(null)
	const [conflictsOpen, setConflictsOpen] = useState(false)
	// Read on load and after a sync, never on the poll: it fetches the remote.
	const [distance, setDistance] = useState<BoardDistance | null>(null)

	// The full board is only read while something is open. The canvas needs the
	// slim projection every couple of seconds (ADR 0008); a drawer that is not
	// there needs nothing at all.
	const open = picked !== null || deciding !== null || decisionsOpen

	useEffect(() => {
		if (token === null) return
		const surface = wire(token)
		let stopped = false

		const poll = async (): Promise<void> => {
			try {
				// The plan is on the poll rather than read once on open: it is
				// proposed in a session the user is sitting in, and the dashboard is
				// the next window they look at. One small file, read beside the
				// projection that is already being asked for.
				const [next, full, proposed] = await Promise.all([
					surface.read<Projection>('projection'),
					open ? surface.read<BoardRead>('board') : Promise.resolve(null),
					readPlan(surface),
				])
				if (stopped) return
				setProjection(next)
				if (full !== null) setBoard(full)
				setPlan(proposed.plan)
				setPlanFailure(proposed.failure)
				setFailure(null)
			} catch (error) {
				if (!stopped) setFailure(error instanceof Error ? error.message : String(error))
			}
		}

		void poll()
		const timer = setInterval(() => void poll(), POLL_MS)
		return () => {
			stopped = true
			clearInterval(timer)
		}
	}, [token, open])

	/**
	 * Coming back (§7.1). Read once, on open, and never on the poll: the delta
	 * half costs a `git fetch`, which §1.2 permits automatically precisely
	 * because it moves one ref and touches no file — but permitting it every two
	 * seconds is a different thing than permitting it.
	 *
	 * A digest that cannot be read is not an error on the board. The five things
	 * it reports are all still visible elsewhere; this is the sentence that saves
	 * a person hunting for them.
	 */
	useEffect(() => {
		if (token === null) return
		let stopped = false
		void wire(token)
			.read<DigestRead>('digest', { fetch: 'true' })
			.then((seen) => {
				if (!stopped && worthShowing(seen)) setDigest(seen)
			})
			// A read that failed outright says so in the bar it would have filled,
			// rather than in the failure line the poll clears two seconds later.
			// The digest already has a field for "this half could not be read".
			.catch((error: unknown) => {
				if (stopped) return
				setDigest({
					delta: null,
					unreachable: error instanceof Error ? error.message : String(error),
					inReview: [],
					flagged: [],
				})
			})
		return () => {
			stopped = true
		}
	}, [token])

	// One way out of everything, and the one a person tries first.
	useEffect(() => {
		const back = (event: KeyboardEvent): void => {
			if (event.key !== 'Escape') return
			// One layer at a time: a screen opened from a node goes back to that
			// node rather than clearing the board out from under it.
			if (planOpen) setPlanOpen(false)
			else if (decisionsOpen) setDecisionsOpen(false)
			else if (watching !== null) setWatching(null)
			else if (reviewing !== null) setReviewing(null)
			else if (deciding !== null) setDeciding(null)
			else setPicked(null)
		}
		addEventListener('keydown', back)
		return () => removeEventListener('keydown', back)
	}, [deciding, decisionsOpen, planOpen, reviewing, watching])

	/**
	 * What the board says now, after something changed it. Read rather than
	 * patched: answering a decision or accepting work frees whatever was waiting
	 * on it, and the board is the only thing that knows which.
	 */
	const refresh = useCallback(async (): Promise<void> => {
		if (token === null) return
		const surface = wire(token)
		const [full, next] = await Promise.all([
			surface.read<BoardRead>('board'),
			surface.read<Projection>('projection'),
		])
		setBoard(full)
		setProjection(next)
	}, [token])

	// A failed read shows nothing: a board that cannot reach its remote is still usable.
	const measure = useCallback(async (): Promise<void> => {
		if (token === null) return
		setDistance(
			await wire(token)
				.read<BoardDistance>('distance')
				.catch(() => null),
		)
	}, [token])

	useEffect(() => {
		void measure()
	}, [measure])

	const sync = useCallback(async (): Promise<void> => {
		if (token === null || syncing) return
		setSyncing(true)
		setSynced(null)
		setSyncFailure(null)
		try {
			const result = await wire(token).op<SyncResult>('sync', {})
			setSynced(result)
			setConflictsOpen(result.kind === 'conflicted')
			// A sync can change every record at once, so the board is read again.
			await refresh()
		} catch (error) {
			setSyncFailure(error instanceof Error ? error.message : String(error))
		} finally {
			setSyncing(false)
			void measure()
		}
	}, [token, syncing, refresh, measure])

	const answer = useCallback(
		async (option: string, rationale: string): Promise<void> => {
			if (token === null || deciding === null) return
			await wire(token).op('decide', { decision: deciding, option, rationale })
			await refresh()
			setDeciding(null)
		},
		[token, deciding, refresh],
	)

	/**
	 * §2.8's two halves, and they are one operation with a flag plus one read
	 * (ADR 0044). The preview is asked for by the screen and never on open: a
	 * read that runs because a drawer opened is a fan-out nobody asked to see.
	 */
	const preview = useCallback(
		async (decision: string): Promise<Impact> => {
			if (token === null) throw new Error('the dashboard has no token for this board')
			return wire(token).read<Impact>('impact', { decision })
		},
		[token],
	)

	const edit = useCallback(
		async (option: string, rationale: string): Promise<void> => {
			if (token === null || deciding === null) return
			await wire(token).op('edit_decision', {
				decision: deciding,
				option,
				rationale,
				// The confirmation. The screen showed the fan-out before this ran,
				// which is what the flag asserts on every surface (ADR 0032).
				anyway: true,
			})
			await refresh()
			setDeciding(null)
		},
		[token, deciding, refresh],
	)

	/**
	 * Approve, run, stop — or open the review, which is a screen rather than an
	 * operation. Nothing decides here what is allowed: `actions` offers only what
	 * the status permits, and `core` is what refuses.
	 */
	const doTo = useCallback(
		async (node: string, does: Action['does']): Promise<void> => {
			if (token === null) return
			const surface = wire(token)

			if (does === 'review') {
				setReviewing(await surface.read<Review>('review', { node }))
				return
			}

			// The two that open a screen rather than change the board. Nothing is
			// read here: the channel is opened by the screen, so closing it is what
			// closes the connection (ADR 0046).
			if (does === 'logs') {
				setWatching(node)
				return
			}

			// Start it and sit with it. The screen opens first and the dispatch is
			// left running: `run` does not answer until the agent is finished, and
			// an attended run is finished when the human says so — waiting for it
			// here would open the log after the thing it was meant to watch.
			if (does === 'watch') {
				setWatching(node)
				void surface
					.op('run', { node, attended: true })
					.then(refresh)
					.catch((error: unknown) =>
						setFailure(error instanceof Error ? error.message : String(error)),
					)
				await refresh()
				return
			}

			await surface.op(does, { node })
			await refresh()
		},
		[token, refresh],
	)

	/**
	 * §7.2's three actions. None of them runs anything: one decision change can
	 * reach thirty nodes, and re-running them unasked is what the impact preview
	 * exists to prevent (D37). Reopening leaves the node `ready` and the panel's
	 * ordinary Run button is what starts it.
	 */
	const onFlag = useCallback(
		async (node: string, does: FlagAction['does'], words = ''): Promise<void> => {
			if (token === null) return
			const [operation, body] = flagOp(node, does, words)
			await wire(token).op(operation, body)
			await refresh()
		},
		[token, refresh],
	)

	/**
	 * §3.3's plan, taken whole or taken off the board. Both close the screen: the
	 * record they were about is gone either way, and the poll is what says so.
	 */
	const onPlan = useCallback(
		async (does: 'accept_distribution' | 'drop_distribution'): Promise<void> => {
			if (token === null) return
			await wire(token).op(does, {})
			setPlan(null)
			setPlanOpen(false)
			await refresh()
		},
		[token, refresh],
	)

	const settle = useCallback(
		async (how: 'accept' | 'reject', text?: string): Promise<void> => {
			if (token === null || reviewing === null) return
			const surface = wire(token)
			await surface.op(
				how,
				how === 'accept' ? { node: reviewing.node } : { node: reviewing.node, text },
			)
			await refresh()
			setReviewing(null)
		},
		[token, reviewing, refresh],
	)

	/**
	 * ADR 0049: the acceptance list re-run on demand, against the worktree a run
	 * already left. The screen stays open — this replaces the shown results with
	 * the fresh review rather than closing, the way accept and reject do.
	 */
	const onAudit = useCallback(async (): Promise<void> => {
		if (token === null || reviewing === null) return
		const surface = wire(token)
		await surface.op('audit', { node: reviewing.node })
		setReviewing(await surface.read<Review>('review', { node: reviewing.node }))
		await refresh()
	}, [token, reviewing, refresh])

	// `done` is off by default: a board keeps its finished work, and after a few
	// weeks that is most of what is on it (ADR 0039 §1 — done is the one status
	// whose colour inverts between themes, because it is the one that recedes).
	/**
	 * One client for the screens that hold a connection open. `wire` is cheap to
	 * build, but a new object every render would restart the log's channel on
	 * every poll — reopening a stream is not the same kind of harmless as
	 * repeating a read.
	 */
	const surface = useMemo(() => (token === null ? null : wire(token)), [token])

	const shown = useMemo<Projection | null>(
		() => (projection === null ? null : visible(projection, { withDone, onlyFlagged })),
		[projection, withDone, onlyFlagged],
	)

	if (token === null) return <Adrift />

	const openDecisions =
		board?.decisions.filter((one) => !one.archived && decisionState(one) === 'open').length ?? 0
	const hidden = (projection?.nodes.length ?? 0) - (shown?.nodes.length ?? 0)

	return (
		<div className="flex h-screen w-screen flex-col bg-[var(--bg)] text-[var(--ink)]">
			<header className="flex h-10 shrink-0 items-center gap-4 border-b border-[var(--line)] px-4">
				<span className="font-medium text-[var(--ink)] text-xs tracking-widest">SOBER</span>
				<span className="text-[var(--ink-faint)] text-xs tabular-nums">
					{shown === null ? 'reading the board…' : `${shown.nodes.length} nodes`}
				</span>

				<button
					type="button"
					onClick={() => setDecisionsOpen(true)}
					className="flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1 text-[var(--ink-dim)] text-xs hover:bg-[var(--surface)] hover:text-[var(--ink)]"
				>
					{openDecisions > 0 ? `${openDecisions} open decisions` : 'decisions'}
				</button>

				<button
					type="button"
					onClick={() => void sync()}
					disabled={syncing}
					className="flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1 text-[var(--ink-dim)] text-xs hover:bg-[var(--surface)] hover:text-[var(--ink)] disabled:opacity-50"
				>
					{syncing ? 'syncing…' : 'sync'}
				</button>
				{distance !== null && distancePhrase(distance) !== null && (
					<span className="text-[var(--ink-faint)] text-xs tabular-nums">
						{distancePhrase(distance)}
					</span>
				)}

				<button
					type="button"
					onClick={() => setWithDone((on) => !on)}
					aria-pressed={withDone}
					className="ml-auto flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1 text-[var(--ink-dim)] text-xs hover:bg-[var(--surface)] hover:text-[var(--ink)]"
				>
					<span
						aria-hidden
						className="size-2 rounded-full"
						style={{
							background: withDone ? 'var(--status-done)' : 'transparent',
							boxShadow: withDone ? 'none' : 'inset 0 0 0 1px var(--line)',
						}}
					/>
					{withDone ? 'showing done' : `${hidden} done hidden`}
				</button>
			</header>

			{digest !== null && (
				<Digest
					digest={digest}
					onOnlyFlagged={() => setOnlyFlagged(true)}
					onClose={() => setDigest(null)}
				/>
			)}

			{syncFailure !== null && (
				<p
					role="alert"
					className="shrink-0 border-[var(--line)] border-b bg-[var(--raised)] px-4 py-1.5 text-[var(--ink)] text-xs"
				>
					The sync did not run: {syncFailure}
				</p>
			)}

			{synced !== null && (
				<p className="shrink-0 border-[var(--line)] border-b bg-[var(--raised)] px-4 py-1.5 text-[var(--ink-dim)] text-xs">
					{syncSentence(synced)}
				</p>
			)}

			{planFailure !== null && (
				<p className="shrink-0 border-[var(--line)] border-b bg-[var(--raised)] px-4 py-1.5 text-[var(--ink-dim)] text-xs">
					The proposed distribution cannot be read: {planFailure} · `sober distribute --drop` takes
					it off the board.
				</p>
			)}

			{plan !== null && !planOpen && (
				<button
					type="button"
					onClick={() => setPlanOpen(true)}
					className="shrink-0 border-[var(--line)] border-b bg-[var(--raised)] px-4 py-1.5 text-left text-[var(--ink-dim)] text-xs hover:text-[var(--ink)]"
				>
					A distribution is waiting · {waiting(plan)} · read it
				</button>
			)}

			{onlyFlagged && (
				<button
					type="button"
					onClick={() => setOnlyFlagged(false)}
					className="shrink-0 border-[var(--line)] border-b bg-[var(--raised)] px-4 py-1.5 text-left text-[var(--ink-dim)] text-xs hover:text-[var(--ink)]"
				>
					Showing only flagged nodes · show the whole board
				</button>
			)}

			{failure !== null && (
				<p className="shrink-0 border-[var(--line)] border-b bg-[var(--surface)] px-4 py-1.5 text-[var(--danger)] text-xs">
					{failure}
				</p>
			)}

			<main className="relative min-h-0 flex-1">
				{shown === null ? <Waiting /> : <Canvas projection={shown} onPick={setPicked} />}

				{picked !== null && board !== null && (
					<Panel
						board={board}
						id={picked}
						flagged={projection?.nodes.find((one) => one.id === picked)?.flagged ?? false}
						onClose={() => setPicked(null)}
						onPick={setPicked}
						onDecide={setDeciding}
						onDo={(does) => doTo(picked, does)}
						onDismiss={(reason) => onFlag(picked, 'dismiss', reason)}
						onReopen={() => onFlag(picked, 'reopen')}
						onOpen={(title) => onFlag(picked, 'open', title)}
					/>
				)}

				{deciding !== null && board !== null && (
					<DecisionScreen
						board={board}
						id={deciding}
						onClose={() => setDeciding(null)}
						onAnswer={answer}
						onPreview={preview}
						onEdit={edit}
					/>
				)}

				{watching !== null && surface !== null && (
					<LogScreen
						node={watching}
						surface={surface}
						onClose={() => setWatching(null)}
						verbs={mergeThinkingVerbs(THINKING_VERBS, board?.thinkingVerbs ?? null)}
					/>
				)}

				{decisionsOpen && board !== null && (
					<DecisionsScreen
						board={board}
						onAsk={async (body) => {
							if (token === null) return
							await wire(token).op('create_decision', body)
							await refresh()
						}}
						onClose={() => setDecisionsOpen(false)}
					/>
				)}

				{conflictsOpen && synced?.kind === 'conflicted' && token !== null && (
					<ConflictScreen
						conflicts={synced.conflicts}
						resolve={(record, choices) =>
							wire(token).op<Resolution>('resolve', { record, choices })
						}
						onDone={() => {
							setConflictsOpen(false)
							void sync()
						}}
						onClose={() => setConflictsOpen(false)}
					/>
				)}

				{planOpen && plan !== null && (
					<DistributionScreen
						plan={plan}
						nodes={projection?.nodes ?? []}
						onAccept={() => void onPlan('accept_distribution')}
						onDrop={() => void onPlan('drop_distribution')}
						onClose={() => setPlanOpen(false)}
					/>
				)}

				{reviewing !== null && (
					<ReviewScreen
						review={reviewing}
						onClose={() => setReviewing(null)}
						onAccept={() => settle('accept')}
						onReject={(text) => settle('reject', text)}
						onAudit={onAudit}
					/>
				)}
			</main>
		</div>
	)
}

const Waiting = (): React.JSX.Element => (
	<p className="flex h-full items-center justify-center text-[var(--ink-faint)] text-xs">
		reading the board…
	</p>
)

/**
 * Someone bookmarked the address. The token travels in the fragment and the
 * fragment is not part of a bookmark's usefulness, so this is a normal thing
 * to arrive at — and the fix is one line the command already printed.
 */
const Adrift = (): React.JSX.Element => (
	<div className="flex h-screen flex-col items-center justify-center gap-3 bg-[var(--bg)] px-6 text-center">
		<p className="text-[var(--ink)] text-sm">This page has no dashboard token.</p>
		<p className="max-w-md text-[var(--ink-dim)] text-xs leading-relaxed">
			Open the address <code className="font-mono text-[var(--ink)]">sober dashboard</code> printed.
			A new token is minted every time the command starts, so an address from an earlier run will
			not work either.
		</p>
	</div>
)

const plural = (count: number, one: string): string => `${count} ${one}${count === 1 ? '' : 's'}`

/** One sentence per kind, read off the record's fields. */
/** The hook's words for the same board, so the terminal and the screen agree. */
export const distancePhrase = (distance: BoardDistance): string | null => {
	if (distance.kind === 'offline') return 'offline'
	if (distance.kind === 'no-remote') return null
	if (distance.pulled !== null) return `pulled ${distance.behind}`
	const said = [
		...(distance.behind > 0 ? [`${distance.behind} behind`] : []),
		...(distance.ahead > 0 ? [`${distance.ahead} unsent`] : []),
	]
	return said.length === 0 ? null : said.join(' · ')
}

export const syncSentence = (result: SyncResult): string => {
	switch (result.kind) {
		case 'synced': {
			const { updated, removed } = result.pulled
			const came =
				updated.length + removed.length === 0
					? 'nothing came in'
					: `${plural(updated.length, 'record')} came in updated and ${plural(removed.length, 'record')} removed`
			const went = result.pushed && result.outgoing ? 'your changes went out' : 'nothing went out'
			return `Synced: ${came}, ${went}.`
		}
		case 'no-remote':
			return 'The board was committed here. There is no remote to send it to.'
		case 'invalid':
			return `The merge left a board that does not hold together, so nothing was pushed: ${result.findings.join('; ')}.`
		case 'conflicted':
			return `Nothing was touched: ${result.conflicts.map((one) => one.id).join(', ')} changed on both sides. Each one has to be answered field by field.`
	}
}
