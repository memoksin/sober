import type { Accepted, ScanResult } from './node.js'

/**
 * The six named signals of ADR 0011, as a vocabulary. The rules that look for
 * them read added lines and live in `core`; the list of what they are named is
 * shared, the way `STATUSES` and `SCAN_RESULTS` are — every surface that
 * renders a finding has to know the same six words.
 */
export const SIGNALS = [
	'dependency-added',
	'undeclared-file',
	'dynamic-code',
	'shell-from-variable',
	'tls-disabled',
	'hardcoded-address',
] as const

export type Signal = (typeof SIGNALS)[number]

export interface Finding {
	readonly signal: Signal | 'secret' | 'extra'
	readonly file: string
	readonly line: number | null
	readonly message: string
}

export interface ScanReport {
	/** What goes into the `accepted` record, so a scan that did not run is on it. */
	readonly result: ScanResult
	/** Which rule set ran, named — it can differ per project (ADR 0011). */
	readonly ruleSet: string
	readonly findings: readonly Finding[]
	/**
	 * A scanner that could not run does not disappear (`PR-09-06`). It renders
	 * with the weight of a finding, which is why it is a field of its own rather
	 * than a log line nobody reads.
	 */
	readonly didNotRun: readonly string[]
	readonly files: readonly string[]
}

export interface PullRequest {
	readonly number: number
	readonly url: string
	/** A draft asks nobody to review anything — which is why it is the default (§6.1). */
	readonly draft: boolean
	readonly branch: string
}

/** CI, when there is any. "Unavailable" is not "passing", for the scan's reason (§6.2). */
export type Checks =
	| { readonly kind: 'none' }
	| { readonly kind: 'pending' }
	| { readonly kind: 'passing' }
	| { readonly kind: 'failing'; readonly failed: readonly string[] }
	| { readonly kind: 'unavailable'; readonly reason: string }

/**
 * Review is checks, not reading (ADR 0022): what a surface shows is the scan,
 * the acceptance results and the diff — in that order, findings above the diff
 * and never beside it (§6.2).
 *
 * The shape is here rather than in `core` because three surfaces render it and
 * one of them is a browser, which cannot import `core` (ADR 0008). A hand-copied
 * interface in the dashboard would let the promise that no surface can render a
 * review the others cannot come quietly untrue.
 */
export interface Review {
	readonly node: string
	readonly scan: ScanReport
	readonly diff: string
	readonly files: readonly string[]
	/** The run being reviewed, or null when nothing has run yet. */
	readonly run: string | null
	readonly exit: string | null
	readonly acceptance: readonly { readonly run: string; readonly proves: string }[]
	/** CI, when there is a pull request to read it from (§6.1). */
	readonly ci: Checks
	/** The node's draft pull request, when one was opened. */
	readonly pr: PullRequest | null
	/**
	 * Work sitting in the worktree that was never committed. A diff against the
	 * base cannot see it, so without this a review of an agent that wrote
	 * everything and committed nothing reads exactly like a review of an agent
	 * that did nothing (found in the M1 gate).
	 */
	readonly uncommitted: readonly string[]
	/**
	 * Set once the node is done. A review of accepted work is a record of what
	 * was accepted, not a decision waiting to be made — found in M2's gate, where
	 * a node accepted from a session still read as reviewable in the terminal and
	 * offered an accept that then had no branch to merge.
	 */
	readonly accepted: Accepted | null
}
