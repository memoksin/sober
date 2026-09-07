import type { Dismissal } from '@besober/schema'
import { useState } from 'react'
import { pending } from '../pending.js'
import type { FlagAction } from './data.js'
import { asksFor, FLAG_ACTIONS } from './data.js'

/**
 * DESIGN §7.2, in the panel. A finished node whose bound decision changed is
 * flagged, not reopened, and three things can be done with it — none of them
 * automatically. One decision change can reach thirty nodes; re-running them
 * unasked is what the impact preview exists to prevent (D37).
 *
 * The two that need words ask for them before they do anything. A dismissal
 * without a reason is a mute button, and §7.2 keeps the judgement rather than
 * the silence.
 */
type Asking = FlagAction['does'] | null

export const Flag = ({
	flagged,
	dismissal,
	onDismiss,
	onReopen,
	onOpen,
}: {
	readonly flagged: boolean
	readonly dismissal: Dismissal | null
	readonly onDismiss: (reason: string) => Promise<void>
	readonly onReopen: () => Promise<void>
	readonly onOpen: (title: string) => Promise<void>
}): React.JSX.Element | null => {
	const [asking, setAsking] = useState<Asking>(null)
	const [words, setWords] = useState('')
	// Which one is in flight, not merely that something is: three buttons sit
	// side by side, and a shared boolean would put "Reopening it…" on the two
	// nobody pressed.
	const [doing, setDoing] = useState<Asking>(null)
	const [refused, setRefused] = useState<string | null>(null)

	// A dismissal outlives the flag it settled, and that is the point: it is the
	// judgement §7.2 keeps. Shown on its own once nothing is flagged any more.
	if (!flagged) return dismissal === null ? null : <Kept dismissal={dismissal} />

	const act = async (does: FlagAction['does'], what: () => Promise<void>): Promise<void> => {
		setDoing(does)
		setRefused(null)
		try {
			await what()
			setAsking(null)
			setWords('')
		} catch (error) {
			setRefused(error instanceof Error ? error.message : String(error))
		} finally {
			setDoing(null)
		}
	}

	return (
		<div className="flex flex-col gap-2 border-[var(--line)] border-b bg-[var(--raised)] px-4 py-3">
			<p
				className="text-[length:var(--text-sm)] leading-[var(--leading-prose)]"
				style={{ color: 'var(--danger)' }}
			>
				A decision this node binds was answered after its brief was approved.
			</p>

			{asking === null ? (
				<div className="flex flex-wrap gap-2">
					{FLAG_ACTIONS.map((action) => (
						<Choice
							key={action.does}
							label={action.label}
							doing={doing}
							does={action.does}
							onClick={() =>
								action.asks === null ? void act(action.does, onReopen) : setAsking(action.does)
							}
						/>
					))}
				</div>
			) : (
				<Asks
					asks={asksFor(asking)}
					does={asking}
					words={words}
					busy={doing !== null}
					onWords={setWords}
					onGo={() =>
						void act(asking, () =>
							asking === 'dismiss' ? onDismiss(words.trim()) : onOpen(words.trim()),
						)
					}
					onNeverMind={() => {
						setAsking(null)
						setRefused(null)
					}}
				/>
			)}

			{refused !== null && (
				<p className="text-[length:var(--text-sm)] text-[var(--danger)] leading-[var(--leading-prose)]">
					{refused}
				</p>
			)}
		</div>
	)
}

const Asks = ({
	asks,
	does,
	words,
	busy,
	onWords,
	onGo,
	onNeverMind,
}: {
	readonly asks: FlagAction['asks']
	readonly does: FlagAction['does']
	readonly words: string
	readonly busy: boolean
	readonly onWords: (words: string) => void
	readonly onGo: () => void
	readonly onNeverMind: () => void
}): React.JSX.Element | null =>
	asks === null ? null : (
		<div className="flex flex-col gap-1.5">
			{/*
			  The label wraps the field and nothing else. A label around the
			  buttons too makes its text their accessible name, so a screen reader
			  announces "Why it is fine Set it aside" for the button that sends.
			*/}
			<label className="flex flex-col gap-1.5">
				<span className="font-medium text-[length:var(--text-xs)] text-[var(--ink-faint)] uppercase tracking-wider">
					{asks.title}
				</span>
				<textarea
					value={words}
					onChange={(event) => onWords(event.target.value)}
					rows={2}
					placeholder={asks.placeholder}
					className="resize-y rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-[length:var(--text-sm)] text-[var(--ink)] leading-[var(--leading-prose)] placeholder:text-[var(--ink-faint)] focus:border-[var(--ink-faint)] focus:outline-none"
				/>
			</label>
			<div className="flex gap-2">
				<button
					type="button"
					onClick={onGo}
					disabled={words.trim() === '' || busy}
					className="rounded-[var(--radius-sm)] bg-[var(--ink)] px-3 py-1.5 text-[length:var(--text-sm)] text-[var(--bg)] disabled:cursor-not-allowed disabled:opacity-40"
				>
					{busy ? pending(does) : asks.go}
				</button>
				<button
					type="button"
					onClick={onNeverMind}
					className="rounded-[var(--radius-sm)] px-3 py-1.5 text-[length:var(--text-sm)] text-[var(--ink-dim)] hover:text-[var(--ink)]"
				>
					Never mind
				</button>
			</div>
		</div>
	)

const Choice = ({
	onClick,
	label,
	does,
	doing,
}: {
	readonly onClick: () => void
	readonly label: string
	readonly does: FlagAction['does']
	readonly doing: Asking
}): React.JSX.Element => (
	<button
		type="button"
		onClick={onClick}
		disabled={doing !== null}
		className="rounded-[var(--radius-sm)] border border-[var(--line)] px-3 py-1.5 text-[length:var(--text-sm)] text-[var(--ink-dim)] hover:text-[var(--ink)] disabled:opacity-40"
	>
		{doing === does ? pending(does) : label}
	</button>
)

/**
 * The judgement, after the flag it settled is gone. A dismissal is not a
 * clearing: a later change to the same decision flags the node again, and this
 * line is how a reader knows the last one was looked at rather than missed.
 */
const Kept = ({ dismissal }: { readonly dismissal: Dismissal }): React.JSX.Element => (
	<p className="border-[var(--line)] border-b px-4 py-2.5 text-[length:var(--text-xs)] text-[var(--ink-faint)] leading-[var(--leading-prose)]">
		{dismissal.by} set an earlier flag aside: {dismissal.reason}
	</p>
)
