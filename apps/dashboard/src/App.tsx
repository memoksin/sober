import type { Projection, Review } from '@besober/schema'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Canvas } from './canvas/Canvas.js'
import { DecisionScreen } from './panel/Decision.js'
import type { Action, BoardRead } from './panel/data.js'
import { Panel } from './panel/Panel.js'
import { ReviewScreen } from './review/Review.js'
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

	// The full board is only read while something is open. The canvas needs the
	// slim projection every couple of seconds (ADR 0008); a drawer that is not
	// there needs nothing at all.
	const open = picked !== null || deciding !== null

	useEffect(() => {
		if (token === null) return
		const surface = wire(token)
		let stopped = false

		const poll = async (): Promise<void> => {
			try {
				const [next, full] = await Promise.all([
					surface.read<Projection>('projection'),
					open ? surface.read<BoardRead>('board') : Promise.resolve(null),
				])
				if (stopped) return
				setProjection(next)
				if (full !== null) setBoard(full)
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

	// One way out of everything, and the one a person tries first.
	useEffect(() => {
		const back = (event: KeyboardEvent): void => {
			if (event.key !== 'Escape') return
			// One layer at a time: a screen opened from a node goes back to that
			// node rather than clearing the board out from under it.
			if (reviewing !== null) setReviewing(null)
			else if (deciding !== null) setDeciding(null)
			else setPicked(null)
		}
		addEventListener('keydown', back)
		return () => removeEventListener('keydown', back)
	}, [deciding, reviewing])

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

			await surface.op(does, { node })
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

	// `done` is off by default: a board keeps its finished work, and after a few
	// weeks that is most of what is on it (ADR 0039 §1 — done is the one status
	// whose colour inverts between themes, because it is the one that recedes).
	const shown = useMemo<Projection | null>(
		() =>
			projection === null || withDone
				? projection
				: { nodes: projection.nodes.filter((node) => node.status !== 'done') },
		[projection, withDone],
	)

	if (token === null) return <Adrift />

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
						onClose={() => setPicked(null)}
						onPick={setPicked}
						onDecide={setDeciding}
						onDo={(does) => doTo(picked, does)}
					/>
				)}

				{deciding !== null && board !== null && (
					<DecisionScreen
						board={board}
						id={deciding}
						onClose={() => setDeciding(null)}
						onAnswer={answer}
					/>
				)}

				{reviewing !== null && (
					<ReviewScreen
						review={reviewing}
						onClose={() => setReviewing(null)}
						onAccept={() => settle('accept')}
						onReject={(text) => settle('reject', text)}
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
