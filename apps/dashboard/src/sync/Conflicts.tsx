import type { Choices, Conflict, Resolution } from '@besober/core'
import { useState } from 'react'
import { Overlay } from '../Overlay.js'
import { rowsOf, unanswered } from './data.js'

/**
 * A conflicted sync, answered one record at a time. Nothing is checked to begin
 * with and nothing is sent until every field on the record has an answer: a
 * form dismissed without answering is not an answer (ADR 0010).
 */
export const ConflictScreen = ({
	conflicts,
	resolve,
	onDone,
	onClose,
}: {
	readonly conflicts: readonly Conflict[]
	readonly resolve: (record: string, choices: Choices) => Promise<Resolution>
	/** The last record landed the merge; what is left is the sync that pushes it. */
	readonly onDone: () => void
	readonly onClose: () => void
}): React.JSX.Element => {
	const [left, setLeft] = useState(conflicts)
	const [choices, setChoices] = useState<Choices>({})
	const [recorded, setRecorded] = useState(0)
	const [sending, setSending] = useState(false)
	const [failure, setFailure] = useState<string | null>(null)

	const current = left[0]
	const rows = current === undefined ? [] : rowsOf(current)
	const missing = unanswered(rows, choices)

	const submit = async (): Promise<void> => {
		if (current === undefined || missing.length > 0 || sending) return
		setSending(true)
		setFailure(null)
		try {
			const result = await resolve(current.id, choices)
			if (result.kind === 'done') {
				onDone()
				return
			}
			setLeft(result.left)
			setChoices({})
			setRecorded((count) => count + 1)
		} catch (error) {
			setFailure(error instanceof Error ? error.message : String(error))
		} finally {
			setSending(false)
		}
	}

	return (
		<Overlay label="Sync conflicts" width={640} onClose={onClose}>
			<header className="border-[var(--line)] border-b px-5 py-4">
				<h2 className="font-medium text-[length:var(--text-sm)] text-[var(--ink)]">
					{current === undefined ? 'Nothing is waiting' : `${current.id} changed on both sides`}
				</h2>
				<p className="mt-1 text-[var(--ink-dim)] text-xs">
					{left.length} {left.length === 1 ? 'record' : 'records'} left. Closing keeps{' '}
					{recorded === 0 ? 'nothing answered yet' : 'the ones answered so far'}; the rest stay
					untouched, and syncing again brings them back.
				</p>
			</header>

			<div className="flex-1 overflow-y-auto px-5 py-4">
				{rows.map((row) => (
					<fieldset key={row.field} className="mb-4">
						<legend className="mb-2 text-[var(--ink)] text-xs">{row.field}</legend>
						<div className="grid grid-cols-2 gap-2">
							{row.picks.map((pick) => (
								<label
									key={pick.value}
									className="flex flex-col gap-1 rounded-[var(--radius-sm)] border border-[var(--line)] p-2 text-xs"
								>
									<span className="flex items-center gap-2 text-[var(--ink)]">
										<input
											type="radio"
											name={row.field}
											value={pick.value}
											checked={choices[row.field] === pick.value}
											onChange={() => setChoices((was) => ({ ...was, [row.field]: pick.value }))}
										/>
										{pick.label}
									</span>
									<span className="whitespace-pre-wrap text-[var(--ink-dim)]">{pick.shows}</span>
								</label>
							))}
						</div>
					</fieldset>
				))}
				{failure !== null && (
					<p role="alert" className="text-[var(--ink)] text-xs">
						The answer was not recorded: {failure}
					</p>
				)}
			</div>

			<footer className="flex items-center gap-3 border-[var(--line)] border-t px-5 py-3">
				<span className="text-[var(--ink-dim)] text-xs">
					{missing.length > 0 ? `Still to answer: ${missing.join(', ')}` : ''}
				</span>
				<button
					type="button"
					onClick={() => void submit()}
					disabled={current === undefined || missing.length > 0 || sending}
					className="ml-auto rounded-[var(--radius-sm)] px-3 py-1 text-[var(--ink)] text-xs hover:bg-[var(--raised)] disabled:opacity-50"
				>
					{left.length > 1 ? 'answer and go on' : 'answer and sync'}
				</button>
			</footer>
		</Overlay>
	)
}
