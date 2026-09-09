import {
	answerDecision,
	answerRun,
	approveBrief,
	bind as bindEdges,
	dispatch,
	dispatchWave,
	editDecision,
	flagsOf,
	ImpactError,
	OverlapError,
	openDecisions,
	type Published,
	readRunOutput,
	renderBrief,
	SoberError,
	statusOf,
	stopRun,
	tail,
	whoami,
	writeBrief,
} from '@besober/core'
import { Brief } from '@besober/schema'
import { baseOf, openBoard, readBoard } from './board.js'
import { source } from './input.js'
import {
	blue,
	bold,
	cyan,
	dim,
	fail,
	green,
	magenta,
	red,
	refuse,
	say,
	spinner,
	yellow,
} from './out.js'
import { drain } from './queue.js'
import { warn } from './team.js'

/**
 * A tool call, a sentence and an ending do not read alike, so they do not look
 * alike. A mark rather than the word: the word `tool` beside every tool name is
 * eight columns saying what the colour already said.
 */
const TAIL: Record<string, readonly [string, (text: string) => string] | undefined> = {
	started: ['◌', dim],
	tool: ['▸', blue],
	text: ['│', dim],
	result: ['✓', green],
	raw: ['!', red],
}

const mark = (kind: string): string => {
	const [glyph, colour] = TAIL[kind] ?? ['·', dim]
	return colour(glyph)
}

export const decisions = async (): Promise<void> => {
	const paths = await openBoard()
	const board = await readBoard(paths)

	for (const [id, decision] of openDecisions(board)) {
		say(`${magenta(bold(id))}  ${dim(decision.category)}`)
		say(`  ${decision.question}`)
		if (decision.options === null) {
			say(dim('  options have not been produced yet — open it in a session'))
		} else {
			for (const option of decision.options) {
				say(`  ${cyan(bold(option.id))}  ${option.label}`)
				// The reason and what it costs later are the education pillar in
				// v1 (ADR 0024). Two colours, because they are two questions.
				say(`      ${green('because')} ${dim(option.reason)}`)
				say(`      ${yellow('later')}   ${dim(option.costLater)}`)
			}
			say(dim(`  answer it with: sober decide ${id} <option>`))
		}
		say()
	}
}

/**
 * §2.8's edit, in ADR 0032's shape rather than a second one: the first command
 * prints what the change reaches and writes nothing, and `--anyway` on the
 * second is the confirmation. One confirmation vocabulary — `run` already asks
 * this way, and a second spelling is how one surface becomes two.
 *
 * There is no `drain` after it. Answering a decision makes nodes ready, so
 * `decide` reads the queue; changing an answer takes briefs away, and a run
 * started by the command that just invalidated its brief is the automatic
 * consequence §7.2 refuses.
 */
export const edit = async (
	id: string,
	option: string,
	why: string | undefined,
	anyway: boolean,
): Promise<void> => {
	const paths = await openBoard()
	try {
		const decision = await editDecision(paths, id, {
			option,
			rationale: why ?? '',
			by: await whoami(paths.root),
			anyway,
		})
		say(`${green('✓')} ${magenta(id)}: ${bold(decision.answer?.option ?? '')}`)

		// What it did, read back off the board rather than reported from memory —
		// the same shape `decide` uses to say which nodes moved.
		const board = await readBoard(paths)
		const bound = [...board.nodes.keys()].filter((node) =>
			board.nodes.get(node)?.decisions.includes(id),
		)
		const briefs = bound.filter((node) => statusOf(board, node) === 'needs-brief')
		const flagged = bound.filter((node) => flagsOf(board, node).flagged)
		if (briefs.length > 0)
			say(`  ${briefs.map((node) => cyan(node)).join(', ')} ${dim('need briefs again')}`)
		if (flagged.length > 0)
			say(
				`  ${flagged.map((node) => cyan(node)).join(', ')} ${dim('flagged — nothing was stopped')}`,
			)
	} catch (error) {
		if (error instanceof ImpactError) return reaches(error, option)
		refuse(error)
	}
}

/**
 * The fan-out, before it happens. Every node is named with the status it is in,
 * because §2.8 counts running nodes precisely so a person can stop one that is
 * building against the answer they are about to change.
 */
const reaches = (error: ImpactError, option: string): void => {
	const { impact } = error
	say(`${yellow('·')} ${magenta(impact.decision)} was not changed — nothing was written`)
	say()
	if (impact.nodes.length === 0) {
		say(dim('  No node was built against it yet, so the change costs nothing.'))
	} else {
		for (const one of impact.nodes)
			say(
				`  ${cyan(one.id)} ${dim(one.status)}  ${
					one.effect === 'rebrief' ? dim('loses its brief') : yellow('flagged, and left alone')
				}`,
			)
	}
	say()
	say(dim(`  Change it anyway if you meant to:  sober edit ${impact.decision} ${option} --anyway`))
	process.exitCode = 1
}

export const decide = async (id: string, option: string, why?: string): Promise<void> => {
	const paths = await openBoard()
	try {
		const decision = await answerDecision(paths, id, {
			option,
			rationale: why ?? '',
			by: await whoami(paths.root),
		})
		say(`${green('✓')} ${magenta(id)}: ${bold(decision.answer?.option ?? '')}`)

		// Answering unblocks every node bound by it, with no further action
		// (`PR-03-10`) — so say which ones moved.
		const board = await readBoard(paths)
		const freed = [...board.nodes.keys()].filter(
			(node) => board.nodes.get(node)?.decisions.includes(id) && statusOf(board, node) !== 'held',
		)
		if (freed.length > 0)
			say(`  ${freed.map((node) => cyan(node)).join(', ')} ${dim('no longer waiting on it')}`)
	} catch (error) {
		refuse(error)
	}
	// The other thing that makes a node ready, and so the other place the queue
	// is read (D26).
	await drain(paths, await baseOf(paths))
}

export const brief = async (node: string, write?: string): Promise<void> => {
	const paths = await openBoard()

	if (write !== undefined) {
		// An agent in a host with no MCP server writes a brief through here
		// (`PR-00-08`): the approach and the acceptance list, as JSON.
		const text = await source(write)
		const parsed = Brief.omit({ approval: true }).safeParse(JSON.parse(text))
		if (!parsed.success)
			return fail(`that is not a brief: ${parsed.error.issues[0]?.message ?? 'unreadable'}`)
		try {
			await writeBrief(paths, node, parsed.data)
		} catch (error) {
			refuse(error)
		}
		say(`${green('✓')} ${cyan(node)} has a brief. Read it with \`sober brief ${node}\`.`)
		return
	}

	const board = await readBoard(paths)
	const rendered = renderBrief(board, node)
	if (rendered === null) return fail(`${node} is not on this board`)
	// It is markdown; on a terminal that can, the headings carry the structure.
	say(
		rendered
			.split('\n')
			.map((line) => (line.startsWith('#') ? bold(line) : line))
			.join('\n'),
	)

	const approval = board.nodes.get(node)?.brief?.approval
	say(
		approval === undefined || approval === null
			? dim(`Not approved. Approve it with: sober approve ${node}`)
			: dim(`Approved by ${approval.by}${approval.queue ? ', and queued' : ''}.`),
	)
}

export const approve = async (node: string, queue: boolean | undefined): Promise<void> => {
	const paths = await openBoard()
	// Without `--queue` the board's default decides (ADR 0056), so what was
	// recorded is read back off the record rather than guessed from the flag.
	let queued = false
	try {
		const record = await approveBrief(paths, node, { by: await whoami(paths.root), queue })
		queued = record.brief?.approval?.queue === true
	} catch (error) {
		refuse(error)
	}
	say(
		queued
			? `${green('✓')} ${cyan(node)} is approved and will start when it is ready`
			: `${green('✓')} ${cyan(node)} is approved. Start it with \`sober run ${node}\`.`,
	)
}

/**
 * Dispatch, with the tail of the agent's output as it arrives (`PR-05-09`).
 * Read-only: watching a run is not steering it.
 */
export const run = async (
	nodes: readonly string[],
	base?: string,
	anyway = false,
	watch = false,
): Promise<void> => {
	const paths = await openBoard()
	const ref = await baseOf(paths, base)
	const board = await readBoard(paths)

	for (const node of nodes) {
		const state = statusOf(board, node)
		if (state === null) return fail(`${node} is not on this board`)
		// The Run action is available only on a ready node with an approved
		// brief; otherwise it says why (`PR-05-01`).
		if (state !== 'ready')
			return fail(
				`${node} is ${state}, so it cannot start — \`sober status ${node}\` says what it is waiting for`,
			)
	}

	// Several nodes are a wave: they run to `dispatch.concurrency` and the chain
	// stops at the first that does not finish (§5.3, `PR-05-08`). One node keeps
	// the live tail, because with two the two outputs interleave into noise.
	if (nodes.length > 1) {
		// A wave is never attended. Its members run to `dispatch.concurrency` and
		// there is one terminal between them: an agent asking a question it cannot
		// be answered is the M2 gate's finding 1 with more processes.
		if (watch) return fail('`--watch` takes one node — a wave has nobody to answer it')
		return wave(paths, nodes, ref, anyway)
	}

	for (const node of nodes) {
		say(`${cyan(bold(node))} ${dim(`on ${ref}`)}`)
		const spin = spinner(node)
		try {
			const result = await dispatch(paths, node, {
				base: ref,
				anyway,
				attended: watch,
				onLine: (line) => {
					const [rendered] = tail(line)
					if (rendered === undefined) return
					spin.clear()
					say(`  ${mark(rendered.kind)} ${rendered.text}`)
				},
			})
			spin.stop()
			say(
				result.exit === 'finished'
					? `${green('✓')} ${node} finished — review it with \`sober review ${node}\``
					: `${result.exit === 'stopped' ? yellow('·') : red('×')} ${node} ${result.exit}${result.error === null ? '' : `: ${result.error}`}`,
			)
			opened(result.pr)
		} catch (error) {
			spin.stop()
			if (error instanceof OverlapError) return collides(error)
			refuse(error)
		}
	}
}

/**
 * The confirmation §3.4 asks for, on a surface that never prompts: the overlap
 * is shown, and the human answers by running the command again. Nothing is
 * blocked — the second command is the confirmation, not an appeal.
 */
const collides = (error: OverlapError): void => {
	warn(error.overlaps, false)
	say()
	say(`${yellow('·')} ${cyan(error.node)} was not started — nothing was cut and nothing was spent`)
	say(dim(`  Start it anyway if you meant to:  sober run ${error.node} --anyway`))
	process.exitCode = 1
}

/**
 * The pull request is a mechanism, not a surface (§6.1) — so it is one line,
 * and a step that did not happen says why rather than passing in silence.
 */
const opened = (pr: Published | null): void => {
	if (pr === null) return
	if (pr.kind === 'skipped') {
		say(dim(`  no pull request: ${pr.reason}`))
		return
	}
	say(dim(`  draft #${pr.pr.number} ${pr.kind === 'opened' ? 'opened' : 'updated'} — ${pr.pr.url}`))
}

const wave = async (
	paths: Awaited<ReturnType<typeof openBoard>>,
	nodes: readonly string[],
	base: string,
	anyway: boolean,
): Promise<void> => {
	say(dim(`${nodes.length} nodes on ${base}, up to the concurrency limit`))
	// A wave has no tail — two outputs interleave into noise — so the spinner is
	// the only thing between the first line and the last.
	const spin = spinner(`${nodes.length} nodes`)
	const results = await dispatchWave(
		paths,
		nodes.map((node) => ({ node, options: { base, anyway } })),
		base,
	).finally(() => spin.stop())

	let refused = 0
	for (const [index, result] of results.entries()) {
		const node = nodes[index] ?? ''
		if (result instanceof OverlapError) {
			refused += 1
			say(`${yellow('·')} ${node} was not started: ${result.message}`)
			continue
		}
		if (result instanceof SoberError) {
			say(`${red('×')} ${node}: ${result.message}`)
			continue
		}
		say(
			result.exit === 'finished'
				? `${green('✓')} ${node} finished`
				: `${red('×')} ${node} ${result.exit}${result.error === null ? '' : `: ${result.error}`}`,
		)
	}
	if (results.length < nodes.length)
		say(
			dim(
				'  the rest of the wave was not started — nothing is built on a result you have not seen',
			),
		)
	if (refused > 0)
		say(dim(`  run the wave again with --anyway to start ${refused === 1 ? 'it' : 'them'} too`))
}

export const stop = async (node: string): Promise<void> => {
	const paths = await openBoard()
	const board = await readBoard(paths)
	const running = [...board.runs].filter(([id, record]) => record.node === node || id === node)
	const live = running.find(([, record]) => record.exit === null)

	if (live === undefined) return fail(`nothing is running for ${node}`)
	const stopped = await stopRun(paths, live[0])
	say(
		stopped
			? `${yellow('·')} ${node} was stopped. Its worktree is untouched; run it again when you are ready.`
			: `${yellow('·')} ${live[0]} had already ended`,
	)
}

export const logs = async (node: string): Promise<void> => {
	const paths = await openBoard()
	const board = await readBoard(paths)
	const runs = [...board.runs].filter(([, record]) => record.node === node)
	const last = runs.at(-1)
	if (last === undefined) return fail(`${node} has not run yet`)

	const text = await readRunOutput(paths, last[0])
	say(
		tail(text)
			.map((line) => `  ${mark(line.kind)} ${line.text}`)
			.join('\n'),
	)
}

/**
 * Answering a run somebody is watching (ADR 0046). Usually a second terminal:
 * `sober run <node> --watch` holds the first one, so this is how the answer
 * gets in — and it is the same path the dashboard's reply takes, because
 * `answerRun` writes to a file rather than to a process it does not own.
 */
export const answer = async (node: string, text: string, done = false): Promise<void> => {
	const paths = await openBoard()
	try {
		await answerRun(paths, node, text, { done })
		say(
			done
				? `${green('✓')} told ${cyan(node)}, and let the session finish`
				: `${green('✓')} told ${cyan(node)} — \`sober logs ${node}\` is what it says back`,
		)
	} catch (error) {
		refuse(error)
	}
}

/**
 * The edge correction §2.3 always claimed was supported. The lists replace what
 * was there, which is what makes removing a wrong edge possible at all.
 */
export const bind = async (node: string, decisions?: string, dependsOn?: string): Promise<void> => {
	const paths = await openBoard()
	const list = (value?: string) =>
		value === undefined
			? undefined
			: value
					.split(',')
					.map((one) => one.trim())
					.filter(Boolean)
	try {
		const updated = await bindEdges(paths, node, {
			decisions: list(decisions),
			dependsOn: list(dependsOn),
		})
		say(`${green('✓')} ${cyan(node)}`)
		say(`  ${magenta('binds')}    ${updated.decisions.join(', ') || dim('no decision')}`)
		say(`  ${cyan('depends')}  ${updated.dependsOn.join(', ') || dim('nothing')}`)
	} catch (error) {
		refuse(error)
	}
}
