import { readFile } from 'node:fs/promises'
import {
	answerDecision,
	approveBrief,
	bind as bindEdges,
	dispatch,
	dispatchWave,
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
}

export const brief = async (node: string, write?: string): Promise<void> => {
	const paths = await openBoard()

	if (write !== undefined) {
		// An agent in a host with no MCP server writes a brief through here
		// (`PR-00-08`): the approach and the acceptance list, as JSON.
		const source = write === '-' ? await stdin() : await readFile(write, 'utf8')
		const parsed = Brief.omit({ approval: true }).safeParse(JSON.parse(source))
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

export const approve = async (node: string, queue: boolean): Promise<void> => {
	const paths = await openBoard()
	try {
		await approveBrief(paths, node, { by: await whoami(paths.root), queue })
	} catch (error) {
		refuse(error)
	}
	say(
		queue
			? `${green('✓')} ${cyan(node)} is approved and will start when it is ready`
			: `${green('✓')} ${cyan(node)} is approved. Start it with \`sober run ${node}\`.`,
	)
}

/**
 * Dispatch, with the tail of the agent's output as it arrives (`PR-05-09`).
 * Read-only: watching a run is not steering it.
 */
export const run = async (nodes: readonly string[], base?: string): Promise<void> => {
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
	if (nodes.length > 1) return wave(paths, nodes, ref)

	for (const node of nodes) {
		say(`${cyan(bold(node))} ${dim(`on ${ref}`)}`)
		const spin = spinner(node)
		try {
			const result = await dispatch(paths, node, {
				base: ref,
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
			refuse(error)
		}
	}
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
): Promise<void> => {
	say(dim(`${nodes.length} nodes on ${base}, up to the concurrency limit`))
	// A wave has no tail — two outputs interleave into noise — so the spinner is
	// the only thing between the first line and the last.
	const spin = spinner(`${nodes.length} nodes`)
	const results = await dispatchWave(
		paths,
		nodes.map((node) => ({ node, options: { base } })),
		base,
	).finally(() => spin.stop())

	for (const [index, result] of results.entries()) {
		const node = nodes[index] ?? ''
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

/** `-` is the pipe an agent uses: `… | sober brief <node> --write -`. */
const stdin = async (): Promise<string> => {
	const chunks: Buffer[] = []
	for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
	return Buffer.concat(chunks).toString('utf8')
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
