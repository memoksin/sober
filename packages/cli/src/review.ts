import {
	acceptWork,
	archiveDecision,
	archiveNode,
	rejectWork,
	reviewNode,
	whoami,
} from '@besober/core'
import { baseOf, openBoard, readBoard } from './board.js'
import { blue, bold, columns, cyan, dim, fail, green, red, refuse, say, yellow } from './out.js'

/**
 * Review is checks, not reading (ADR 0022). The scan sits above the diff and
 * the acceptance list sits with it; the diff is last, because a reviewer who
 * has to read every line to find the problem is doing the scan's job by hand.
 */
export const review = async (node: string, base?: string, showDiff = false): Promise<void> => {
	const paths = await openBoard()
	const ref = await baseOf(paths, base)
	const found = await reviewNode(paths, node, ref).catch(refuse)
	if (found === null) return fail(`${node} is not on this board`)

	const scan = found.scan
	const head =
		scan.result === 'clean'
			? green('clean')
			: scan.result === 'findings'
				? yellow(`${scan.findings.length} finding${scan.findings.length === 1 ? '' : 's'}`)
				: red('the scan did not run')

	say(`${cyan(bold(node))}  ${dim(found.exit ?? 'not run')}`)
	say()
	say(`  ${head}   ${dim(`·  rules: ${scan.ruleSet}  ·  ${found.files.length} file(s)`)}`)
	say()
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

	say()
	say(columns(found.files.map((file) => [`  ${blue(file)}`])).join('\n'))
	if (showDiff) {
		say()
		say(found.diff)
	} else {
		say()
		say(
			dim(
				`  the diff is ${found.diff.split('\n').length} lines — see it with \`sober review ${node} --diff\``,
			),
		)
	}
	say()
	say(dim(`  sober accept ${node}   ·   sober reject ${node} -m "what was wrong"`))
}

export const accept = async (node: string, base?: string): Promise<void> => {
	const paths = await openBoard()
	const ref = await baseOf(paths, base)
	const found = await reviewNode(paths, node, ref).catch(refuse)
	if (found === null) return fail(`${node} is not on this board`)

	try {
		const merged = await acceptWork(paths, node, {
			by: await whoami(paths.root),
			base: ref,
			scan: found.scan.result,
		})
		say(
			`${green('✓')} ${node} is done — merged into ${merged.base} as ${merged.commit.slice(0, 8)}`,
		)
		if (found.scan.result !== 'clean')
			say(dim(`  recorded as accepted with the scan reading "${found.scan.result}"`))
	} catch (error) {
		refuse(error)
	}

	const board = await readBoard(paths)
	const freed = [...board.nodes].filter(([, record]) => record.dependsOn.includes(node))
	if (freed.length > 0)
		say(`  ${dim(freed.map(([id]) => cyan(id)).join(', '))} ${dim('can move now')}`)
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
