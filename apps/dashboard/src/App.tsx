import type { Projection } from '@besober/schema'
import { useEffect, useMemo, useState } from 'react'
import { Canvas } from './canvas/Canvas.js'
import { wire } from './wire.js'

/**
 * ADR 0036 chose polling over a push channel: one route per operation, and
 * freshness by asking again. Two seconds is below the time it takes to notice
 * and far above the cost of a loopback request against a board on disk.
 */
const POLL_MS = 2000

export const App = ({ token }: { readonly token: string | null }): React.JSX.Element => {
	const [projection, setProjection] = useState<Projection | null>(null)
	const [failure, setFailure] = useState<string | null>(null)
	const [withDone, setWithDone] = useState(false)

	useEffect(() => {
		if (token === null) return
		const board = wire(token)
		let stopped = false

		const poll = async (): Promise<void> => {
			try {
				const next = await board.read<Projection>('projection')
				if (stopped) return
				setProjection(next)
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
	}, [token])

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

			<main className="min-h-0 flex-1">
				{shown === null ? <Waiting /> : <Canvas projection={shown} />}
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
