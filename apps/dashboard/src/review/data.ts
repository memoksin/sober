import type { Checks, CriterionResult, Review } from '@besober/schema'

/**
 * How loudly a line reads. Four, because "could not be read" needs a weight of
 * its own: rendered as neutral it becomes a pass, and rendered as a failure it
 * becomes a bug report against a thing that never ran.
 */
export type Tone = 'clean' | 'warn' | 'alarm' | 'done'

export interface Verdict {
	readonly tone: Tone
	/** The scan, in one line, at the top of the screen. */
	readonly headline: string
	/** Everything the scan result does not say and a diff cannot show. */
	readonly warnings: readonly string[]
	/** Whether there is an answer to give: accept, or turn down. */
	readonly decidable: boolean
}

/**
 * What the review screen leads with (ADR 0022: review is checks, not reading).
 *
 * Every branch here is a defect an earlier gate found by hand. A scan that did
 * not run rendered as a clean one; work written into the worktree and never
 * committed rendered as work that was never done; a node already accepted
 * offered a second accept that had no branch left to merge.
 */
export const verdict = (review: Review): Verdict => {
	const warnings: string[] = []

	if (review.uncommitted.length > 0)
		warnings.push(
			`${review.uncommitted.length} file(s) in the worktree were never committed — nothing below sees them: ${review.uncommitted.join(', ')}`,
		)

	// A scanner that could not run does not disappear (PR-09-06). It carries the
	// weight of a finding rather than a line in a log nobody opens.
	for (const missing of review.scan.didNotRun) warnings.push(`${missing} did not run`)

	if (review.accepted !== null)
		return {
			tone: 'done',
			headline: `accepted by ${review.accepted.by}, with the scan reading "${review.accepted.scan}"`,
			warnings,
			decidable: false,
		}

	if (review.run === null)
		return {
			tone: 'warn',
			headline: 'this node has not run — there is nothing to review yet',
			warnings,
			decidable: false,
		}

	if (review.scan.result === 'did-not-run')
		return { tone: 'alarm', headline: 'the scan did not run', warnings, decidable: true }

	const found = review.scan.findings.length
	if (review.scan.result === 'findings' || found > 0)
		return {
			tone: 'warn',
			headline: `${found} finding${found === 1 ? '' : 's'}`,
			warnings,
			decidable: true,
		}

	return { tone: 'clean', headline: 'the scan is clean', warnings, decidable: true }
}

/**
 * One acceptance criterion, in the three words it can honestly be in (ADR
 * 0049). A criterion that could not run is not a failure and not a pass: it is
 * the state the whole feature exists to stop rendering as either.
 */
export const criterionLine = (criterion: CriterionResult): Line =>
	criterion.result === null
		? { tone: 'alarm', text: 'did not run' }
		: criterion.result.exit === 0
			? { tone: 'clean', text: 'passed' }
			: { tone: 'warn', text: `failed · exit ${criterion.result.exit}` }

export interface Line {
	readonly tone: Tone
	readonly text: string
}

/**
 * CI, in one line, or nothing when there is no pull request to read it from.
 *
 * `unavailable` is an alarm and never a pass, for the same reason the scan's
 * `did-not-run` is (§6.1, §6.2): a check that did not answer has said nothing,
 * and rendering silence as agreement is the whole defect.
 */
export const ciLine = (ci: Checks): Line | null => {
	switch (ci.kind) {
		case 'none':
			return null
		case 'pending':
			return { tone: 'warn', text: 'CI is still running' }
		case 'passing':
			return { tone: 'clean', text: 'CI passed' }
		case 'failing':
			return { tone: 'alarm', text: `CI failed — ${ci.failed.join(', ')}` }
		case 'unavailable':
			return { tone: 'alarm', text: `CI could not be read — ${ci.reason}` }
	}
}
