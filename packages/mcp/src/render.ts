import type { Board, Review } from '@besober/core'
import { flagsOf, openDecisions, statusOf, unbound } from '@besober/core'
import type { Node } from '@besober/schema'
import { decisionState } from '@besober/schema'

/**
 * What a surface shows is derived here the same way the CLI derives it, from
 * the same `core` functions — the contract that keeps three surfaces from
 * drifting into three products (`PR-09-08`, §4).
 */
export const renderBoard = (board: Board): string => {
	const lines: string[] = []
	if (board.project !== null) {
		lines.push(board.project.title)
		if (board.project.intent !== '') lines.push(board.project.intent)
		lines.push('')
	}

	const ids = [...board.nodes.keys()].sort()
	if (ids.length === 0) {
		lines.push('No nodes yet. Propose some with the `propose` tool.')
	} else {
		lines.push('## Nodes')
		for (const id of ids) {
			const node = board.nodes.get(id)
			const state = statusOf(board, id) ?? 'needs-brief'
			const flags = flagsOf(board, id)
			lines.push(
				`- ${id} [${state}] ${node?.title ?? ''}${who(node)}${flags.lastRunFailed ? ' — the last run failed' : ''}${waiting(board, id)}`,
			)
		}
	}

	const open = openDecisions(board)
	if (open.length > 0) {
		lines.push('', '## Decisions waiting on the human')
		for (const [id, decision] of open)
			lines.push(`- ${id} [${decisionState(decision)}] ${decision.category}: ${decision.question}`)
	}

	const loose = unbound(board)
	if (loose.length > 0) {
		lines.push(
			'',
			'## Bound to nothing',
			`${loose.join(', ')} — each holds no node, so answering it unblocks nothing. Fix it with \`bind\`.`,
		)
	}

	// A board that cannot be read whole is said out loud, never rendered as
	// empty (§8.4) — in a session, the answer is the only place to say it.
	if (board.broken.length > 0) {
		lines.push('', '## Unreadable records')
		for (const broken of board.broken) lines.push(`- ${broken.file}: ${broken.reason}`)
	}
	return lines.join('\n')
}

/** A claim is a fact and an assignment is a plan (§3.3), so they never read the same. */
const who = (node: Node | undefined): string => {
	if (node?.claim != null) return ` — ${node.claim.by} is on it`
	if (node?.assignee != null) return ` — for ${node.assignee}`
	return ''
}

const waiting = (board: Board, id: string): string => {
	const node = board.nodes.get(id)
	if (node === undefined) return ''

	const held = node.decisions
		.filter((decision) => {
			const record = board.decisions.get(decision)
			return record === undefined || decisionState(record) !== 'answered'
		})
		// An archived decision is not in the open list, so a node held by one
		// would otherwise be waiting on something nothing offers to answer.
		.map((decision) =>
			board.archivedDecisions.has(decision) ? `${decision} (archived)` : decision,
		)
	if (held.length > 0) return ` — waiting on ${held.join(', ')}`

	const blocked = node.dependsOn.filter((dep) => board.nodes.get(dep)?.accepted == null)
	return blocked.length > 0 ? ` — waiting on ${blocked.join(', ')}` : ''
}

export const renderDecisions = (board: Board): string => {
	const lines: string[] = []
	for (const [id, decision] of openDecisions(board)) {
		lines.push(`## ${id}  (${decision.category})`, decision.question)
		if (decision.options === null) {
			lines.push('No options yet — produce them with the `open_decision` tool.')
		} else {
			for (const option of decision.options) {
				// The reason and what it costs later are the whole of the education
				// pillar in v1 (ADR 0024), so neither is ever dropped in rendering.
				lines.push(
					`- ${option.id}: ${option.label}`,
					`    because: ${option.reason}`,
					`    later:   ${option.costLater}`,
				)
			}
			if (decision.suggested !== null) lines.push(`Suggested: ${decision.suggested}`)
		}
		lines.push('')
	}
	return lines.length === 0 ? 'Nothing is waiting on you.' : lines.join('\n')
}

/**
 * Review is checks, not reading (ADR 0022): the scan first, the criteria next,
 * the diff last and never beside the findings (§6.2).
 */
export const renderReview = (review: Review, showDiff: boolean): string => {
	const scan = review.scan
	const lines = [
		`# ${review.node}  (last run: ${review.exit ?? 'not run'})`,
		'',
		`## Scan: ${scan.result === 'clean' ? 'clean' : scan.result === 'findings' ? `${scan.findings.length} finding(s)` : 'DID NOT RUN'}`,
		`rules: ${scan.ruleSet}   files: ${review.files.length}`,
	]
	if (review.uncommitted.length > 0)
		lines.push(
			'',
			`**${review.uncommitted.length} file(s) in the worktree were never committed**, so nothing below sees them: ${review.uncommitted.join(', ')}.`,
			'A review reads the diff against the base, and an uncommitted file is not in it. Say this to the user rather than reporting the node as empty.',
		)

	// A scanner that could not run is never reported as clean (ADR 0011).
	for (const missing of scan.didNotRun) lines.push(`! ${missing}`)
	for (const finding of scan.findings)
		lines.push(
			`- ${finding.signal}  ${finding.file}${finding.line === null ? '' : `:${finding.line}`}  ${finding.message}`,
		)
	if (scan.findings.length === 0 && scan.didNotRun.length === 0) lines.push('nothing to look at')

	if (review.acceptance.length > 0) {
		lines.push('', '## What must be true when this is done')
		for (const criterion of review.acceptance)
			lines.push(`- ${criterion.proves}  —  \`${criterion.run}\``)
	}

	lines.push('', '## Files', ...review.files.map((file) => `- ${file}`))
	lines.push(
		'',
		showDiff
			? `## Diff\n\n${review.diff}`
			: `The diff is ${review.diff.split('\n').length} lines. Ask for it with diff: true.`,
	)
	return lines.join('\n')
}
