/**
 * The run's footer (ADR 0064): live/ended/channel-closed, total elapsed, the
 * tool count and checks passed/total. The only screen-reader live region on
 * this screen — the transcript itself never announces, or every tool call
 * would interrupt whatever a screen reader was already reading.
 */
export const StatusBar = ({
	live,
	ended,
	failure,
	elapsed,
	tools,
	checksPassed,
	checksTotal,
}: {
	readonly live: boolean | null
	readonly ended: boolean
	readonly failure: string | null
	readonly elapsed: string
	readonly tools: number
	readonly checksPassed: number
	readonly checksTotal: number
}): React.JSX.Element => {
	const state = failure !== null ? 'channel closed' : live === true ? 'running' : 'ended'
	const running = failure === null && live === true && !ended

	return (
		<div
			aria-live="polite"
			className="flex shrink-0 items-center gap-4 border-[var(--line)] border-t bg-[var(--bg)] px-6 py-2 font-mono text-[var(--ink-dim)] text-xs"
		>
			<span className="flex items-center gap-1.5">
				<span
					aria-hidden
					className={`h-1.5 w-1.5 rounded-full ${running ? 'animate-pulse bg-[var(--status-running)]' : 'bg-[var(--status-done)]'}`}
				/>
				{state}
			</span>
			<span>{elapsed}</span>
			<span>⚒ {tools} tools</span>
			<span>
				◌ {checksPassed}/{checksTotal} checks
			</span>
			<span className="ml-auto hidden min-[700px]:inline">
				f expand · j/k scroll · g/G · / find
			</span>
		</div>
	)
}
