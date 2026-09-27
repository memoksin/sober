import type { Added, ModelList, Removed } from '@besober/core'
import { useCallback, useEffect, useState } from 'react'
import { Overlay } from '../Overlay.js'
import { pending } from '../pending.js'
import type { Wire } from '../wire.js'
import { byHost, type HostGroup, rangeOf } from './data.js'

const FIELD =
	'rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-[var(--ink)] text-xs placeholder:text-[var(--ink-faint)] focus:border-[var(--ink-faint)] focus:outline-none'
const BUTTON =
	'rounded-[var(--radius-sm)] px-2 py-1 text-[var(--ink-dim)] text-xs hover:bg-[var(--raised)] hover:text-[var(--ink)] disabled:opacity-50'

const addedSentence = (added: Added): string =>
	added.kind === 'lifted'
		? `${added.model.name} is back: its deny entry in dispatch.sources.${added.host} is gone`
		: `${added.model.name} pinned in dispatch.models, for scores ${added.model.complexity[0]}–${added.model.complexity[1]}`

const removedSentence = (removed: Removed): string =>
	removed.kind === 'unpinned'
		? `${removed.name} removed from dispatch.models`
		: `${removed.name} denied: ${removed.id} added to dispatch.sources.${removed.host}.deny`

/**
 * Every model Jev could pick, by host, with the scores each covers. The writes
 * are `sober models add` and `sober models remove`, through the same core, so
 * the screen and the command line never disagree about the config.
 */
export const ModelsScreen = ({
	surface,
	onClose,
}: {
	readonly surface: Wire
	readonly onClose: () => void
}): React.JSX.Element => {
	const [list, setList] = useState<ModelList | null>(null)
	const [busy, setBusy] = useState<string | null>(null)
	const [said, setSaid] = useState<string | null>(null)
	const [failure, setFailure] = useState<string | null>(null)

	const read = useCallback(async (): Promise<void> => {
		try {
			setList(await surface.read<ModelList>('models'))
		} catch (error) {
			setFailure(error instanceof Error ? error.message : String(error))
		}
	}, [surface])

	useEffect(() => {
		void read()
	}, [read])

	const write = async (does: 'add_model' | 'remove_model', work: () => Promise<string>) => {
		setBusy(does)
		setFailure(null)
		setSaid(null)
		try {
			setSaid(await work())
			await read()
		} catch (error) {
			setFailure(error instanceof Error ? error.message : String(error))
		} finally {
			setBusy(null)
		}
	}

	const remove = (name: string) =>
		write('remove_model', async () =>
			removedSentence(await surface.op<Removed>('remove_model', { name })),
		)
	const add = (body: object) =>
		write('add_model', async () => addedSentence(await surface.op<Added>('add_model', body)))

	return (
		<Overlay label="Models" width={760} onClose={onClose}>
			<header className="border-[var(--line)] border-b px-5 py-4">
				<h2 className="font-medium text-[length:var(--text-sm)] text-[var(--ink)]">
					What Jev can pick
				</h2>
				<p className="mt-1 text-[var(--ink-dim)] text-xs">
					From dispatch.sources and the pins in dispatch.models, as the next dispatch sees them.
				</p>
			</header>

			{(busy !== null || said !== null || failure !== null) && (
				<p
					role={failure === null ? 'status' : 'alert'}
					className={`border-[var(--line)] border-b bg-[var(--raised)] px-5 py-1.5 text-xs ${failure === null ? 'text-[var(--ink-dim)]' : 'text-[var(--danger)]'}`}
				>
					{busy !== null ? pending(busy) : (failure ?? said)}
				</p>
			)}

			<div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
				{list === null ? (
					<p className="text-[var(--ink-faint)] text-xs">
						{failure === null ? 'reading the catalogues…' : 'the model list could not be read'}
					</p>
				) : (
					<>
						{byHost(list).map((group) => (
							<HostSection
								key={group.host}
								group={group}
								busy={busy !== null}
								onRemove={remove}
								onAdd={add}
								onRefused={setFailure}
							/>
						))}
						{list.dropped.length > 0 && (
							<section className="text-[var(--ink-faint)] text-xs">
								<h3 className="mb-1 font-medium uppercase tracking-wider">dropped</h3>
								{list.dropped.map((reason) => (
									<p key={reason}>{reason}</p>
								))}
							</section>
						)}
						<TypedPin busy={busy !== null} onAdd={add} onRefused={setFailure} />
					</>
				)}
			</div>
		</Overlay>
	)
}

const Range = ({
	low,
	high,
	onLow,
	onHigh,
}: {
	readonly low: string
	readonly high: string
	readonly onLow: (value: string) => void
	readonly onHigh: (value: string) => void
}): React.JSX.Element => (
	<>
		<input
			type="number"
			min={1}
			max={10}
			aria-label="lowest score"
			placeholder="from"
			value={low}
			onChange={(event) => onLow(event.target.value)}
			className={`${FIELD} w-16`}
		/>
		<input
			type="number"
			min={1}
			max={10}
			aria-label="highest score"
			placeholder="to"
			value={high}
			onChange={(event) => onHigh(event.target.value)}
			className={`${FIELD} w-16`}
		/>
	</>
)

const HostSection = ({
	group,
	busy,
	onRemove,
	onAdd,
	onRefused,
}: {
	readonly group: HostGroup
	readonly busy: boolean
	readonly onRemove: (name: string) => void
	readonly onAdd: (body: object) => void
	readonly onRefused: (reason: string) => void
}): React.JSX.Element => {
	const [id, setId] = useState('')
	const [low, setLow] = useState('')
	const [high, setHigh] = useState('')
	const picked = id === '' ? group.addable[0]?.id : id

	const pick = () => {
		const range = rangeOf(low, high)
		if ('error' in range) return onRefused(range.error)
		if (picked === undefined) return
		onAdd({ host: group.host, id: picked, ...(range.range && { complexity: range.range }) })
	}

	return (
		<section aria-label={group.host} className="flex flex-col gap-2">
			<h3 className="flex items-baseline gap-2 text-xs">
				<span className="font-medium text-[var(--ink)]">{group.host}</span>
				<span className="text-[var(--ink-faint)] tabular-nums">
					{group.covers === null
						? 'covers no score'
						: `covers ${group.covers[0]}–${group.covers[1]}`}
				</span>
				{!group.sourced && group.host !== 'other' && (
					<span className="text-[var(--ink-faint)]">
						not in dispatch.sources · a pick is pinned
					</span>
				)}
			</h3>

			{group.models.length === 0 ? (
				<p className="text-[var(--ink-faint)] text-xs">No model on this host.</p>
			) : (
				<ul className="flex flex-col">
					{group.models.map((model) => (
						<li
							key={model.name}
							className="flex items-baseline gap-3 border-[var(--line)] border-b py-1 text-xs"
						>
							<span className="w-32 truncate text-[var(--ink)]">{model.name}</span>
							<span className="flex-1 truncate font-mono text-[10px] text-[var(--ink-dim)]">
								{model.run}
							</span>
							<span className="text-[var(--ink-faint)] tabular-nums">
								{model.complexity[0]}–{model.complexity[1]}
							</span>
							<span className="w-12 text-[var(--ink-faint)]">
								{model.pinned ? 'pinned' : 'sourced'}
							</span>
							<button
								type="button"
								disabled={busy}
								onClick={() => onRemove(model.name)}
								className={BUTTON}
							>
								Remove
							</button>
						</li>
					))}
				</ul>
			)}

			{group.host !== 'other' &&
				(!group.reachable ? (
					<p className="text-[var(--ink-faint)] text-xs">The catalogue could not be read.</p>
				) : group.addable.length === 0 ? (
					<p className="text-[var(--ink-faint)] text-xs">Everything in the catalogue is listed.</p>
				) : (
					<div className="flex items-center gap-2">
						<select
							aria-label={`add from the ${group.host} catalogue`}
							value={picked}
							onChange={(event) => setId(event.target.value)}
							className={`${FIELD} min-w-0 flex-1`}
						>
							{group.addable.map((c) => (
								<option key={c.id} value={c.id}>
									{c.name} · {c.id}
									{c.free ? ' · free' : ''}
								</option>
							))}
						</select>
						<Range low={low} high={high} onLow={setLow} onHigh={setHigh} />
						<button type="button" disabled={busy} onClick={pick} className={BUTTON}>
							Add
						</button>
					</div>
				))}
		</section>
	)
}

/** A pin typed by hand — a model no catalogue lists yet, like `fable` before Claude's table has it. */
const TypedPin = ({
	busy,
	onAdd,
	onRefused,
}: {
	readonly busy: boolean
	readonly onAdd: (body: object) => void
	readonly onRefused: (reason: string) => void
}): React.JSX.Element => {
	const [name, setName] = useState('')
	const [run, setRun] = useState('')
	const [low, setLow] = useState('')
	const [high, setHigh] = useState('')

	const pin = () => {
		const range = rangeOf(low, high)
		if ('error' in range) return onRefused(range.error)
		if (name.trim() === '' || run.trim() === '' || range.range === undefined)
			return onRefused('a pin needs a name, a run line and the scores it takes')
		onAdd({ name: name.trim(), run: run.trim(), complexity: range.range })
	}

	return (
		<section aria-label="type a pin" className="flex flex-col gap-2">
			<h3 className="font-medium text-[var(--ink)] text-xs">Type a pin</h3>
			<div className="flex items-center gap-2">
				<input
					aria-label="name"
					placeholder="fable"
					value={name}
					onChange={(event) => setName(event.target.value)}
					className={`${FIELD} w-28`}
				/>
				<input
					aria-label="run line"
					placeholder="claude --model claude-fable-5-1"
					value={run}
					onChange={(event) => setRun(event.target.value)}
					className={`${FIELD} min-w-0 flex-1 font-mono`}
				/>
				<Range low={low} high={high} onLow={setLow} onHigh={setHigh} />
				<button type="button" disabled={busy} onClick={pin} className={BUTTON}>
					Pin
				</button>
			</div>
		</section>
	)
}
