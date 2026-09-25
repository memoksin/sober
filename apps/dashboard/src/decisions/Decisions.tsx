import { CATEGORIES, type Category } from '@besober/schema'
import { useState } from 'react'
import { Inline } from '../markdown.js'
import { Overlay } from '../Overlay.js'
import type { BoardRead } from '../panel/data.js'
import { pending } from '../pending.js'
import {
	bindable,
	type DecisionFilter,
	decisionRows,
	filterDecisionRows,
	type QuestionForm,
	questionBody,
	waitingLabel,
} from './data.js'

const FILTERS: readonly { readonly value: DecisionFilter; readonly label: string }[] = [
	{ value: 'all', label: 'All' },
	{ value: 'open', label: 'Open' },
	{ value: 'answered', label: 'Answered' },
	{ value: 'derived', label: 'Derived' },
]

/**
 * Every decision on the board and what was chosen. Answering stays on
 * `deciding`; the one thing written here is a new question, which arrives with
 * no options — a session produces those (§2.6).
 */
export const DecisionsScreen = ({
	board,
	onClose,
	onCreate,
}: {
	readonly board: BoardRead
	readonly onClose: () => void
	readonly onCreate: (body: QuestionForm) => Promise<void>
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
				<NewQuestion board={board} onCreate={onCreate} />
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
										<span className="text-[var(--ink-dim)] text-xs">{waitingLabel(row)}</span>
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

/**
 * A question a person already knows they want answered: the words, one of the
 * four categories, and the nodes it holds. Each of those reads held from the
 * moment it is sent.
 */
const NewQuestion = ({
	board,
	onCreate,
}: {
	readonly board: BoardRead
	readonly onCreate: (body: QuestionForm) => Promise<void>
}): React.JSX.Element => {
	const [asking, setAsking] = useState(false)
	const [question, setQuestion] = useState('')
	const [category, setCategory] = useState<Category>(CATEGORIES[0])
	const [binds, setBinds] = useState<readonly string[]>([])
	const [busy, setBusy] = useState(false)
	const [refused, setRefused] = useState<string | null>(null)
	const body = questionBody({ question, category, binds })

	const send = async (): Promise<void> => {
		if (body === null) return
		setBusy(true)
		setRefused(null)
		try {
			await onCreate(body)
			setAsking(false)
			setQuestion('')
			setBinds([])
		} catch (error) {
			setRefused(error instanceof Error ? error.message : String(error))
		} finally {
			setBusy(false)
		}
	}

	if (!asking)
		return (
			<button
				type="button"
				onClick={() => setAsking(true)}
				className="mt-3 rounded-[var(--radius-sm)] border border-[var(--line)] px-3 py-1.5 text-[var(--ink-dim)] text-xs hover:text-[var(--ink)]"
			>
				Open a question
			</button>
		)

	const field =
		'rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-[var(--ink)] text-xs focus:border-[var(--ink-faint)] focus:outline-none'
	const caption = 'font-medium text-[10px] text-[var(--ink-faint)] uppercase tracking-wider'

	return (
		<div className="mt-3 flex flex-col gap-2">
			<label className="flex flex-col gap-1">
				<span className={caption}>The question</span>
				<textarea
					value={question}
					onChange={(event) => setQuestion(event.target.value)}
					rows={2}
					className={`resize-y ${field}`}
				/>
			</label>
			<label className="flex flex-col gap-1">
				<span className={caption}>Category</span>
				<select
					value={category}
					onChange={(event) => setCategory(event.target.value as Category)}
					className={field}
				>
					{CATEGORIES.map((one) => (
						<option key={one} value={one}>
							{one}
						</option>
					))}
				</select>
			</label>
			<fieldset className="flex flex-col gap-1">
				<legend className={caption}>The nodes it holds</legend>
				{bindable(board).map((node) => (
					<label key={node.id} className="flex items-center gap-2 text-[var(--ink)] text-xs">
						<input
							type="checkbox"
							checked={binds.includes(node.id)}
							onChange={(event) =>
								setBinds((was) =>
									event.target.checked ? [...was, node.id] : was.filter((id) => id !== node.id),
								)
							}
						/>
						{node.title}
					</label>
				))}
			</fieldset>
			<p className="text-[var(--ink-faint)] text-xs">
				It opens with no options. A session produces them (/sober:decide).
			</p>
			<div className="flex gap-2">
				<button
					type="button"
					onClick={() => void send()}
					disabled={body === null || busy}
					className="rounded-[var(--radius-sm)] bg-[var(--ink)] px-3 py-1.5 text-[var(--bg)] text-xs disabled:cursor-not-allowed disabled:opacity-40"
				>
					{busy ? pending('create_decision') : 'Open it'}
				</button>
				<button
					type="button"
					onClick={() => {
						setAsking(false)
						setRefused(null)
					}}
					className="rounded-[var(--radius-sm)] px-3 py-1.5 text-[var(--ink-dim)] text-xs hover:text-[var(--ink)]"
				>
					Never mind
				</button>
			</div>
			{refused !== null && <p className="text-[var(--danger)] text-xs">{refused}</p>}
		</div>
	)
}
