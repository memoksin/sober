import type { Paths } from '@besober/core'
import {
	acceptWork,
	archiveDecision,
	archiveNode,
	greenNodes,
	type Landed,
	type Review,
	rejectWork,
	reviewNode,
	whoami,
} from '@besober/core'
import { baseOf, openBoard, readBoard } from './board.js'
import { blue, bold, columns, cyan, dim, fail, green, red, refuse, say, yellow } from './out.js'
import { drain } from './queue.js'

/**
 * Review is checks, not reading (ADR 0022). The scan sits above the diff and
 * the acceptance list sits with it; the diff is last, because a reviewer who
 * has to read every line to find the problem is doing the scan's job by hand.
 */
export const review = async (node: string, base?: string, showDiff = false): Promise<void> => {
	const paths = await openBoard()
	const ref = await baseOf(paths, base)
	const found = await reviewNode(paths, node, ref).catch(refuse)
	if (found === null) return missing(paths, node)

	const scan = found.scan
	const head =
		scan.result === 'clean'
			? green('clean')
			: scan.result === 'findings'
				? yellow(`${scan.findings.length} finding${scan.findings.length === 1 ? '' : 's'}`)
				: red('the scan did not run')

	say(`${cyan(bold(node))}  ${dim(found.accepted === null ? (found.exit ?? 'not run') : 'done')}`)
	say()
	say(`  ${head}   ${dim(`·  rules: ${scan.ruleSet}  ·  ${found.files.length} file(s)`)}`)
	say()
	// Not gated on having a pull request: when the host cannot be reached
	// neither can be read, and a line that disappears is the failure §6.2 exists
	// to stop — a check that did not answer is not a check that passed.
	if (found.pr !== null || found.ci.kind !== 'none') {
		const draft = found.pr === null ? '' : dim(`   ·  draft #${found.pr.number}  ${found.pr.url}`)
		say(`  ${ciLine(found.ci)}${draft}`)
		say()
	}
	if (found.uncommitted.length > 0) {
		// Without this line an agent that wrote everything and committed nothing
		// reviews exactly like one that did nothing (found in the M1 gate).
		say(
			`    ${yellow('!')}  ${found.uncommitted.length} file(s) in the worktree were never committed`,
		)
		say(dim(`       ${found.uncommitted.join(', ')}`))
		say(dim('       nothing below sees them — a review reads the diff against the base'))
		say()
	}
	for (const missing of scan.didNotRun) say(`    ${red('!')}  ${missing}`)
	// A leaked key and a changed lockfile are both worth reading; they are
	// not worth the same alarm. The colour says which is which before the
	// sentence does.
	for (const finding of scan.findings)
		say(
			`    ${(finding.signal === 'secret' ? red : yellow)(finding.signal.padEnd(19))} ${blue(`${finding.file}${finding.line === null ? '' : `:${finding.line}`}`)}  ${dim(finding.message)}`,
		)
	if (scan.findings.length === 0 && scan.didNotRun.length === 0) say(dim('    nothing to look at'))

	if (found.acceptance.length > 0) {
		say()
		say(`  ${bold('What must be true when this is done')}`)
		say(
			columns(
				found.acceptance.map((criterion) => [`    ${criterion.proves}`, cyan(criterion.run)]),
			).join('\n'),
		)
	}

	if (found.files.length > 0) {
		say()
		say(columns(found.files.map((file) => [`  ${blue(file)}`])).join('\n'))
	}
	// An empty diff is zero lines, never one. `''.split('\n')` is `['']`, and the
	// case is ordinary: accept deletes the branch, so every review after one has
	// nothing left to read.
	if (found.diff !== '') {
		say()
		say(
			showDiff
				? found.diff
				: dim(
						`  the diff is ${found.diff.split('\n').length} lines — see it with \`sober review ${node} --diff\``,
					),
		)
	}
	say()
	say(
		found.accepted === null
			? dim(`  sober accept ${node}   ·   sober reject ${node} -m "what was wrong"`)
			: dim(
					`  accepted by ${found.accepted.by} on ${found.accepted.at.slice(0, 10)}, with the scan reading "${found.accepted.scan}"`,
				),
	)
}

/**
 * A record that will not parse is reported by name (§8.4) — without this, a
 * file with one bad character reads exactly like a node nobody ever wrote, and
 * the message names nothing to fix (§8.7).
 */
const missing = async (paths: Paths, node: string): Promise<void> => {
	await readBoard(paths)
	return fail(`${node} is not on this board`)
}

/**
 * CI when there is any (§6.0). "Could not be read" carries a finding's weight,
 * for the scan's reason: a check that did not answer is not a check that passed.
 */
const ciLine = (ci: Review['ci']): string => {
	switch (ci.kind) {
		case 'passing':
			return green('CI green')
		case 'failing':
			return red(`CI failed — ${ci.failed.join(', ')}`)
		case 'pending':
			return yellow('CI is still running')
		case 'unavailable':
			return red(`CI could not be read — ${ci.reason}`)
		default:
			return dim('no CI on this pull request')
	}
}

export const accept = async (node: string, base?: string): Promise<void> => {
	const paths = await openBoard()
	const ref = await baseOf(paths, base)
	await land(paths, node, ref)
	// Accepting is one of the two things that make a node ready, so it is one of
	// the two places the queue is read (D26).
	await drain(paths, ref)
}

const land = async (paths: Paths, node: string, ref: string): Promise<void> => {
	const found = await reviewNode(paths, node, ref).catch(refuse)
	if (found === null) return missing(paths, node)

	try {
		const landed = await acceptWork(paths, node, {
			by: await whoami(paths.root),
			base: ref,
			scan: found.scan.result,
		})
		say(`${green('✓')} ${node} is done — ${where(landed)}`)
		if (found.scan.result !== 'clean')
			say(dim(`  recorded as accepted with the scan reading "${found.scan.result}"`))
		if (landed.kind === 'merged' && landed.openPr !== null)
			say(
				dim(
					`  draft #${landed.openPr.number} is still open — it closes when you push ${landed.base}`,
				),
			)
	} catch (error) {
		refuse(error)
	}

	const board = await readBoard(paths)
	const freed = [...board.nodes].filter(([, record]) => record.dependsOn.includes(node))
	if (freed.length > 0)
		say(`  ${dim(freed.map(([id]) => cyan(id)).join(', '))} ${dim('can move now')}`)
}

const where = (landed: Landed): string =>
	landed.kind === 'merged'
		? `merged into ${landed.base} as ${landed.commit.slice(0, 8)}`
		: `pull request #${landed.pr.number} was marked ready and merged`

/**
 * Green nodes are accepted together (§6.0). What is not green is listed with
 * the reason, because "seven were accepted" without "and these three were not,
 * for these reasons" is the shape that gets people to stop reading.
 */
export const acceptGreen = async (base?: string): Promise<void> => {
	const paths = await openBoard()
	const ref = await baseOf(paths, base)
	const { green: ready, held } = await greenNodes(paths, ref).catch(refuse)

	if (ready.length === 0 && held.length === 0)
		return say(`${green('✓')} nothing is waiting on a review`)

	for (const node of ready) await land(paths, node, ref)

	if (held.length > 0) {
		say()
		say(`${yellow('·')} ${held.length} node${held.length === 1 ? '' : 's'} not green`)
		say(columns(held.map((one) => [`  ${cyan(one.id)}`, dim(one.why)])).join('\n'))
		say()
		say(dim('  Read one with `sober review <node>`, then accept or reject it.'))
	}
	// Once for the whole batch: seven accepts are one move of the graph.
	await drain(paths, ref)
}

export const reject = async (node: string, text: string, clean: boolean, base?: string) => {
	const paths = await openBoard()
	try {
		await rejectWork(paths, node, {
			by: await whoami(paths.root),
			text,
			clean,
			base: await baseOf(paths, base),
		})
	} catch (error) {
		refuse(error)
	}
	say(`${yellow('·')} ${cyan(node)} is back in the queue. Nothing was deleted.`)
	say(
		dim(
			clean
				? '  the branch was reset to its base, so the next run starts from nothing'
				: '  the next run keeps this attempt’s work and carries your note',
		),
	)
}

export const archive = async (id: string): Promise<void> => {
	const paths = await openBoard()
	const board = await readBoard(paths)
	try {
		if (board.nodes.has(id)) await archiveNode(paths, id)
		else if (board.decisions.has(id)) await archiveDecision(paths, id)
		else return fail(`${id} is not on this board`)
	} catch (error) {
		refuse(error)
	}
	say(`${green('✓')} ${cyan(id)} is archived. Every node that referenced it still reads it.`)
}
