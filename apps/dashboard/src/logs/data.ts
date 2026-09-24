import { type LogLine, type LogWindow, ranLabel } from '@besober/schema'

/**
 * What each kind of line looks like, beside the component for the reason
 * `panel/data.ts` gives: a fact about how a log reads is testable without a
 * screen, and a fact rendered by one screen is a fact nobody can check.
 *
 * The marks are the CLI's, deliberately. `sober logs` and this screen show the
 * same run, and two vocabularies for one thing is how a person ends up unsure
 * whether they are looking at the same output. The CLI's copy is `TAIL` in
 * `packages/cli/src/work.ts`, aligned by hand: change one, check the other.
 */
export const MARK: Readonly<Record<LogLine['kind'], string>> = {
	started: '▸',
	text: '·',
	thinking: '…',
	tool: '⚒',
	result: '■',
	check: '◌',
	checked: '■',
	raw: '!',
	// What the human said back, echoed into the log by the host. It points the
	// other way because it is the one line that came from this side.
	answer: '›',
	output: '⎿',
}

// The transcript's own tones (ADR 0064), not the board's status colours: a
// log line has no status, so it never borrows one.
export const TONE: Readonly<Record<LogLine['kind'], string>> = {
	started: 'var(--ink-faint)',
	text: 'var(--ink-faint)',
	thinking: 'var(--tx-think)',
	tool: 'var(--tx-tool)',
	result: 'var(--ink)',
	check: 'var(--ink-dim)',
	checked: 'var(--ink)',
	// The host's own stderr. It is the one thing a failing run always has, so
	// it is the one thing that must not read like ordinary output.
	raw: 'var(--tx-error)',
	answer: 'var(--tx-human)',
	output: 'var(--tx-result)',
}

// A display convenience, not an allowlist: a host naming a tool nobody listed is
// a missing glyph, never a missing line. Glyphs only — ADR 0039 gives colour one job.
export const TOOL: Readonly<Record<string, string>> = {
	read: '◧',
	edit: '✎',
	write: '✍',
	bash: '$',
	grep: '⌕',
	glob: '✱',
	task: '⧉',
	webfetch: '⇣',
}

export const TOOL_FALLBACK = '⚒'

export const toolMark = (tool: string): string => TOOL[tool.trim().toLowerCase()] ?? TOOL_FALLBACK

/**
 * Whether a scrolling box is at its bottom, within a line's slack.
 *
 * The slack is what makes this usable. Sub-pixel scroll positions and a
 * fractional device ratio mean `scrollTop + clientHeight` is rarely exactly
 * `scrollHeight`, so an exact comparison reads as "scrolled up" on a screen
 * nobody has touched — and then the tail silently stops following.
 */
export const atBottom = (box: {
	scrollTop: number
	clientHeight: number
	scrollHeight: number
}): boolean => box.scrollHeight - box.scrollTop - box.clientHeight < 24

/**
 * Whether a line matches a find query. Null-safe on `detail`: the field
 * arrives with `line-detail`, and a line log-adapters haven't reached yet
 * still has to be searchable on `text` and `tool` alone.
 */
export const matchesLine = (
	line: Pick<LogLine, 'text' | 'tool'> & { detail?: string | null },
	query: string,
): boolean => {
	const q = query.trim().toLowerCase()
	if (q === '') return true
	return [line.text, line.detail, line.tool].some(
		(field) => typeof field === 'string' && field.toLowerCase().includes(q),
	)
}

/**
 * The model a host's command line was launched with. Handles `--model X`,
 * `--model=X` and `-m X`; null when the line names none.
 */
export const modelOf = (host: string): string | null => {
	const eq = /--model=(\S+)/.exec(host)
	if (eq !== null) return eq[1] ?? null
	const spaced = /(?:--model|-m)\s+(\S+)/.exec(host)
	return spaced?.[1] ?? null
}

export type Provider = 'anthropic' | 'openai' | 'google' | 'mistral' | 'other'

export const PROVIDER_NAME: Readonly<Record<Provider, string>> = {
	anthropic: 'Anthropic',
	openai: 'OpenAI',
	google: 'Google',
	mistral: 'Mistral',
	other: 'Other provider',
}

// The brand tokens ADR 0064 adds; a fallback for whatever a model id doesn't name.
export const PROVIDER_COLOUR: Readonly<Record<Provider, string>> = {
	anthropic: 'var(--provider-anthropic)',
	openai: 'var(--provider-openai)',
	google: 'var(--provider-google)',
	mistral: 'var(--provider-mistral)',
	other: 'var(--provider-other)',
}

/**
 * The provider a model id names, not the host that ran it — `anthropic/claude-…`
 * on openrouter is still Anthropic. Ported from `docs/design/watch-the-run.html`.
 */
export const providerForModel = (model: string): Provider => {
	const id = model.toLowerCase()
	if (/(^|\/)(anthropic\/|claude-)/.test(id)) return 'anthropic'
	if (/(^|\/)(openai\/|gpt-|o[134](?:-|$))/.test(id)) return 'openai'
	if (/(^|\/)(google\/|gemini-)/.test(id)) return 'google'
	if (/(^|\/)(mistralai\/|mistral-|codestral-)/.test(id)) return 'mistral'
	return 'other'
}

/** The run screen's full-screen morph (ADR 0064), timed to match the mockup's `toggleFull`. */
export const MORPH_GROW_MS = 450
export const MORPH_SHRINK_MS = 330
export const MORPH_REDUCED_MS = 120
export const MORPH_GROW_EASING = 'linear(0, 0.32 12%, 0.72 27%, 0.95 43%, 1.018 60%, 0.995 80%, 1)'
export const MORPH_SHRINK_EASING = 'cubic-bezier(.22, 1, .36, 1)'
export const STAGE_STAGGER_MS = 60

/** The host line, what chose it and the fallback, as the run record wrote them (ADR 0058, 0061). */
export const ranWith = ({ host, tier, fallback }: NonNullable<LogWindow['ran']>): string =>
	`Ran \`${host}\` — ${ranLabel({ tier, fallback })}`

/**
 * One row of the transcript: either a single line, or a `tool` paired with the
 * `output` that answers its `call`.
 */
export type Block =
	| { readonly kind: 'single'; readonly line: LogLine; readonly at: number }
	| {
			readonly kind: 'tool'
			readonly tool: LogLine
			readonly output: LogLine | null
			readonly at: number
			readonly outputAt: number | null
	  }
	| { readonly kind: 'orphanOutput'; readonly output: LogLine; readonly at: number }

/**
 * Groups a flat log into the blocks a reader sees: a `tool` line and the
 * `output` that shares its `call` become one block, so a call and its result
 * read as a single unit instead of two lines a person has to mentally pair up.
 *
 * A `tool` with no `call` (old logs, before line-detail) or whose output
 * hasn't arrived yet stands alone — it renders pending until an output shows
 * up. When a call has more than one output, the last one wins: a host that
 * streams partial results only ever means the final one.
 */
export const groupLines = (lines: readonly LogLine[]): Block[] => {
	const blocks: Block[] = []
	// Index into `blocks` for each call id seen as a `tool` line, so a later
	// `output` with the same call finds its block instead of starting a new one.
	const toolAt = new Map<string, number>()

	lines.forEach((line, at) => {
		if (line.kind === 'tool') {
			if (line.call !== null) toolAt.set(line.call, blocks.length)
			blocks.push({ kind: 'tool', tool: line, output: null, at, outputAt: null })
			return
		}

		if (line.kind === 'output') {
			const pairedAt = line.call !== null ? toolAt.get(line.call) : undefined
			if (pairedAt !== undefined) {
				const paired = blocks[pairedAt]
				if (paired?.kind === 'tool') {
					blocks[pairedAt] = { ...paired, output: line, outputAt: at }
					return
				}
			}
			blocks.push({ kind: 'orphanOutput', output: line, at })
			return
		}

		blocks.push({ kind: 'single', line, at })
	})

	return blocks
}

/** Up to `max` lines show whole; beyond that, the first three plus a count of the rest. */
export const foldBody = (
	body: string,
	max = 4,
): { readonly shown: string; readonly hidden: number } => {
	const rows = body.split('\n')
	if (rows.length <= max) return { shown: body, hidden: 0 }
	return { shown: rows.slice(0, 3).join('\n'), hidden: rows.length - 3 }
}

/**
 * `mm:ss` since the run started. `at` is the line's own ISO timestamp; when
 * the host's stream carries none (Claude Code's does not), `fallbackAt` — the
 * arrival time `LogScreen` records as lines come in — stands in for it.
 */
export const elapsedLabel = (
	at: string | null,
	startAt: string,
	fallbackAt?: string | null,
): string => {
	const stamp = at ?? fallbackAt ?? startAt
	const ms = Math.max(0, new Date(stamp).getTime() - new Date(startAt).getTime())
	const totalSeconds = Math.floor(ms / 1000)
	const minutes = Math.floor(totalSeconds / 60)
	const seconds = totalSeconds % 60
	return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/**
 * The EKG trace (ADR 0064), ported 1:1 from `docs/design/watch-the-run.html`.
 * Each beat is an explicit PQRST polyline, `[offsetMs, heightFraction]` pairs
 * from a beat's own centre, drawn at a fixed `x` that only translates as time
 * passes — never resampled per pixel, so a vertical stroke never wobbles.
 */
export type Random = () => number

export type EkgBeat = {
	readonly time: number
	readonly amp: number
	readonly shape: readonly (readonly [number, number])[]
}

export const EKG_W = 90
export const EKG_H = 18
export const EKG_BASELINE = EKG_H / 2
export const EKG_WINDOW_MS = 3000

export const EKG_SHAPE_REGULAR: readonly (readonly [number, number])[] = [
	[-320, 0],
	[-260, 0.15],
	[-200, 0],
	[-60, 0],
	[-40, -0.15],
	[0, 1],
	[40, -0.35],
	[90, 0],
	[220, 0.25],
	[320, 0],
]

export const EKG_SHAPE_DOUBLE: readonly (readonly [number, number])[] = [
	...EKG_SHAPE_REGULAR.slice(0, -1),
	[370, 0.12],
	[420, 0],
]

export const EKG_SHAPE_LOG: readonly (readonly [number, number])[] = [
	[-220, 0],
	[-180, 0.18],
	[-140, 0],
	[-40, 0],
	[-25, -0.25],
	[0, 1.4],
	[25, -0.5],
	[60, 0],
	[160, 0.3],
	[240, 0],
]

/**
 * Regular beats every 0.9-1.5s, amplitude 4.5 ±25%, about 1 in 6 a double
 * bump. `random` is injected so the schedule is deterministic under test.
 */
export const scheduleBeats = (
	queue: readonly EkgBeat[],
	nextAt: number | null,
	now: number,
	random: Random,
): { readonly queue: readonly EkgBeat[]; readonly nextAt: number } => {
	let beats = queue
	let at = nextAt ?? now
	while (at < now + EKG_WINDOW_MS) {
		const amp = 4.5 * (0.75 + random() * 0.5)
		const shape = random() < 1 / 6 ? EKG_SHAPE_DOUBLE : EKG_SHAPE_REGULAR
		beats = [...beats, { time: at, amp, shape }]
		at += 900 + random() * 600
	}
	return { queue: beats.filter((beat) => now - beat.time < EKG_WINDOW_MS + 500), nextAt: at }
}

/**
 * A log line's own beat: a taller spike than the regular rhythm. It drops
 * every beat whose real span overlaps the spike, so beats never overlap, and
 * restarts the regular rhythm 0.9-1.5s later.
 */
export const spike = (
	queue: readonly EkgBeat[],
	now: number,
	random: Random,
): { readonly queue: readonly EkgBeat[]; readonly nextAt: number } => {
	const spikeStart = EKG_SHAPE_LOG[0]?.[0] ?? 0
	const kept = queue.filter((beat) => {
		const last = beat.shape.at(-1)
		return last !== undefined && beat.time + last[0] < now + spikeStart
	})
	return {
		queue: [...kept, { time: now, amp: 5.5, shape: EKG_SHAPE_LOG }],
		nextAt: now + 900 + random() * 600,
	}
}

/**
 * The trace's `d` attribute: every vertex of every beat still in the window,
 * at `x = W - (now - t)/msPerPx + offset/msPerPx`, sorted by `x`. The path
 * starts at `-W` and ends at `2W` on the baseline so it always fills the box.
 */
export const ekgPath = (queue: readonly EkgBeat[], now: number): string => {
	const msPerPx = EKG_WINDOW_MS / EKG_W
	const points: [number, number][] = []
	for (const beat of queue) {
		for (const [offset, height] of beat.shape) {
			const x = EKG_W - (now - beat.time) / msPerPx + offset / msPerPx
			points.push([x, EKG_BASELINE - beat.amp * height])
		}
	}
	points.sort((a, b) => a[0] - b[0])
	let d = `M${(-EKG_W).toFixed(1)} ${EKG_BASELINE}`
	for (const [x, y] of points) d += ` L${x.toFixed(1)} ${y.toFixed(1)}`
	d += ` L${(2 * EKG_W).toFixed(1)} ${EKG_BASELINE}`
	return d
}

/** The static single beat a reduced-motion trace shows, timer still running. */
export const EKG_FLAT = `M0 ${EKG_BASELINE}H${EKG_W}`

/** The mockup's 61 one-word verbs, copied unchanged. */
export const THINKING_VERBS: readonly string[] = [
	'Sobering',
	'Hydrating',
	'Untangling',
	'Noodling',
	'Wrangling',
	'Bamboozling',
	'Kerfuffling',
	'Galumphing',
	'Doodling',
	'Graphing',
	'Edge-herding',
	'Dag-wrangling',
	'Hiccuping',
	'Fermenting',
	'Unknotting',
	'Squinting',
	'Rummaging',
	'Tiptoeing',
	'Befuddling',
	'Moseying',
	'Percolating',
	'Marinating',
	'Spelunking',
	'Bumbling',
	'Ruminating',
	'Cogitating',
	'Meandering',
	'Fidgeting',
	'Puttering',
	'Loitering',
	'Scheming',
	'Pondering',
	'Simmering',
	'Wobbling',
	'Skittering',
	'Fossicking',
	'Nudging',
	'Fiddling',
	'Waffling',
	'Dithering',
	'Sketching',
	'Tinkering',
	'Whittling',
	'Excavating',
	'Deciphering',
	'Foraging',
	'Sniffing',
	'Burrowing',
	'Cranking',
	'Untwisting',
	'Reticulating',
	'Node-nudging',
	'Gremlin-hunting',
	'Backfilling',
	'Overthinking',
	'Recalibrating',
	'Dot-connecting',
	'Loop-de-looping',
	'Semicoloning',
	'Bikeshedding',
	'Yak-shaving',
]

/** The next verb, drawn from all but `prevIndex` — it never repeats. */
export const nextVerb = (prevIndex: number, random: Random): number => {
	const pick = Math.floor(random() * (THINKING_VERBS.length - (prevIndex < 0 ? 0 : 1)))
	return prevIndex >= 0 && pick >= prevIndex ? pick + 1 : pick
}

/** The one live region this screen may have (StatusBar.tsx), named once so a test can find it without repeating the attribute in a `.tsx` file. */
export const LIVE_REGION_SELECTOR = '[aria-live]'

export type ChecklistItem = { readonly label: string; readonly passed: boolean }

/**
 * `check`/`checked` lines pair up in order — the audit awaits one command
 * before starting the next (`packages/core/src/audit.ts`), so they arrive
 * strictly alternating and never interleaved. A `checked` line's text is its
 * `check` line's text plus `(exit N, Ns)` or `(did not run, Ns)`; only
 * `exit 0` passes.
 */
export const buildChecklist = (lines: readonly LogLine[]): readonly ChecklistItem[] => {
	const checks = lines.filter((line) => line.kind === 'check')
	const checkedLines = lines.filter((line) => line.kind === 'checked')
	return checkedLines.map((checked, index) => ({
		label: checks[index]?.text ?? checked.text,
		passed: /\(exit 0,/.test(checked.text),
	}))
}
