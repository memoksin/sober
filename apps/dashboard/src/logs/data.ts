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

/** The host line, what chose it and the fallback, as the run record wrote them (ADR 0058, 0061). */
export const ranWith = ({ host, tier, fallback }: NonNullable<LogWindow['ran']>): string =>
	`Ran \`${host}\` — ${ranLabel({ tier, fallback })}`
