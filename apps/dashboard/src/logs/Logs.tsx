import type { LogLine, LogWindow } from '@besober/schema'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Overlay } from '../Overlay.js'
import type { Wire } from '../wire.js'
import {
	atBottom,
	buildChecklist,
	type ChecklistItem,
	elapsedLabel,
	MORPH_GROW_EASING,
	MORPH_GROW_MS,
	MORPH_REDUCED_MS,
	MORPH_SHRINK_EASING,
	MORPH_SHRINK_MS,
	matchesLine,
	modelOf,
	nextVerb,
	PROVIDER_COLOUR,
	PROVIDER_NAME,
	type Provider,
	providerForModel,
	ranWith,
	STAGE_STAGGER_MS,
	THINKING_VERBS,
} from './data.js'
import { Ekg } from './Ekg.js'
import { StatusBar } from './StatusBar.js'
import { Transcript } from './Transcript.js'

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
// No renderer here: this is a monospace transcript, and a backtick is a character the agent typed.
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
	const [ran, setRan] = useState<LogWindow['ran']>(undefined)
	const [full, setFull] = useState(false)
	const [findOpen, setFindOpen] = useState(false)
	const [query, setQuery] = useState('')
	const [unseen, setUnseen] = useState(0)

	const scroller = useRef<HTMLDivElement>(null)
	const dialog = useRef<HTMLDivElement>(null)
	const titleBar = useRef<HTMLElement>(null)
	const transcriptWrap = useRef<HTMLDivElement>(null)
	const statusBar = useRef<HTMLElement>(null)
	const findInput = useRef<HTMLInputElement>(null)

	// Whether to keep following the bottom. A person who has scrolled up is
	// reading something, and yanking them back down on the next line is the
	// fastest way to make a live tail unreadable.
	const following = useRef(true)
	const seenCount = useRef(0)

	// When each line arrived, index-aligned with `lines`. `elapsedLabel` falls
	// back to this for a host whose stream carries no timestamp (Claude Code's
	// does not) — `at` on the line itself is always preferred where it exists.
	const arrivals = useRef<(string | null)[]>([])
	const [startAt, setStartAt] = useState<string | null>(null)

	// The working indicator's verb: it changes only where a new line lands
	// (never on a timer), and never repeats the previous one.
	const [verbIndex, setVerbIndex] = useState(() => nextVerb(-1, Math.random))
	const seenLineCount = useRef(0)
	useEffect(() => {
		if (lines.length === seenLineCount.current) return
		seenLineCount.current = lines.length
		setVerbIndex((previous) => nextVerb(previous, Math.random))
	}, [lines.length])

	// A tick that forces the elapsed clock and the working indicator's seconds
	// to advance even when no new line has arrived.
	const [, forceTick] = useState(0)
	useEffect(() => {
		if (live !== true) return
		const id = setInterval(() => forceTick((value) => value + 1), 1000)
		return () => clearInterval(id)
	}, [live])

	useEffect(() => {
		const leaving = new AbortController()
		setLines([])
		setLive(null)
		setFailure(null)
		setEnded(false)
		arrivals.current = []
		setStartAt(null)

		let offset: string | undefined
		surface
			.watch<LogWindow>(
				'logs',
				{ node },
				(window) => {
					offset = String(window.offset)
					setLive(window.live)
					setRan(window.ran)
					if (window.lines.length > 0) {
						const now = new Date().toISOString()
						setStartAt((value) => value ?? now)
						for (let i = 0; i < window.lines.length; i += 1) arrivals.current.push(now)
						setLines((shown) => [...shown, ...window.lines])
					}
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

	// Stick to the bottom while the reader is at the bottom, and count what
	// they haven't seen while they aren't. A person who has scrolled up is
	// reading something, and yanking them back down on the next line is the
	// fastest way to make a live tail unreadable.
	useEffect(() => {
		const box = scroller.current
		if (following.current) {
			seenCount.current = lines.length
			setUnseen(0)
			if (box !== null) box.scrollTop = box.scrollHeight
		} else {
			setUnseen(lines.length - seenCount.current)
		}
	}, [lines])

	const jumpToBottom = (): void => {
		following.current = true
		seenCount.current = lines.length
		setUnseen(0)
		const box = scroller.current
		if (box !== null) box.scrollTop = box.scrollHeight
	}

	// The morph (ADR 0064): a FLIP transform between the card and the full
	// viewport, cancelled the moment it's superseded or this unmounts. Reduced
	// motion drops straight to a crossfade — the product follows the OS
	// setting, the mockup's force switch was review-only.
	const firstRect = useRef<DOMRect | null>(null)
	const scrollBeforeMorph = useRef(0)

	const toggleFull = (): void => {
		const box = dialog.current
		if (box !== null) firstRect.current = box.getBoundingClientRect()
		scrollBeforeMorph.current = scroller.current?.scrollTop ?? 0
		setFull((value) => !value)
	}

	useLayoutEffect(() => {
		const box = dialog.current
		const first = firstRect.current
		firstRect.current = null
		if (box === null || first === null) return

		const last = box.getBoundingClientRect()
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
		const duration = reduced ? MORPH_REDUCED_MS : full ? MORPH_GROW_MS : MORPH_SHRINK_MS
		const easing = reduced ? 'linear' : full ? MORPH_GROW_EASING : MORPH_SHRINK_EASING
		const frames: Keyframe[] = reduced
			? [{ opacity: 0 }, { opacity: 1 }]
			: [
					{
						transform: `translate(${first.left - last.left}px, ${first.top - last.top}px) scale(${last.width === 0 ? 1 : first.width / last.width}, ${last.height === 0 ? 1 : first.height / last.height})`,
						opacity: 0.7,
					},
					{ transform: 'none', opacity: 1 },
				]

		// `finished` rejects with AbortError on `cancel()` (a quick re-toggle, or
		// this unmounting mid-morph); nothing here awaits it, so it needs a catch
		// of its own or it surfaces as an unhandled rejection.
		const animations = [box.animate(frames, { duration, easing })]
		animations[0]?.finished.catch(() => {})

		if (!reduced) {
			const stages: (HTMLElement | null)[] = [
				titleBar.current,
				transcriptWrap.current,
				statusBar.current,
			]
			stages.forEach((element, index) => {
				if (element === null) return
				const stage = element.animate(
					[
						{ opacity: 0, transform: `translateY(${full ? 8 : -5}px)` },
						{ opacity: 1, transform: 'translateY(0)' },
					],
					{
						duration: full ? 220 : 170,
						delay: full ? 110 + index * STAGE_STAGGER_MS : 40 + (2 - index) * 45,
						easing: 'ease-out',
						fill: 'backwards',
					},
				)
				stage.finished.catch(() => {})
				animations.push(stage)
			})
		}

		const scrollBox = scroller.current
		if (scrollBox !== null)
			scrollBox.scrollTop = following.current ? scrollBox.scrollHeight : scrollBeforeMorph.current

		return () => {
			for (const animation of animations) animation.cancel()
		}
	}, [full])

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

	const onDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
		const target = event.target as HTMLElement
		if (target.closest('textarea, input') !== null) return
		if (event.ctrlKey || event.metaKey || event.altKey) return

		switch (event.key) {
			case 'f':
				event.preventDefault()
				toggleFull()
				return
			case 'Escape':
				// Leave full screen first, then close — and never let App.tsx's own
				// Escape handler fire a second time for the same keypress.
				event.stopPropagation()
				if (full) toggleFull()
				else onClose()
				return
			case 'j':
				event.preventDefault()
				scroller.current?.scrollBy(0, 80)
				return
			case 'k':
				event.preventDefault()
				scroller.current?.scrollBy(0, -80)
				return
			case 'g':
				event.preventDefault()
				if (scroller.current !== null) scroller.current.scrollTop = 0
				return
			case 'G':
				event.preventDefault()
				jumpToBottom()
				return
			case '/':
				event.preventDefault()
				setFindOpen(true)
				return
			default:
				return
		}
	}

	// Find opens with the box focused, the one time a state change should steal
	// focus inside the trap.
	useEffect(() => {
		if (findOpen) findInput.current?.focus()
	}, [findOpen])

	// A small hand-written Tab trap: focus never leaves the dialog while it's open.
	useEffect(() => {
		const box = dialog.current
		if (box === null) return
		box.focus()
		const trap = (event: KeyboardEvent): void => {
			if (event.key !== 'Tab') return
			const focusables = box.querySelectorAll<HTMLElement>(
				'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
			)
			if (focusables.length === 0) return
			const first = focusables[0] as HTMLElement
			const last = focusables[focusables.length - 1] as HTMLElement
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault()
				last.focus()
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault()
				first.focus()
			}
		}
		box.addEventListener('keydown', trap)
		return () => box.removeEventListener('keydown', trap)
	}, [])

	// Filtered together so a line's arrival stays paired with it once the find
	// box drops lines the query doesn't match.
	const paired = lines.map((line, index) => [line, arrivals.current[index] ?? null] as const)
	// Once the run has ended, its raw check/checked rows give way to the
	// checklist card below the transcript — the same acceptance facts, read once.
	const withoutChecklistRows = ended
		? paired.filter(([line]) => line.kind !== 'check' && line.kind !== 'checked')
		: paired
	const shownPaired = findOpen
		? withoutChecklistRows.filter(([line]) => matchesLine(line, query))
		: withoutChecklistRows
	const shown = shownPaired.map(([line]) => line)
	const shownArrivals = shownPaired.map(([, at]) => at)

	const checklist = buildChecklist(lines)
	const toolCount = lines.filter((line) => line.kind === 'tool').length
	const checksPassed = checklist.filter((item) => item.passed).length
	const totalElapsed = startAt !== null ? elapsedLabel(new Date().toISOString(), startAt) : '00:00'
	const lastLineAt = arrivals.current[arrivals.current.length - 1] ?? startAt
	const workingSeconds =
		lastLineAt !== null
			? Math.max(0, Math.floor((Date.now() - new Date(lastLineAt).getTime()) / 1000))
			: 0

	return (
		<Overlay
			label={`The run of ${node}`}
			width={980}
			full={full}
			onClose={onClose}
			dialogRef={dialog}
			onKeyDown={onDialogKeyDown}
		>
			<header
				ref={titleBar}
				className="flex shrink-0 items-center gap-4 border-[var(--line)] border-b px-6 py-4"
			>
				<Dots live={live} />
				<div className="min-w-0">
					<h2 className="font-medium text-[var(--ink)] text-base">
						<span className="text-[var(--ink-dim)]">sober ›</span> {node}
					</h2>
					{ran !== undefined && (
						<p className="mt-0.5 text-[var(--ink-faint)] text-xs">{ranWith(ran)}</p>
					)}
				</div>
				{ran !== undefined && <ModelBadge ran={ran} />}
				<div className="flex shrink-0 items-center gap-1">
					<Status live={live} ended={ended} failure={failure} />
					<button
						type="button"
						onClick={toggleFull}
						aria-pressed={full}
						aria-label={full ? 'Leave full screen (f)' : 'Enter full screen (f)'}
						className="rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--ink-dim)] text-xs hover:text-[var(--ink)]"
					>
						{full ? '↙ Restore' : '⛶ Full screen'}
					</button>
				</div>
			</header>

			{findOpen && (
				<div className="flex shrink-0 items-center gap-3 border-[var(--line-soft)] border-b px-6 py-2">
					<label htmlFor={`find-${node}`} className="text-[var(--ink-dim)] text-xs">
						Find
					</label>
					<input
						id={`find-${node}`}
						ref={findInput}
						type="search"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={(event) => {
							if (event.key !== 'Escape') return
							event.stopPropagation()
							setFindOpen(false)
							setQuery('')
						}}
						placeholder="Filter the transcript…"
						className="w-[min(360px,60%)] rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg)] px-2 py-1.5 text-[var(--ink)] text-sm outline-none focus:border-[var(--ink-faint)]"
					/>
					<span className="text-[var(--ink-dim)] text-xs">
						{query.trim() === '' ? 'All lines' : `${shown.length} lines`}
					</span>
					<button
						type="button"
						aria-label="Close find"
						onClick={() => {
							setFindOpen(false)
							setQuery('')
						}}
						className="ml-auto text-[var(--ink-dim)] text-base hover:text-[var(--ink)]"
					>
						×
					</button>
				</div>
			)}

			<div ref={transcriptWrap} className="relative min-h-[320px] flex-1">
				<div
					ref={scroller}
					onScroll={(event) => {
						const atBottomNow = atBottom(event.currentTarget)
						following.current = atBottomNow
						if (atBottomNow) {
							seenCount.current = lines.length
							setUnseen(0)
						}
					}}
					className="h-full overflow-y-auto px-6 py-4 font-mono text-[13px] leading-relaxed"
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

					{failure === null && lines.length > 0 && shown.length === 0 && (
						<p className="text-[var(--ink-faint)]">No matching lines.</p>
					)}

					<Transcript
						lines={shown}
						arrivals={shownArrivals}
						startAt={startAt ?? new Date().toISOString()}
						live={live}
					/>

					{ended && checklist.length > 0 && <ChecklistCard items={checklist} />}
				</div>

				{unseen > 0 && (
					<button
						type="button"
						onClick={jumpToBottom}
						className="-translate-x-1/2 absolute bottom-3 left-1/2 rounded-full border border-[var(--line)] bg-[var(--raised)] px-3 py-1.5 text-[var(--ink)] text-xs shadow-lg"
					>
						{unseen} new {unseen === 1 ? 'line' : 'lines'} ↓
					</button>
				)}
			</div>

			{live === true && (
				<div className="flex shrink-0 items-center gap-2.5 px-6 py-2 font-mono text-[var(--tx-think)] text-sm">
					<Ekg live={live === true} lineCount={lines.length} />
					<span>
						{THINKING_VERBS[verbIndex]}… ({workingSeconds}s)
					</span>
				</div>
			)}

			{live === true && (
				<footer ref={statusBar} className="shrink-0 border-[var(--line)] border-t px-6 py-3">
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
								if (event.key === 'Escape') {
									event.stopPropagation()
									return
								}
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

			<StatusBar
				live={live}
				ended={ended}
				failure={failure}
				elapsed={totalElapsed}
				tools={toolCount}
				checksPassed={checksPassed}
				checksTotal={checklist.length}
			/>
		</Overlay>
	)
}

/** ✓/✗ against each acceptance check, once the run that ran them has ended. */
const ChecklistCard = ({
	items,
}: {
	readonly items: readonly ChecklistItem[]
}): React.JSX.Element => {
	const passed = items.filter((item) => item.passed).length
	return (
		<div className="mt-4 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--bg)] px-4 py-3">
			<h3 className="mb-2 font-medium text-[var(--ink)] text-sm">Acceptance checks</h3>
			<ul className="space-y-1.5">
				{items.map((item, index) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: an append-only checklist has no other key
					<li key={index} className="flex gap-2.5 text-[var(--ink-dim)] text-sm">
						<span aria-hidden style={{ color: item.passed ? 'var(--tx-pass)' : 'var(--tx-error)' }}>
							{item.passed ? '✓' : '✗'}
						</span>
						{item.label}
					</li>
				))}
			</ul>
			<p className="mt-3 text-[var(--ink-faint)] text-xs">
				{passed}/{items.length} passed
			</p>
		</div>
	)
}

/** Three dots that wave while the run is live, still while it isn't (ADR 0064). */
const Dots = ({ live }: { readonly live: boolean | null }): React.JSX.Element => (
	<div className="flex shrink-0 gap-1.5" aria-hidden="true">
		{[0, 1, 2].map((key) => (
			<span
				key={key}
				className={`block h-[7px] w-[7px] rounded-full bg-[var(--ink-faint)] opacity-50 ${live === true ? 'sober-dot-wave' : ''}`}
			/>
		))}
	</div>
)

// Simplified provider marks, ported from `docs/design/watch-the-run.html`
// (CC0, in the spirit of simple-icons — vendored rather than fetched, since
// these are brand marks and not a colour: ADR 0064 keeps colour off the
// canvas and on this badge alone).
const PROVIDER_MARK: Readonly<Record<Provider, React.JSX.Element>> = {
	anthropic: (
		<path
			fill="currentColor"
			d="M2 20 9 4h3l7 16h-3l-1.5-4h-8L5 20Zm5.5-7h6L10.5 6ZM16 4h3l4 16h-3Z"
		/>
	),
	openai: (
		<>
			{[0, 1, 2, 3, 4, 5].map((index) => (
				<path
					key={index}
					transform={`rotate(${index * 60} 12 12)`}
					d="M12 12 7 9V5a4 4 0 0 1 7-2l3 5"
					fill="none"
					stroke="currentColor"
					strokeWidth={1.6}
					strokeLinejoin="round"
				/>
			))}
		</>
	),
	google: (
		<path
			fill="currentColor"
			d="M22 12c0-.7-.1-1.4-.2-2H12v4h5.6a6 6 0 1 1-1.4-6.3L19 4.9A10 10 0 1 0 22 12Z"
		/>
	),
	mistral: <path fill="currentColor" d="M2 3h4v4h4v4h4V7h4V3h4v18h-4v-6h-4v4h-4v-4H6v6H2Z" />,
	other: (
		<path
			d="m12 3 9 5v8l-9 5-9-5V8Zm0 0v18M3 8l9 5 9-5"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.5}
		/>
	),
}

/**
 * The model badge (ADR 0064): the provider mark and name, the model id, and
 * `via <host>`. The provider comes from the model id, never the host — an
 * openrouter host still shows Anthropic's mark for `anthropic/claude-…`.
 * With no model in the host line, only the fallback mark and the host show.
 */
const ModelBadge = ({
	ran,
}: {
	readonly ran: NonNullable<LogWindow['ran']>
}): React.JSX.Element => {
	const model = modelOf(ran.host)
	const provider = model !== null ? providerForModel(model) : 'other'
	return (
		<div className="ml-auto min-w-0 shrink-0 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--raised)] px-2.5 py-1.5">
			<div className="flex flex-wrap items-center gap-1.5 leading-snug">
				<svg
					viewBox="0 0 24 24"
					aria-hidden="true"
					className="h-5 w-5 shrink-0"
					style={{ color: PROVIDER_COLOUR[provider] }}
				>
					{PROVIDER_MARK[provider]}
				</svg>
				{model !== null && (
					<>
						<span className="font-semibold text-[var(--ink)] text-xs">
							{PROVIDER_NAME[provider]}
						</span>
						<span className="break-words font-mono text-[var(--ink)] text-xs">{model}</span>
					</>
				)}
			</div>
			<span className="mt-0.5 block pl-[27px] font-mono text-[var(--ink-dim)] text-xs">
				via {ran.host}
			</span>
		</div>
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
