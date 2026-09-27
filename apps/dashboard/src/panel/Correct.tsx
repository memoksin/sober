import { useState } from 'react'
import type { BoardRead } from './data.js'

export interface CorrectionInput {
	readonly title?: string
	readonly name?: string
	readonly description?: string
}

/**
 * The node's own words, rewritten in place (`core`'s `correctNode`). Collapsed
 * to an `Edit` trigger beside the header when nobody is correcting anything —
 * the display mode this drawer opens in most of the time stays exactly as it
 * was before this existed.
 */
export const Correct = ({
	node,
	onCorrect,
}: {
	readonly node: Pick<BoardRead['nodes'][number], 'title' | 'name' | 'description'>
	readonly onCorrect: (correction: CorrectionInput) => Promise<void>
}): React.JSX.Element => {
	const [editing, setEditing] = useState(false)
	const [title, setTitle] = useState(node.title)
	const [name, setName] = useState(node.name)
	const [description, setDescription] = useState(node.description)
	const [busy, setBusy] = useState(false)
	const [refused, setRefused] = useState<string | null>(null)

	const start = (): void => {
		setTitle(node.title)
		setName(node.name)
		setDescription(node.description)
		setRefused(null)
		setEditing(true)
	}

	if (!editing)
		return (
			<div className="border-[var(--line)] border-b px-4 py-2">
				<button
					type="button"
					onClick={start}
					className="rounded-[var(--radius-sm)] px-2 py-0.5 text-[length:var(--text-xs)] text-[var(--ink-faint)] hover:bg-[var(--raised)] hover:text-[var(--ink)]"
				>
					Edit title, name or description
				</button>
			</div>
		)

	const save = async (): Promise<void> => {
		setBusy(true)
		setRefused(null)
		try {
			await onCorrect({ title, name, description })
			setEditing(false)
		} catch (error) {
			setRefused(error instanceof Error ? error.message : String(error))
		} finally {
			setBusy(false)
		}
	}

	return (
		<div className="flex flex-col gap-2 border-[var(--line)] border-b bg-[var(--raised)] px-4 py-3">
			<label className="flex flex-col gap-1.5">
				<span className="font-medium text-[length:var(--text-xs)] text-[var(--ink-faint)] uppercase tracking-wider">
					Title
				</span>
				<input
					value={title}
					onChange={(event) => setTitle(event.target.value)}
					className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-[length:var(--text-sm)] text-[var(--ink)] focus:border-[var(--ink-faint)] focus:outline-none"
				/>
			</label>
			<label className="flex flex-col gap-1.5">
				<span className="font-medium text-[length:var(--text-xs)] text-[var(--ink-faint)] uppercase tracking-wider">
					Name
				</span>
				<input
					value={name}
					onChange={(event) => setName(event.target.value)}
					className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-[length:var(--text-sm)] text-[var(--ink)] focus:border-[var(--ink-faint)] focus:outline-none"
				/>
			</label>
			<label className="flex flex-col gap-1.5">
				<span className="font-medium text-[length:var(--text-xs)] text-[var(--ink-faint)] uppercase tracking-wider">
					Description
				</span>
				<textarea
					value={description}
					onChange={(event) => setDescription(event.target.value)}
					rows={3}
					className="resize-y rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-[length:var(--text-sm)] text-[var(--ink)] leading-[var(--leading-prose)] focus:border-[var(--ink-faint)] focus:outline-none"
				/>
			</label>
			<div className="flex gap-2">
				<button
					type="button"
					onClick={() => void save()}
					disabled={busy || title.trim() === '' || name.trim() === ''}
					className="rounded-[var(--radius-sm)] bg-[var(--ink)] px-3 py-1.5 text-[length:var(--text-sm)] text-[var(--bg)] disabled:cursor-not-allowed disabled:opacity-40"
				>
					{busy ? 'Saving…' : 'Save'}
				</button>
				<button
					type="button"
					onClick={() => setEditing(false)}
					disabled={busy}
					className="rounded-[var(--radius-sm)] px-3 py-1.5 text-[length:var(--text-sm)] text-[var(--ink-dim)] hover:text-[var(--ink)] disabled:opacity-40"
				>
					Cancel
				</button>
			</div>
			{refused !== null && (
				<p className="text-[length:var(--text-sm)] text-[var(--danger)] leading-[var(--leading-prose)]">
					{refused}
				</p>
			)}
		</div>
	)
}
