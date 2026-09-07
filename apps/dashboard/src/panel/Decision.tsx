import type { Impact } from '@besober/schema'
import { useState } from 'react'
import { Overlay } from '../Overlay.js'
import { pending } from '../pending.js'
import type { BoardRead } from './data.js'
import { offer } from './data.js'

/**
 * A decision, and the act of answering one.
 *
 * Not the drawer. Reading a node is glancing; answering a decision is
 * stopping, and the two get different weights on purpose — this takes the
 * middle of the screen and pushes the board back, which is the same gesture
 * the canvas already uses to say "this, and not the rest" (ADR 0039 §6).
 *
 * There is no route behind it. The app has no router, and one screen is not a
 * reason to grow one — the board is still there underneath, which is the
 * context the answer is being given in.
 */
export const DecisionScreen = ({
	board,
	id,
	onClose,
	onAnswer,
	onPreview,
	onEdit,
}: {
	readonly board: BoardRead
	readonly id: string
	readonly onClose: () => void
	readonly onAnswer: (option: string, rationale: string) => Promise<void>
	/** §2.8's fan-out, read before it is applied. Never on open: asking for it is the act. */
	readonly onPreview: (decision: string) => Promise<Impact>
	readonly onEdit: (option: string, rationale: string) => Promise<void>
}): React.JSX.Element => {
	const decision = board.decisions.find((one) => one.id === id)
	const open = decision === undefined ? null : offer(decision)

	const [chosen, setChosen] = useState<string | null>(null)
	const [rationale, setRationale] = useState('')
	const [sending, setSending] = useState(false)
	const [refused, setRefused] = useState<string | null>(null)
	const [reaches, setReaches] = useState<Impact | null>(null)

	/**
	 * One `try` for all three, because a failure reads the same to the person
	 * whichever of them produced it: `core` refuses with a paragraph they can act
	 * on, and that paragraph is the whole value of the round trip.
	 */
	const send = async (work: () => Promise<unknown>): Promise<void> => {
		setSending(true)
		setRefused(null)
		try {
			await work()
		} catch (error) {
			setRefused(error instanceof Error ? error.message : String(error))
		} finally {
			setSending(false)
		}
	}

	const answer = async (): Promise<void> => {
		if (chosen === null) return
		await send(() => onAnswer(chosen, rationale))
	}

	// The fan-out does not depend on which option is picked — it is every node
	// built against the answer that stands — so switching options after reading
	// it does not make the preview stale.
	const preview = async (): Promise<void> => {
		await send(async () => setReaches(await onPreview(id)))
	}

	const edit = async (): Promise<void> => {
		if (chosen === null) return
		await send(() => onEdit(chosen, rationale))
	}

	return (
		<Overlay label={decision?.question ?? id} width={640} onClose={onClose}>
			{decision === undefined || open === null ? (
				<div className="px-6 py-5">
					<p className="text-[length:var(--text-sm)] text-[var(--ink)]">
						<code className="font-[family-name:var(--font-mono)]">{id}</code> is not on this board.
					</p>
				</div>
			) : (
				<>
					<header className="border-[var(--line)] border-b px-6 py-4">
						<p className="mb-1.5 flex items-center gap-2 font-[family-name:var(--font-mono)] text-[length:var(--text-xs)] text-[var(--ink-faint)]">
							<span>{decision.category}</span>
							<span>·</span>
							<span>{decision.id}</span>
							{decision.archived && <span className="text-[var(--danger)]">· archived</span>}
						</p>
						<h2 className="text-[length:var(--text-lg)] text-[var(--ink)] leading-tight">
							{decision.question}
						</h2>
					</header>

					<div className="flex flex-col gap-4 px-6 py-5">
						{open.kind !== 'unopened' && (
							<>
								<div className="flex flex-col gap-2">
									{open.options.map((option) => (
										<label
											key={option.id}
											className="flex cursor-pointer gap-3 rounded-[var(--radius-md)] border p-3 transition-colors"
											style={{
												borderColor: chosen === option.id ? 'var(--status-ready)' : 'var(--line)',
												background: chosen === option.id ? 'var(--raised)' : 'transparent',
											}}
										>
											<input
												type="radio"
												name="option"
												value={option.id}
												checked={chosen === option.id}
												// The answer that stands. Picking it again would move the
												// answer's timestamp and flag every node built on it, for
												// a change that is not one (§2.8).
												disabled={option.chosen}
												onChange={() => setChosen(option.id)}
												className="mt-1 accent-[var(--status-ready)]"
											/>
											<span className="min-w-0 flex-1">
												<span className="flex items-baseline gap-2">
													<span className="text-[length:var(--text-base)] text-[var(--ink)]">
														{option.label}
													</span>
													{option.suggested && (
														<span className="text-[length:var(--text-xs)] text-[var(--ink-faint)]">
															suggested
														</span>
													)}
													{option.chosen && (
														<span className="text-[length:var(--text-xs)] text-[var(--ink-faint)]">
															the answer that stands
														</span>
													)}
												</span>
												<span className="mt-1 block text-[length:var(--text-sm)] text-[var(--ink-dim)] leading-[var(--leading-prose)]">
													{option.reason}
												</span>
												{/*
													  The field that makes this a decision record and
													  not a poll: what you are agreeing to live with.
													*/}
												<span className="mt-1.5 block text-[length:var(--text-sm)] text-[var(--ink-faint)] leading-[var(--leading-prose)]">
													Costs later: {option.costLater}
												</span>
											</span>
										</label>
									))}
								</div>

								<label className="flex flex-col gap-1.5">
									<span className="font-medium text-[length:var(--text-xs)] text-[var(--ink-faint)] uppercase tracking-wider">
										Why
									</span>
									<textarea
										value={rationale}
										onChange={(event) => setRationale(event.target.value)}
										rows={3}
										placeholder="What made this the one. Optional, and read by every brief built on it."
										className="resize-y rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-[length:var(--text-sm)] text-[var(--ink)] leading-[var(--leading-prose)] placeholder:text-[var(--ink-faint)] focus:border-[var(--ink-faint)] focus:outline-none"
									/>
								</label>
							</>
						)}

						{open.refusal !== null && (
							<p className="text-[length:var(--text-sm)] text-[var(--ink-dim)] leading-[var(--leading-prose)]">
								{open.refusal}
							</p>
						)}

						{decision.answer !== null && (
							<div className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--raised)] p-3">
								<p className="text-[length:var(--text-base)] text-[var(--ink)]">
									{decision.options?.find((one) => one.id === decision.answer?.option)?.label ??
										decision.answer.option}
								</p>
								{decision.answer.rationale !== '' && (
									<p className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-dim)] leading-[var(--leading-prose)]">
										{decision.answer.rationale}
									</p>
								)}
								<p className="mt-1.5 text-[length:var(--text-xs)] text-[var(--ink-faint)]">
									{decision.answer.by}
								</p>
							</div>
						)}

						{/*
							  §2.8's fan-out, on the surface where the preview is the screen.
							  It is rendered above the confirmation and never beside it: a
							  person reads what the change reaches, then confirms, in that
							  order — which is the whole of D19.
							*/}
						{reaches !== null && (
							<div className="rounded-[var(--radius-md)] border border-[var(--line)] p-3">
								<p className="text-[length:var(--text-sm)] text-[var(--ink)] leading-[var(--leading-prose)]">
									{reaches.nodes.length === 0
										? 'Nothing was built against this answer yet, so the change costs nothing.'
										: `This reaches ${reaches.nodes.length === 1 ? '1 node' : `${reaches.nodes.length} nodes`}. Nothing is stopped and nothing is re-run.`}
								</p>
								<ul className="mt-2 flex flex-col gap-1">
									{reaches.nodes.map((one) => (
										<li key={one.id} className="flex items-baseline gap-2">
											<code className="font-[family-name:var(--font-mono)] text-[length:var(--text-xs)] text-[var(--ink-dim)]">
												{one.id}
											</code>
											<span className="text-[length:var(--text-xs)] text-[var(--ink-faint)]">
												{one.status}
											</span>
											<span className="text-[length:var(--text-sm)] text-[var(--ink-dim)]">
												{one.effect === 'rebrief' ? 'loses its brief' : 'flagged, and left alone'}
											</span>
										</li>
									))}
								</ul>
							</div>
						)}

						{refused !== null && (
							<p className="text-[length:var(--text-sm)] text-[var(--danger)] leading-[var(--leading-prose)]">
								{refused}
							</p>
						)}
					</div>

					<footer className="flex items-center justify-end gap-2 border-[var(--line)] border-t px-6 py-3">
						<button
							type="button"
							onClick={onClose}
							className="rounded-[var(--radius-sm)] px-3 py-1.5 text-[length:var(--text-sm)] text-[var(--ink-dim)] hover:text-[var(--ink)]"
						>
							Close
						</button>
						{open.kind === 'open' && (
							<button
								type="button"
								onClick={() => void answer()}
								disabled={chosen === null || sending}
								className="rounded-[var(--radius-sm)] bg-[var(--ink)] px-3 py-1.5 text-[length:var(--text-sm)] text-[var(--bg)] disabled:cursor-not-allowed disabled:opacity-40"
							>
								{sending ? pending('decide') : 'Answer'}
							</button>
						)}
						{/*
							  Two buttons, never at once: the confirmation does not exist until
							  the fan-out has been asked for, which is what makes "never
							  triggered unseen" a property of the screen rather than a habit.
							*/}
						{open.kind === 'answered' &&
							(reaches === null ? (
								<button
									type="button"
									onClick={() => void preview()}
									disabled={chosen === null || sending}
									className="rounded-[var(--radius-sm)] border border-[var(--line)] px-3 py-1.5 text-[length:var(--text-sm)] text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-40"
								>
									{sending ? pending('impact') : 'See what this changes'}
								</button>
							) : (
								<button
									type="button"
									onClick={() => void edit()}
									disabled={chosen === null || sending}
									className="rounded-[var(--radius-sm)] bg-[var(--danger)] px-3 py-1.5 text-[length:var(--text-sm)] text-[var(--bg)] disabled:cursor-not-allowed disabled:opacity-40"
								>
									{sending ? pending('edit_decision') : 'Change it anyway'}
								</button>
							))}
					</footer>
				</>
			)}
		</Overlay>
	)
}
