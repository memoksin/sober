import { useState } from 'react'
import { Inline } from '../markdown.js'
import { Overlay } from '../Overlay.js'
import type { BoardRead } from '../panel/data.js'
import type { DecisionFilter } from './data.js'
import { decisionRows, filterDecisionRows } from './data.js'

const FILTERS: readonly { readonly value: DecisionFilter; readonly label: string }[] = [
	{ value: 'all', label: 'All' },
	{ value: 'open', label: 'Open' },
	{ value: 'answered', label: 'Answered' },
	{ value: 'derived', label: 'Derived' },
]

/** Every decision on the board and what was chosen. Read-only: answering stays on `deciding`. */
export const DecisionsScreen = ({
	board,
	onClose,
}: {
	readonly board: BoardRead
	readonly onClose: () => void
}): React.JSX.Element => {
	const [expanded, setExpanded] = useState<string | null>(null)
	const [filter, setFilter] = useState<DecisionFilter>('all')
	const rows = decisionRows(board)
	const open = rows.filter((row) => row.state === 'open').length
	const visible = filterDecisionRows(rows, filter)

	return (
		<Overlay label="Every decision" width={720} onClose={onClose}>
			<header className="border-[var(--line)] border-b px-5 py-4">
				<h2 className="font-medium text-[length:var(--text-sm)] text-[var(--ink)]">
					What this project has decided
				</h2>
				<p className="mt-1 text-[var(--ink-dim)] text-xs">
					{rows.length} decisions · {open} still open
				</p>
				<label className="mt-2 flex items-center gap-2 text-[var(--ink-dim)] text-xs">
					Filter
					<select
						value={filter}
						onChange={(event) => setFilter(event.target.value as DecisionFilter)}
						className="border border-[var(--line)] bg-transparent px-1.5 py-0.5 text-[var(--ink)] text-xs"
					>
						{FILTERS.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</label>
			</header>

			<div className="flex-1 overflow-y-auto px-5 py-4">
				{visible.length === 0 ? (
					<p className="text-[var(--ink-dim)] text-xs">No decisions match this filter.</p>
				) : (
					<ul className="flex flex-col gap-3">
						{visible.map((row) => (
							<li key={row.id} className="flex flex-col gap-1">
								<button
									type="button"
									aria-expanded={expanded === row.id}
									onClick={() => setExpanded((was) => (was === row.id ? null : row.id))}
									className="flex flex-col gap-0.5 text-left"
								>
									<span className="flex items-baseline gap-2">
										<span className="font-medium text-[var(--ink)] text-xs">
											<Inline text={row.question} />
										</span>
										<span className="ml-auto font-mono text-[10px] text-[var(--ink-faint)]">
											{row.category} · {row.state}
										</span>
									</span>
									{row.chosen !== null && row.answer !== null ? (
										// Inline, not Markdown: this sits inside a button, where block output does not belong.
										<>
											<span className="flex items-baseline gap-2 text-[var(--ink)] text-xs">
												{row.chosen.label}
											</span>
											{row.answer.derived !== null && (
												<span className="break-words text-[var(--ink-faint)] text-xs">
													read off: {row.answer.derived}
												</span>
											)}
											<span className="text-[var(--ink-dim)] text-xs leading-[var(--leading-prose)]">
												<Inline text={row.answer.rationale} />
											</span>
										</>
									) : (
										<span className="text-[var(--ink-dim)] text-xs">
											Unanswered · holds {row.nodes.length}{' '}
											{row.nodes.length === 1 ? 'node' : 'nodes'}
										</span>
									)}
								</button>

								{expanded === row.id && (
									<div className="flex flex-col gap-2 border-[var(--line)] border-l pl-3 text-xs">
										{row.chosen !== null && (
											<p className="text-[var(--ink-dim)]">
												Cost later: <Inline text={row.chosen.costLater} />
											</p>
										)}
										{row.notPicked.length > 0 && (
											<ul className="flex flex-col gap-1">
												{row.notPicked.map((option) => (
													<li key={option.id} className="text-[var(--ink-dim)]">
														<span className="text-[var(--ink)]">{option.label}</span> —{' '}
														<Inline text={option.reason} /> Cost later:{' '}
														<Inline text={option.costLater} />
													</li>
												))}
											</ul>
										)}
										<p className="text-[var(--ink-faint)]">
											{row.nodes.length === 0
												? 'No node binds it.'
												: `Bound to: ${row.nodes.map((node) => node.title).join(', ')}`}
										</p>
									</div>
								)}
							</li>
						))}
					</ul>
				)}
			</div>
		</Overlay>
	)
}
