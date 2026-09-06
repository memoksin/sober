import { useState } from 'react'
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
}: {
	readonly board: BoardRead
	readonly id: string
	readonly onClose: () => void
	readonly onAnswer: (option: string, rationale: string) => Promise<void>
}): React.JSX.Element => {
	const decision = board.decisions.find((one) => one.id === id)
	const open = decision === undefined ? null : offer(decision)

	const [chosen, setChosen] = useState<string | null>(null)
	const [rationale, setRationale] = useState('')
	const [sending, setSending] = useState(false)
	const [refused, setRefused] = useState<string | null>(null)

	const answer = async (): Promise<void> => {
		if (chosen === null) return
		setSending(true)
		setRefused(null)
		try {
			await onAnswer(chosen, rationale)
		} catch (error) {
			// `core` refuses with a paragraph a person can act on. It is the whole
			// value of the round trip, so it lands here rather than in a console.
			setRefused(error instanceof Error ? error.message : String(error))
		} finally {
			setSending(false)
		}
	}

	return (
		<div className="absolute inset-0 z-30 flex items-center justify-center p-6">
			{/*
			  The backdrop is a button rather than a div with a click on it: it does
			  what a button does, and writing it as one is how it reaches a keyboard
			  without a rule being silenced to let it through.
			*/}
			<button
				type="button"
				aria-label="Close"
				onClick={onClose}
				className="absolute inset-0 cursor-default bg-[color-mix(in_oklab,var(--bg)_78%,transparent)]"
			/>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={decision?.question ?? id}
				className="relative flex max-h-full w-[640px] max-w-full flex-col overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] shadow-2xl"
			>
				{decision === undefined || open === null ? (
					<div className="px-6 py-5">
						<p className="text-[length:var(--text-sm)] text-[var(--ink)]">
							<code className="font-[family-name:var(--font-mono)]">{id}</code> is not on this
							board.
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
							{open.kind === 'open' && (
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
									{sending ? 'Answering…' : 'Answer'}
								</button>
							)}
						</footer>
					</>
				)}
			</div>
		</div>
	)
}
