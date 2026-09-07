import type { Distribution, ProjectedNode } from '@besober/schema'
import { Overlay } from '../Overlay.js'
import { passedOver, rows } from './data.js'

/**
 * The plan a session proposed, read on the screen (ADR 0051). It is a stopping
 * screen rather than a strip: assigning thirty nodes at once is not a glance,
 * and the reason each match carries is the whole point of reading it — the
 * conversation that produced it happened somewhere this window cannot see.
 *
 * There is no per-row control. A plan is taken whole or dropped whole, for the
 * reason ADR 0004 gives about proposed nodes: the risk on an assignment is that
 * it is wrong, which is visible on the board and undone by one reassignment.
 */
export const DistributionScreen = ({
	plan,
	nodes,
	onAccept,
	onDrop,
	onClose,
}: {
	readonly plan: Distribution
	readonly nodes: readonly ProjectedNode[]
	readonly onAccept: () => void
	readonly onDrop: () => void
	readonly onClose: () => void
}): React.JSX.Element => {
	const listed = rows(plan, nodes)
	const skipped = passedOver(plan)

	return (
		<Overlay label="The proposed distribution" width={640} onClose={onClose}>
			<header className="border-[var(--line)] border-b px-5 py-4">
				<h2 className="font-medium text-[length:var(--text-sm)] text-[var(--ink)]">
					Who takes what
				</h2>
				<p className="mt-1 text-[var(--ink-dim)] text-xs">
					Proposed by {plan.by}. Nothing is assigned until you take it.
				</p>
			</header>

			<div className="flex-1 overflow-y-auto px-5 py-4">
				{listed.length === 0 ? (
					<p className="text-[var(--ink-dim)] text-xs">
						This plan proposes nothing — every node it reached for is somebody else’s already, or
						finished.
					</p>
				) : (
					<ul className="flex flex-col gap-3">
						{listed.map((row) => (
							<li key={row.node} className="flex flex-col gap-0.5">
								<span className="flex items-baseline gap-2">
									<span className="font-medium text-[var(--ink)] text-xs">{row.handle}</span>
									<span className="text-[var(--ink-dim)] text-xs">{row.title}</span>
									<span className="ml-auto font-mono text-[10px] text-[var(--ink-faint)]">
										{row.node}
									</span>
								</span>
								<span className="text-[var(--ink-dim)] text-xs leading-[var(--leading-prose)]">
									{row.because}
								</span>
							</li>
						))}
					</ul>
				)}

				{skipped !== null && (
					<p className="mt-4 border-[var(--line)] border-t pt-3 text-[var(--ink-faint)] text-xs">
						{skipped}
					</p>
				)}
			</div>

			<footer className="flex items-center gap-2 border-[var(--line)] border-t px-5 py-3">
				{/*
				  Dropping is a first-class way out and sits beside accepting, not
				  behind a menu. Without it the only exit from a plan somebody
				  disagrees with is applying it (ADR 0051).
				*/}
				<button
					type="button"
					onClick={onDrop}
					className="rounded-[var(--radius-sm)] px-3 py-1.5 text-[var(--ink-dim)] text-xs hover:bg-[var(--surface)] hover:text-[var(--ink)]"
				>
					Drop it
				</button>
				{listed.length > 0 && (
					<button
						type="button"
						onClick={onAccept}
						className="ml-auto rounded-[var(--radius-sm)] bg-[var(--ink)] px-3 py-1.5 text-[var(--bg)] text-xs"
					>
						Assign {listed.length === 1 ? 'it' : `all ${listed.length}`}
					</button>
				)}
			</footer>
		</Overlay>
	)
}
