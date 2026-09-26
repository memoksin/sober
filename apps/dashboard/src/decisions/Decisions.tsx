import { CATEGORIES, type Category } from '@besober/schema'
import { useState } from 'react'
import { Inline } from '../markdown.js'
import { Overlay } from '../Overlay.js'
import type { BoardRead } from '../panel/data.js'
import { pending } from '../pending.js'
import { type Asking, askingBody, bindable, decisionRows, waiting } from './data.js'

/**
 * Every decision on the board and what was chosen, and a question opened by
 * hand. Answering stays on `deciding`.
 */
export const DecisionsScreen = ({
	board,
	onAsk,
	onClose,
}: {
	readonly board: BoardRead
	readonly onAsk: (body: Asking) => Promise<void>
	readonly onClose: () => void
}): React.JSX.Element => {
	const [expanded, setExpanded] = useState<string | null>(null)
	const rows = decisionRows(board)
	const open = rows.filter((row) => row.state === 'open').length

	return (
		<Overlay label="Every decision" width={720} onClose={onClose}>
			<header className="border-[var(--line)] border-b px-5 py-4">
				<h2 className="font-medium text-[length:var(--text-sm)] text-[var(--ink)]">
					What this project has decided
				</h2>
				<p className="mt-1 text-[var(--ink-dim)] text-xs">
					{rows.length} decisions · {open} still open
				</p>
			</header>

			<AskForm board={board} onAsk={onAsk} />

			<div className="flex-1 overflow-y-auto px-5 py-4">
				{rows.length === 0 ? (
					<p className="text-[var(--ink-dim)] text-xs">No decisions on this board yet.</p>
				) : (
					<ul className="flex flex-col gap-3">
						{rows.map((row) => (
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
											{row.state}
										</span>
									</span>
									{row.chosen !== null && row.answer !== null ? (
										// Inline, not Markdown: this sits inside a button, where block output does not belong.
										<>
											<span className="flex items-baseline gap-2 text-[var(--ink)] text-xs">
												{row.chosen.label}
												{row.answer.derived !== null && (
													<span title={row.answer.derived} className="text-[var(--ink-faint)]">
														derived
													</span>
												)}
											</span>
											<span className="text-[var(--ink-dim)] text-xs leading-[var(--leading-prose)]">
												<Inline text={row.answer.rationale} />
											</span>
										</>
									) : (
										<span className="text-[var(--ink-dim)] text-xs">{waiting(row)}</span>
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

const FIELD =
	'rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--ink-faint)] focus:outline-none'

/**
 * The question, its category and the nodes it holds. No options: they are a
 * model's, and a session produces them on demand (§2.6).
 */
const AskForm = ({
	board,
	onAsk,
}: {
	readonly board: BoardRead
	readonly onAsk: (body: Asking) => Promise<void>
}): React.JSX.Element => {
	const [question, setQuestion] = useState('')
	const [category, setCategory] = useState<Category>(CATEGORIES[0])
	const [binds, setBinds] = useState<readonly string[]>([])
	const [busy, setBusy] = useState(false)
	const [refused, setRefused] = useState<string | null>(null)
	const body = askingBody({ question, category, binds })
	const nodes = bindable(board)

	const send = async (): Promise<void> => {
		if (body === null) return
		setBusy(true)
		setRefused(null)
		try {
			await onAsk(body)
			setQuestion('')
			setBinds([])
		} catch (error) {
			setRefused(error instanceof Error ? error.message : String(error))
		} finally {
			setBusy(false)
		}
	}

	return (
		<form
			className="flex flex-col gap-2 border-[var(--line)] border-b px-5 py-4 text-xs"
			onSubmit={(event) => {
				event.preventDefault()
				void send()
			}}
		>
			<label className="flex flex-col gap-1 text-[var(--ink-dim)]">
				Open a question
				<input
					value={question}
					onChange={(event) => setQuestion(event.target.value)}
					placeholder="Where does session state live?"
					className={FIELD}
				/>
			</label>
			<label className="flex items-center gap-2 text-[var(--ink-dim)]">
				Category
				<select
					value={category}
					onChange={(event) => setCategory(event.target.value as Category)}
					className={FIELD}
				>
					{CATEGORIES.map((one) => (
						<option key={one} value={one}>
							{one}
						</option>
					))}
				</select>
			</label>
			<fieldset className="flex flex-col gap-1">
				<legend className="text-[var(--ink-dim)]">
					Holds — each reads held until it is answered
				</legend>
				{nodes.length === 0 ? (
					<p className="text-[var(--ink-faint)]">No unfinished node to hold.</p>
				) : (
					<ul className="flex max-h-32 flex-col gap-1 overflow-y-auto">
						{nodes.map((node) => (
							<li key={node.id}>
								<label className="flex items-center gap-2 text-[var(--ink)]">
									<input
										type="checkbox"
										checked={binds.includes(node.id)}
										onChange={(event) =>
											setBinds((was) =>
												event.target.checked
													? [...was, node.id]
													: was.filter((one) => one !== node.id),
											)
										}
									/>
									{node.title}
								</label>
							</li>
						))}
					</ul>
				)}
			</fieldset>
			<div className="flex items-center gap-3">
				<button
					type="submit"
					disabled={body === null || busy}
					className="rounded-[var(--radius-sm)] bg-[var(--ink)] px-3 py-1.5 text-[var(--bg)] disabled:opacity-40"
				>
					{busy ? pending('create_decision') : 'Open it'}
				</button>
				<span className="text-[var(--ink-faint)]">
					It arrives with no options — a session produces them (/sober:decide).
				</span>
			</div>
			{refused !== null && <p className="text-[var(--danger)]">{refused}</p>}
		</form>
	)
}
