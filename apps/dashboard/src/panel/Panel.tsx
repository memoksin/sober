import type { BoardRead } from './data.js'
import { held } from './data.js'

/**
 * One node, in full. The canvas answers "what is here and what touches what";
 * this answers "what is this one, and why is it not moving".
 *
 * It floats over the canvas rather than sitting beside it. Taking width from
 * the canvas would re-fit the graph, and every node on screen would move
 * because somebody clicked one of them — the jump `sameShape` exists to
 * prevent, arriving through the other door.
 */
export const Panel = ({
	board,
	id,
	onClose,
	onPick,
	onDecide,
}: {
	readonly board: BoardRead
	readonly id: string
	readonly onClose: () => void
	readonly onPick: (id: string) => void
	readonly onDecide: (id: string) => void
}): React.JSX.Element => {
	const node = board.nodes.find((one) => one.id === id)

	return (
		<aside className="pointer-events-auto absolute top-0 right-0 bottom-0 z-20 flex w-[420px] max-w-full flex-col overflow-y-auto border-[var(--line)] border-l bg-[var(--surface)]">
			{node === undefined ? (
				<Gone id={id} onClose={onClose} />
			) : (
				<>
					<header className="flex items-start gap-3 border-[var(--line)] border-b px-4 py-3">
						<span
							aria-hidden
							className="mt-1.5 size-2.5 shrink-0 rounded-full"
							style={{ background: `var(--status-${node.status ?? 'needs-brief'})` }}
						/>
						<div className="min-w-0 flex-1">
							<h2 className="text-[length:var(--text-md)] text-[var(--ink)] leading-tight">
								{node.title}
							</h2>
							<p className="mt-1 flex items-center gap-2 text-[length:var(--text-xs)]">
								<span className="text-[var(--ink-dim)]">{node.status ?? 'unknown'}</span>
								<code className="font-[family-name:var(--font-mono)] text-[var(--ink-faint)]">
									{node.id}
								</code>
							</p>
						</div>
						<button
							type="button"
							onClick={onClose}
							aria-label="Close"
							className="-mr-1 rounded-[var(--radius-sm)] px-2 py-0.5 text-[var(--ink-faint)] hover:bg-[var(--raised)] hover:text-[var(--ink)]"
						>
							×
						</button>
					</header>

					<div className="flex flex-col gap-5 px-4 py-4">
						{node.description !== '' && (
							<p className="whitespace-pre-wrap text-[length:var(--text-base)] text-[var(--ink-dim)] leading-[var(--leading-prose)]">
								{node.description}
							</p>
						)}

						<Waiting board={board} id={id} onPick={onPick} onDecide={onDecide} />

						{node.brief !== null && (
							<Section title="Brief">
								<p className="whitespace-pre-wrap text-[length:var(--text-sm)] text-[var(--ink-dim)] leading-[var(--leading-prose)]">
									{node.brief.approach}
								</p>
								<ul className="mt-2 flex flex-col gap-1.5">
									{node.brief.acceptance.map((criterion) => (
										<li key={criterion.run} className="text-[length:var(--text-sm)]">
											<code className="font-[family-name:var(--font-mono)] text-[var(--ink)]">
												{criterion.run}
											</code>
											<span className="ml-2 text-[var(--ink-faint)]">{criterion.proves}</span>
										</li>
									))}
								</ul>
								<p className="mt-2 text-[length:var(--text-xs)] text-[var(--ink-faint)]">
									{node.brief.approval === null
										? 'not approved yet'
										: `approved by ${node.brief.approval.by}${node.brief.approval.queue ? ', queued' : ''}`}
								</p>
							</Section>
						)}

						{node.decisions.length > 0 && (
							<Section title="Decisions">
								{node.decisions.map((decision) => {
									const record = board.decisions.find((one) => one.id === decision)
									return (
										<Line
											key={decision}
											onClick={() => onDecide(decision)}
											mark={record?.answer == null ? 'var(--status-held)' : 'var(--status-done)'}
											label={record?.question ?? decision}
											note={record?.answer == null ? 'unanswered' : record.answer.option}
										/>
									)
								})}
							</Section>
						)}

						{node.dependsOn.length > 0 && (
							<Section title="Depends on">
								{node.dependsOn.map((upstream) => {
									const other = board.nodes.find((one) => one.id === upstream)
									return (
										<Line
											key={upstream}
											onClick={() => onPick(upstream)}
											mark={`var(--status-${other?.status ?? 'needs-brief'})`}
											label={other?.title ?? upstream}
											note={other?.status ?? 'not on this board'}
										/>
									)
								})}
							</Section>
						)}

						{node.files.length > 0 && (
							<Section title="Files">
								<ul className="flex flex-col gap-0.5">
									{node.files.map((glob) => (
										<li
											key={glob}
											className="font-[family-name:var(--font-mono)] text-[length:var(--text-sm)] text-[var(--ink-dim)]"
										>
											{glob}
										</li>
									))}
								</ul>
								<p className="mt-1.5 text-[length:var(--text-xs)] text-[var(--ink-faint)]">
									A prediction, refined when the brief is rendered — not a contract.
								</p>
							</Section>
						)}

						<Who node={node} />

						{node.accepted !== null && (
							<Section title="Accepted">
								<p className="text-[length:var(--text-sm)] text-[var(--ink-dim)]">
									by {node.accepted.by} · scan {node.accepted.scan}
									{node.accepted.flagged ? ' · flagged' : ''}
								</p>
								{node.outcome !== null && node.outcome !== '' && (
									<p className="mt-1.5 whitespace-pre-wrap text-[length:var(--text-sm)] text-[var(--ink-dim)] leading-[var(--leading-prose)]">
										{node.outcome}
									</p>
								)}
							</Section>
						)}
					</div>
				</>
			)}
		</aside>
	)
}

/**
 * The one thing a reader wants beside a node that is not moving. Rendered
 * before the brief and before the dependency list, because it is the answer
 * both of those are being read for.
 */
const Waiting = ({
	board,
	id,
	onPick,
	onDecide,
}: {
	readonly board: BoardRead
	readonly id: string
	readonly onPick: (id: string) => void
	readonly onDecide: (id: string) => void
}): React.JSX.Element | null => {
	const waits = held(board, id)
	if (waits.length === 0) return null

	return (
		<Section title="Waiting on">
			{waits.map((wait) => (
				<Line
					key={`${wait.kind}:${wait.id}`}
					onClick={() => (wait.kind === 'decision' ? onDecide(wait.id) : onPick(wait.id))}
					mark={wait.kind === 'decision' ? 'var(--status-held)' : 'var(--status-blocked)'}
					label={wait.label}
					// A wait nothing can answer is the one a person needs told, not
					// the one to leave looking like an ordinary queue (§8.4).
					note={wait.gone ? 'nothing on this board answers it' : wait.kind}
					warn={wait.gone}
				/>
			))}
		</Section>
	)
}

/** A claim is a fact, an assignment is a plan (DESIGN §3.3) — never the same line. */
const Who = ({ node }: { readonly node: BoardRead['nodes'][number] }): React.JSX.Element | null => {
	if (node.claim === null && node.assignee === null) return null

	return (
		<Section title="Who">
			{node.claim !== null && (
				<p className="text-[length:var(--text-sm)] text-[var(--ink)]">
					{node.claim.by} has it
					{node.assignee !== null && node.assignee !== node.claim.by && (
						<span className="text-[var(--ink-faint)]"> (planned for {node.assignee})</span>
					)}
				</p>
			)}
			{node.claim === null && node.assignee !== null && (
				<p className="text-[length:var(--text-sm)] text-[var(--ink-dim)]">
					heading to {node.assignee}
				</p>
			)}
		</Section>
	)
}

const Section = ({
	title,
	children,
}: {
	readonly title: string
	readonly children: React.ReactNode
}): React.JSX.Element => (
	<section>
		<h3 className="mb-1.5 font-medium text-[length:var(--text-xs)] text-[var(--ink-faint)] uppercase tracking-wider">
			{title}
		</h3>
		{children}
	</section>
)

const Line = ({
	onClick,
	mark,
	label,
	note,
	warn = false,
}: {
	readonly onClick: () => void
	readonly mark: string
	readonly label: string
	readonly note: string
	readonly warn?: boolean
}): React.JSX.Element => (
	<button
		type="button"
		onClick={onClick}
		className="-mx-2 flex w-[calc(100%+1rem)] items-start gap-2.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-left hover:bg-[var(--raised)]"
	>
		<span
			aria-hidden
			className="mt-1.5 size-2 shrink-0 rounded-full"
			style={{ background: mark }}
		/>
		<span className="min-w-0 flex-1">
			<span className="block text-[length:var(--text-sm)] text-[var(--ink)] leading-tight">
				{label}
			</span>
			<span
				className="block text-[length:var(--text-xs)]"
				style={{ color: warn ? 'var(--danger)' : 'var(--ink-faint)' }}
			>
				{note}
			</span>
		</span>
	</button>
)

/**
 * The board moved under the panel — somebody archived the node, or a teammate's
 * sync took it away. Said, rather than the drawer emptying itself.
 */
const Gone = ({
	id,
	onClose,
}: {
	readonly id: string
	readonly onClose: () => void
}): React.JSX.Element => (
	<div className="flex flex-1 flex-col items-start gap-3 px-4 py-4">
		<p className="text-[length:var(--text-sm)] text-[var(--ink)]">
			<code className="font-[family-name:var(--font-mono)]">{id}</code> is no longer on this board.
		</p>
		<button
			type="button"
			onClick={onClose}
			className="rounded-[var(--radius-sm)] border border-[var(--line)] px-2.5 py-1 text-[length:var(--text-xs)] text-[var(--ink-dim)] hover:text-[var(--ink)]"
		>
			Close
		</button>
	</div>
)
