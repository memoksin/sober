import type { Review } from '@besober/schema'
import { useState } from 'react'
import { Overlay } from '../Overlay.js'
import { pending } from '../pending.js'
import { ciLine, type Tone, verdict } from './data.js'

const COLOUR: Record<Tone, string> = {
	clean: 'var(--status-ready)',
	warn: 'var(--status-in-review)',
	alarm: 'var(--danger)',
	done: 'var(--ink-faint)',
}

/**
 * Review is checks, not reading (ADR 0022). The order on the screen is the
 * order of the argument: what the scan found, what CI said, what you asked the
 * work to prove — and the diff last, because a reviewer who has to read every
 * line to find the problem is doing the scan's job by hand.
 *
 * Wider than the decision screen. Four option cards read at 640px; a diff does
 * not.
 */
export const ReviewScreen = ({
	review,
	onClose,
	onAccept,
	onReject,
}: {
	readonly review: Review
	readonly onClose: () => void
	readonly onAccept: () => Promise<void>
	readonly onReject: (text: string) => Promise<void>
}): React.JSX.Element => {
	const said = verdict(review)
	const ci = ciLine(review.ci)

	const [note, setNote] = useState('')
	const [turning, setTurning] = useState(false)
	const [busy, setBusy] = useState(false)
	const [refused, setRefused] = useState<string | null>(null)
	const [showDiff, setShowDiff] = useState(false)

	const act = async (what: () => Promise<void>): Promise<void> => {
		setBusy(true)
		setRefused(null)
		try {
			await what()
		} catch (error) {
			setRefused(error instanceof Error ? error.message : String(error))
		} finally {
			setBusy(false)
		}
	}

	// `''.split('\n')` is `['']`, so an empty diff is zero lines and never one.
	const lines = review.diff === '' ? 0 : review.diff.split('\n').length

	return (
		<Overlay label={`Review of ${review.node}`} width={900} onClose={onClose}>
			<header className="border-[var(--line)] border-b px-6 py-4">
				<p className="mb-1.5 font-[family-name:var(--font-mono)] text-[length:var(--text-xs)] text-[var(--ink-faint)]">
					{review.node}
					{review.run !== null && ` · ${review.run}`}
					{review.exit !== null && ` · ${review.exit}`}
				</p>
				<h2
					className="text-[length:var(--text-lg)] leading-tight"
					style={{ color: COLOUR[said.tone] }}
				>
					{said.headline}
				</h2>
				<p className="mt-1 text-[length:var(--text-xs)] text-[var(--ink-faint)]">
					rules: {review.scan.ruleSet} · {review.files.length} file(s)
				</p>
			</header>

			<div className="flex flex-col gap-5 px-6 py-5">
				{/*
				  Above the findings, because both are reasons the picture below is
				  not the whole story, and one of them is that there is no picture.
				*/}
				{said.warnings.map((warning) => (
					<p
						key={warning}
						className="text-[length:var(--text-sm)] leading-[var(--leading-prose)]"
						style={{ color: 'var(--danger)' }}
					>
						{warning}
					</p>
				))}

				{/*
				  §2.8: the flag renders here, beside the scan findings and above
				  the diff, because it is the same kind of fact — a reason the diff
				  below is not the whole story. Accepting anyway is allowed and the
				  `accepted` record says so; the flag survives into §7.2's list.
				*/}
				{review.flagged && (
					<p
						className="text-[length:var(--text-sm)] leading-[var(--leading-prose)]"
						style={{ color: 'var(--danger)' }}
					>
						A decision this node binds was answered after its brief was approved. The work below was
						built against the earlier answer.
					</p>
				)}

				{ci !== null && (
					<p className="text-[length:var(--text-sm)]" style={{ color: COLOUR[ci.tone] }}>
						{ci.text}
						{review.pr !== null && (
							<a
								href={review.pr.url}
								target="_blank"
								rel="noreferrer"
								className="ml-2 text-[var(--ink-faint)] underline"
							>
								#{review.pr.number}
								{review.pr.draft ? ' (draft)' : ''}
							</a>
						)}
					</p>
				)}

				<section>
					<h3 className="mb-2 font-medium text-[length:var(--text-xs)] text-[var(--ink-faint)] uppercase tracking-wider">
						Findings
					</h3>
					{review.scan.findings.length === 0 ? (
						<p className="text-[length:var(--text-sm)] text-[var(--ink-faint)]">
							nothing to look at
						</p>
					) : (
						<ul className="flex flex-col gap-1.5">
							{review.scan.findings.map((finding) => (
								<li
									key={`${finding.file}:${finding.line}:${finding.message}`}
									className="text-[length:var(--text-sm)]"
								>
									<code className="font-[family-name:var(--font-mono)] text-[var(--ink)]">
										{finding.file}
										{finding.line !== null && `:${finding.line}`}
									</code>
									<span className="ml-2 text-[var(--ink-dim)]">{finding.message}</span>
									<span className="ml-2 text-[var(--ink-faint)]">{finding.signal}</span>
								</li>
							))}
						</ul>
					)}
				</section>

				{review.acceptance.length > 0 && (
					<section>
						<h3 className="mb-2 font-medium text-[length:var(--text-xs)] text-[var(--ink-faint)] uppercase tracking-wider">
							What you asked it to prove
						</h3>
						<ul className="flex flex-col gap-1.5">
							{review.acceptance.map((criterion) => (
								<li key={criterion.run} className="text-[length:var(--text-sm)]">
									<span className="text-[var(--ink-dim)]">{criterion.proves}</span>
									<code className="ml-2 font-[family-name:var(--font-mono)] text-[var(--ink)]">
										{criterion.run}
									</code>
								</li>
							))}
						</ul>
					</section>
				)}

				{lines > 0 && (
					<section>
						<button
							type="button"
							onClick={() => setShowDiff((on) => !on)}
							className="font-medium text-[length:var(--text-xs)] text-[var(--ink-faint)] uppercase tracking-wider hover:text-[var(--ink)]"
						>
							{showDiff ? 'Hide' : 'Show'} the diff · {lines} lines
						</button>
						{showDiff && (
							<pre className="mt-2 max-h-96 overflow-auto rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--bg)] p-3 font-[family-name:var(--font-mono)] text-[length:var(--text-xs)] text-[var(--ink-dim)] leading-normal">
								{review.diff}
							</pre>
						)}
					</section>
				)}

				{turning && (
					<label className="flex flex-col gap-1.5">
						<span className="font-medium text-[length:var(--text-xs)] text-[var(--ink-faint)] uppercase tracking-wider">
							What was wrong
						</span>
						<textarea
							value={note}
							onChange={(event) => setNote(event.target.value)}
							rows={3}
							// The note is not a comment: it is carried into the next run,
							// which is what makes turning work down cheaper than fixing it
							// by hand.
							placeholder="Carried into the next run, so say what it should do instead."
							className="resize-y rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-[length:var(--text-sm)] text-[var(--ink)] leading-[var(--leading-prose)] placeholder:text-[var(--ink-faint)] focus:border-[var(--ink-faint)] focus:outline-none"
						/>
					</label>
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
					className="mr-auto rounded-[var(--radius-sm)] px-3 py-1.5 text-[length:var(--text-sm)] text-[var(--ink-dim)] hover:text-[var(--ink)]"
				>
					Close
				</button>

				{said.decidable && !turning && (
					<button
						type="button"
						onClick={() => setTurning(true)}
						className="rounded-[var(--radius-sm)] border border-[var(--line)] px-3 py-1.5 text-[length:var(--text-sm)] text-[var(--ink-dim)] hover:text-[var(--ink)]"
					>
						Turn it down
					</button>
				)}
				{said.decidable && turning && (
					<button
						type="button"
						onClick={() => void act(() => onReject(note))}
						disabled={note.trim() === '' || busy}
						className="rounded-[var(--radius-sm)] border border-[var(--danger)] px-3 py-1.5 text-[length:var(--text-sm)] text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-40"
					>
						{busy ? pending('reject') : 'Send it back'}
					</button>
				)}
				{said.decidable && !turning && (
					<button
						type="button"
						onClick={() => void act(onAccept)}
						disabled={busy}
						className="rounded-[var(--radius-sm)] bg-[var(--ink)] px-3 py-1.5 text-[length:var(--text-sm)] text-[var(--bg)] disabled:opacity-40"
					>
						{busy ? pending('accept') : 'Accept'}
					</button>
				)}
			</footer>
		</Overlay>
	)
}
