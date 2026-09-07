import type { LogLine } from '@besober/schema'
import { useEffect, useRef, useState } from 'react'
import { Overlay } from '../Overlay.js'
import type { Wire } from '../wire.js'
import { atBottom, MARK, TONE } from './data.js'

/**
 * The run on the screen (ADR 0046). A dispatch is the longest and most
 * expensive operation in the product, and until this it could be watched only
 * by leaving the dashboard for a terminal.
 *
 * A screen of its own rather than a strip in the panel: the panel is 420px for
 * the reasons ADR 0041 gives, and a run log is the longest reading in the
 * product. Wider than the review screen for the same reason a diff is wider
 * than four option cards.
 *
 * The channel is opened once, when this mounts, and closed when it unmounts.
 * That is the whole of the idle-cost answer ADR 0036 asked for: a board with a
 * running node on it costs nothing extra until somebody opens this, and stops
 * costing it the moment they close it.
 */
export const LogScreen = ({
	node,
	surface,
	onClose,
}: {
	readonly node: string
	readonly surface: Wire
	readonly onClose: () => void
}): React.JSX.Element => {
	const [reply, setReply] = useState('')
	const [sending, setSending] = useState(false)
	const [refused, setRefused] = useState<string | null>(null)
	const [lines, setLines] = useState<readonly LogLine[]>([])
	const [live, setLive] = useState<boolean | null>(null)
	const [failure, setFailure] = useState<string | null>(null)
	const [ended, setEnded] = useState(false)

	const scroller = useRef<HTMLDivElement>(null)
	// Whether to keep following the bottom. A person who has scrolled up is
	// reading something, and yanking them back down on the next line is the
	// fastest way to make a live tail unreadable.
	const following = useRef(true)

	useEffect(() => {
		const leaving = new AbortController()
		setLines([])
		setLive(null)
		setFailure(null)
		setEnded(false)

		let offset: string | undefined
		surface
			.watch<{ lines: LogLine[]; offset: number; live: boolean }>(
				'logs',
				{ node },
				(window) => {
					offset = String(window.offset)
					setLive(window.live)
					if (window.lines.length > 0) setLines((shown) => [...shown, ...window.lines])
				},
				leaving.signal,
			)
			.then(() => {
				if (!leaving.signal.aborted) setEnded(true)
			})
			.catch((error: unknown) => {
				if (leaving.signal.aborted) return
				setFailure(error instanceof Error ? error.message : String(error))
			})
		// `offset` is carried for a reconnect that this version does not attempt:
		// the server's lifetime is `sober dashboard`'s (ADR 0037), so a channel
		// that drops means the command stopped, and reconnecting to a process
		// that is gone is a spinner instead of a sentence.
		void offset

		return () => leaving.abort()
	}, [node, surface])

	// Stick to the bottom while the reader is at the bottom, and nowhere else. A
	// person who has scrolled up is reading something, and yanking them back
	// down on the next line is the fastest way to make a live tail unreadable.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the new lines are the event, not a value read here
	useEffect(() => {
		const box = scroller.current
		if (box !== null && following.current) box.scrollTop = box.scrollHeight
	}, [lines])

	/**
	 * The other half of watching (`SCOPE.md`: "watching a dispatched agent,
	 * answering its prompts"). It is a `POST` rather than something written back
	 * up the channel: an answer is a one-shot command that wants a status code,
	 * which is the shape ADR 0036 already chose for every write.
	 */
	const answer = async (done: boolean): Promise<void> => {
		const text = reply.trim()
		if (text === '' || sending) return
		setSending(true)
		setRefused(null)
		try {
			await surface.op('answer', { node, text, done })
			setReply('')
		} catch (error) {
			setRefused(error instanceof Error ? error.message : String(error))
		} finally {
			setSending(false)
		}
	}

	return (
		<Overlay label={`The run of ${node}`} width={980} onClose={onClose}>
			<header className="flex items-center justify-between border-[var(--line)] border-b px-6 py-4">
				<div>
					<h2 className="font-medium text-[var(--ink)] text-base">{node}</h2>
					<p className="mt-0.5 text-[var(--ink-faint)] text-xs">
						What the agent said, as it said it.
					</p>
				</div>
				<Status live={live} ended={ended} failure={failure} />
			</header>

			<div
				ref={scroller}
				onScroll={(event) => {
					following.current = atBottom(event.currentTarget)
				}}
				className="min-h-[320px] flex-1 overflow-y-auto px-6 py-4 font-mono text-[13px] leading-relaxed"
			>
				{failure !== null && (
					<p className="text-[var(--danger)]" role="alert">
						{failure}
					</p>
				)}

				{failure === null && lines.length === 0 && (
					<p className="text-[var(--ink-faint)]">
						{live === false
							? 'This run wrote nothing before it ended.'
							: 'Waiting for the agent’s first line…'}
					</p>
				)}

				<ol className="space-y-1">
					{lines.map((line, index) => (
						// The index is the identity: a log is append-only and a line has
						// no id of its own, so its position is what it is.
						// biome-ignore lint/suspicious/noArrayIndexKey: an append-only log has no other key
						<li key={index} className="flex gap-3">
							<span aria-hidden className="select-none" style={{ color: TONE[line.kind] }}>
								{MARK[line.kind]}
							</span>
							<span className="whitespace-pre-wrap break-words text-[var(--ink)]">{line.text}</span>
						</li>
					))}
				</ol>
			</div>

			{live === true && (
				<footer className="shrink-0 border-[var(--line)] border-t px-6 py-3">
					{refused !== null && (
						<p className="mb-2 text-[var(--danger)] text-xs" role="alert">
							{refused}
						</p>
					)}
					<div className="flex items-end gap-2">
						<textarea
							value={reply}
							onChange={(event) => setReply(event.target.value)}
							onKeyDown={(event) => {
								// Enter sends and Shift+Enter breaks the line, which is what
								// every chat box does and therefore what fingers expect.
								if (event.key !== 'Enter' || event.shiftKey) return
								event.preventDefault()
								void answer(false)
							}}
							rows={2}
							placeholder="Answer it. The agent is told a human is reading this."
							aria-label={`Answer the run of ${node}`}
							className="flex-1 resize-none rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-[var(--ink)] text-sm outline-none focus:border-[var(--ink-faint)]"
						/>
						<div className="flex flex-col gap-1">
							<button
								type="button"
								onClick={() => void answer(false)}
								disabled={sending || reply.trim() === ''}
								className="rounded-[var(--radius-sm)] bg-[var(--ink)] px-3 py-1.5 text-[var(--bg)] text-xs disabled:opacity-40"
							>
								Send
							</button>
							{/* Ending the conversation rather than killing it: the session
							    closes its input and finishes, which is not what Stop does. */}
							<button
								type="button"
								onClick={() => void answer(true)}
								disabled={sending || reply.trim() === ''}
								className="rounded-[var(--radius-sm)] px-3 py-1.5 text-[var(--ink-dim)] text-xs hover:text-[var(--ink)] disabled:opacity-40"
							>
								Send &amp; finish
							</button>
						</div>
					</div>
				</footer>
			)}
		</Overlay>
	)
}

/**
 * Whether anything more is coming. Three states and not two: a run that is
 * still going, a run that has ended, and a channel that broke — which is not
 * the same thing as a run that finished, and a screen that renders them
 * identically is one that says "done" when the server was killed.
 */
const Status = ({
	live,
	ended,
	failure,
}: {
	readonly live: boolean | null
	readonly ended: boolean
	readonly failure: string | null
}): React.JSX.Element => {
	if (failure !== null)
		return <span className="text-[var(--danger)] text-xs">the channel closed</span>

	if (live === true)
		return (
			<span className="flex items-center gap-2 text-[var(--ink-faint)] text-xs">
				<span
					aria-hidden
					className="h-2 w-2 animate-pulse rounded-full bg-[var(--status-running)]"
				/>
				running
			</span>
		)

	if (live === false || ended)
		return <span className="text-[var(--ink-faint)] text-xs">the run has ended</span>

	return <span className="text-[var(--ink-faint)] text-xs">connecting…</span>
}
