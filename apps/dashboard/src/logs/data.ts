import type { LogLine } from '@besober/schema'

/**
 * What each kind of line looks like, beside the component for the reason
 * `panel/data.ts` gives: a fact about how a log reads is testable without a
 * screen, and a fact rendered by one screen is a fact nobody can check.
 *
 * The marks are the CLI's, deliberately. `sober logs` and this screen show the
 * same run, and two vocabularies for one thing is how a person ends up unsure
 * whether they are looking at the same output.
 */
export const MARK: Readonly<Record<LogLine['kind'], string>> = {
	started: '▸',
	text: '·',
	tool: '⚒',
	result: '■',
	raw: '!',
	// What the human said back, echoed into the log by the host. It points the
	// other way because it is the one line that came from this side.
	answer: '›',
}

export const TONE: Readonly<Record<LogLine['kind'], string>> = {
	started: 'var(--ink-faint)',
	text: 'var(--ink-faint)',
	tool: 'var(--status-ready)',
	result: 'var(--ink)',
	// The host's own stderr. It is the one thing a failing run always has, so
	// it is the one thing that must not read like ordinary output.
	raw: 'var(--danger)',
	answer: 'var(--status-in-review)',
}

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
