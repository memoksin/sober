import type { LogLine } from '@besober/schema'
import { useState } from 'react'
import { type Block, elapsedLabel, foldBody, groupLines, MARK, TONE, toolMark } from './data.js'

/**
 * The lines inside the frame, grouped into the blocks a reader sees. Grouping
 * itself lives in `data.ts` (`groupLines`) so it is tested without a screen —
 * this component only lays the blocks out.
 */
export const Transcript = ({
	lines,
	startAt,
	arrivals,
	live,
}: {
	readonly lines: readonly LogLine[]
	readonly startAt: string
	/** Arrival time recorded per line, index-aligned with `lines`, for a host whose stream carries no timestamp. */
	readonly arrivals: readonly (string | null)[]
	readonly live: boolean | null
}): React.JSX.Element => {
	const blocks = groupLines(lines)

	return (
		<ol className="space-y-1">
			{blocks.map((block, index) => (
				// The index is the identity: a log is append-only and a block has no
				// id of its own, so its position is what it is.
				// biome-ignore lint/suspicious/noArrayIndexKey: an append-only log has no other key
				<li key={index}>
					<BlockRow
						block={block}
						startAt={startAt}
						arrivals={arrivals}
						pulse={live === true && index === blocks.length - 1}
					/>
				</li>
			))}
		</ol>
	)
}

const ElapsedTime = ({
	line,
	at,
	startAt,
	arrivals,
}: {
	readonly line: LogLine
	readonly at: number
	readonly startAt: string
	readonly arrivals: readonly (string | null)[]
}): React.JSX.Element => (
	<time
		dateTime={line.at ?? arrivals[at] ?? startAt}
		className="ml-auto hidden shrink-0 text-[var(--ink-faint)] text-xs min-[700px]:block"
	>
		{elapsedLabel(line.at, startAt, arrivals[at])}
	</time>
)

const BlockRow = ({
	block,
	startAt,
	arrivals,
	pulse,
}: {
	readonly block: Block
	readonly startAt: string
	readonly arrivals: readonly (string | null)[]
	readonly pulse: boolean
}): React.JSX.Element => {
	if (block.kind === 'tool')
		return <ToolBlock block={block} startAt={startAt} arrivals={arrivals} />
	if (block.kind === 'orphanOutput')
		return (
			<OutputRow
				output={block.output}
				at={block.at}
				startAt={startAt}
				arrivals={arrivals}
				standalone
			/>
		)

	const line = block.line
	if (line.kind === 'thinking')
		return (
			<div className="flex gap-3">
				<span
					aria-hidden
					className={`mt-2 h-2 w-2 shrink-0 select-none rounded-full bg-[var(--tx-think)] ${pulse ? 'animate-pulse' : ''}`}
				/>
				<span className="whitespace-pre-wrap break-words text-[var(--ink-dim)]">{line.text}</span>
			</div>
		)

	if (line.kind === 'text' || line.kind === 'answer')
		return (
			<div className="flex gap-3">
				<span aria-hidden className="select-none" style={{ color: TONE[line.kind] }}>
					{MARK[line.kind]}
				</span>
				<span className="max-w-[76ch] whitespace-pre-wrap break-words font-[family-name:var(--font-transcript-sans)] text-[var(--ink)]">
					{line.text}
				</span>
				<ElapsedTime line={line} at={block.at} startAt={startAt} arrivals={arrivals} />
			</div>
		)

	return (
		<div className="flex gap-3">
			<span aria-hidden className="select-none" style={{ color: TONE[line.kind] }}>
				{line.kind === 'tool' ? toolMark(line.tool ?? '') : MARK[line.kind]}
			</span>
			<span className="whitespace-pre-wrap break-words text-[var(--ink-dim)]">{line.text}</span>
			<ElapsedTime line={line} at={block.at} startAt={startAt} arrivals={arrivals} />
		</div>
	)
}

/** A tool call, its argument detail, and — once it has arrived — its result underneath. */
const ToolBlock = ({
	block,
	startAt,
	arrivals,
}: {
	readonly block: Extract<Block, { kind: 'tool' }>
	readonly startAt: string
	readonly arrivals: readonly (string | null)[]
}): React.JSX.Element => {
	const { tool, output } = block
	// Old logs (before line-detail) carry no `detail`: the bare tool text
	// renders exactly as it did before this component existed.
	const label = tool.detail ?? tool.text

	return (
		<div className="flex flex-col gap-1">
			<div className="flex gap-3">
				<span aria-hidden className="select-none" style={{ color: 'var(--tx-tool)' }}>
					{toolMark(tool.tool ?? '')}
				</span>
				<span className="whitespace-pre-wrap break-words font-[family-name:var(--font-transcript-mono)] text-[var(--tx-tool)]">
					{label}
				</span>
				<ElapsedTime line={tool} at={block.at} startAt={startAt} arrivals={arrivals} />
			</div>
			{output !== null && (
				<OutputRow
					output={output}
					at={block.outputAt ?? block.at}
					startAt={startAt}
					arrivals={arrivals}
				/>
			)}
		</div>
	)
}

const OutputRow = ({
	output,
	at,
	startAt,
	arrivals,
	standalone = false,
}: {
	readonly output: LogLine
	readonly at: number
	readonly startAt: string
	readonly arrivals: readonly (string | null)[]
	readonly standalone?: boolean
}): React.JSX.Element => {
	const [expanded, setExpanded] = useState(false)
	const body = output.body
	const folded = body !== null ? foldBody(body) : null

	return (
		<div className={`flex gap-3 ${standalone ? '' : 'pl-6'}`}>
			<span aria-hidden className="select-none" style={{ color: TONE.output }}>
				{MARK.output}
			</span>
			<div className="min-w-0 flex-1">
				<span className="whitespace-pre-wrap break-words text-[var(--tx-result)]">
					{output.text}
				</span>
				{folded !== null && (
					<div className="mt-1">
						<pre className="whitespace-pre-wrap break-words font-[family-name:var(--font-transcript-mono)] text-[var(--tx-result)]">
							{expanded ? body : folded.shown}
						</pre>
						{folded.hidden > 0 && (
							<button
								type="button"
								aria-expanded={expanded}
								onClick={() => setExpanded((value) => !value)}
								className="mt-0.5 text-[var(--ink-dim)] text-xs hover:text-[var(--ink)]"
							>
								{expanded ? '− Collapse output' : `… +${folded.hidden} lines (click to expand)`}
							</button>
						)}
					</div>
				)}
			</div>
			<ElapsedTime line={output} at={at} startAt={startAt} arrivals={arrivals} />
		</div>
	)
}
