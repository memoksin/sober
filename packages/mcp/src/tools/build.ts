import {
	answerRun,
	currentBranch,
	dispatch,
	dispatchWave,
	loadBoard,
	OverlapError,
	readRunOutput,
	SoberError,
	statusOf,
	stopRun,
	tail,
} from '@besober/core'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { askYes } from '../ask.js'
import { openBoard, text, tool } from '../context.js'

/**
 * The confirmation §3.4 asks for, in the shape this surface has for one: the
 * overlap is shown and the human answers. Short on purpose — a host truncates
 * rather than wraps, so the list of ids goes in and the reasoning stays in the
 * conversation (M1's gate, defects 8 and 9).
 */
const anyway = (server: McpServer, nodes: readonly string[]): Promise<boolean> =>
	askYes(
		server.server,
		nodes.length === 1 ? `Start ${nodes[0]} anyway?` : `Start ${nodes.length} nodes anyway?`,
		`${nodes.join(', ')} ${nodes.length === 1 ? 'is' : 'are'} heading for files another active node is heading for. Two nodes on one file is one merge, done twice.`,
		'Yes, start them anyway',
	)

/**
 * Dispatch from the session that planned the work (§4). It is the same
 * `core` call the CLI makes, so a run started here is indistinguishable from
 * one started there — including the brief it is handed, which is built in one
 * place for exactly that reason (§3.7).
 */
export const registerBuilding = (server: McpServer, cwd: string): void => {
	server.registerTool(
		'run',
		{
			title: 'Start the agent on a node',
			description:
				'Cut the node’s worktree, prepare it, and run the host on the brief. This blocks until the run ends, which can be minutes — for a long one, tell the human they can watch it with `sober logs`. Several nodes run as a wave, up to the configured concurrency.',
			inputSchema: {
				nodes: z.array(z.string()).min(1),
				base: z.string().nullish().describe('the ref to cut from; the current branch by default'),
			},
		},
		tool(
			async (
				{ nodes, base }: { nodes: string[]; base?: string | null },
				extra: { sendNotification?: unknown; _meta?: { progressToken?: string | number } },
			) => {
				const paths = await openBoard(cwd)
				const ref = base ?? (await currentBranch(paths.root))
				const board = await loadBoard(paths)

				for (const node of nodes) {
					const state = statusOf(board, node)
					if (state === null) return text(`${node} is not on this board.`)
					// Run is available only on a ready node with an approved brief;
					// otherwise it says why (`PR-05-01`).
					if (state !== 'ready')
						return text(
							`${node} is ${state}, so it cannot start. The board says what it is waiting for.`,
						)
				}

				if (nodes.length > 1) {
					const results = [
						...(await dispatchWave(
							paths,
							nodes.map((node) => ({ node, options: { base: ref } })),
							ref,
						)),
					]
					// The same-files warning is a question for the human, and this
					// surface can actually ask one (§3.4). One question for the whole
					// wave: one window per node is how nobody reads any of them.
					const met = results
						.map((result, index) => (result instanceof OverlapError ? nodes[index] : null))
						.filter((node): node is string => node !== null)
					if (met.length > 0 && (await anyway(server, met)))
						for (const node of met) {
							const at = nodes.indexOf(node)
							results[at] = await dispatch(paths, node, { base: ref, anyway: true }).catch(
								(error: SoberError) => error,
							)
						}

					const lines = results.map((result, index) =>
						result instanceof SoberError
							? `${nodes[index]}: ${result.message}`
							: `${nodes[index]}: ${result.exit}${result.error === null ? '' : ` — ${result.error}`}`,
					)
					if (results.length < nodes.length)
						lines.push(
							'The rest of the wave was not started: nothing is built on a result you have not seen.',
						)
					return text(lines.join('\n'))
				}

				const node = nodes[0] as string
				const go = (confirmed: boolean) =>
					dispatch(paths, node, {
						base: ref,
						anyway: confirmed,
						// The progress notification is what keeps a run of several
						// minutes from timing out in the host, and it is also the only
						// thing the human sees while it works.
						onLine: (line) => {
							const [rendered] = tail(line)
							if (rendered === undefined) return
							void notify(extra, `${rendered.kind}: ${rendered.text}`)
						},
					})

				const result = await go(false).catch(async (error: unknown) => {
					if (!(error instanceof OverlapError)) throw error
					if (!(await anyway(server, [node]))) return null
					return go(true)
				})
				if (result === null)
					return text(`${node} was not started. Nothing was cut and nothing was spent.`)
				return text(
					result.exit === 'finished'
						? `${node} finished. Review it with the \`review\` tool before anything else.`
						: `${node} ${result.exit}${result.error === null ? '' : `: ${result.error}`}. The worktree is untouched.`,
				)
			},
		),
	)

	server.registerTool(
		'stop',
		{
			title: 'Stop a running node',
			description: 'Stop the agent. The worktree and everything written in it stay as they are.',
			inputSchema: { node: z.string() },
		},
		tool(async ({ node }: { node: string }) => {
			const paths = await openBoard(cwd)
			const board = await loadBoard(paths)
			const live = [...board.runs].find(
				([id, record]) => (record.node === node || id === node) && record.exit === null,
			)
			if (live === undefined) return text(`Nothing is running for ${node}.`)
			const stopped = await stopRun(paths, live[0])
			return text(
				stopped
					? `${node} was stopped. Its worktree is untouched; run it again when you are ready.`
					: `${live[0]} had already ended.`,
			)
		}),
	)

	server.registerTool(
		'answer',
		{
			title: 'Answer a run somebody is watching',
			description:
				'Reply to a node dispatched with watching on. Set done when there is nothing left to say, which lets the session finish instead of waiting.',
			inputSchema: { node: z.string(), text: z.string(), done: z.boolean().optional() },
		},
		tool(async ({ node, text: said, done }: { node: string; text: string; done?: boolean }) => {
			const paths = await openBoard(cwd)
			const { run } = await answerRun(paths, node, said, { done })
			return text(
				done === true
					? `Told ${node}, and let the session finish. Its output is in run ${run}.`
					: `Told ${node}. The \`logs\` tool is what it says back.`,
			)
		}),
	)

	server.registerTool(
		'logs',
		{
			title: 'What the agent said',
			description: 'The last run’s output for a node, rendered line by line.',
			inputSchema: { node: z.string() },
		},
		tool(async ({ node }: { node: string }) => {
			const paths = await openBoard(cwd)
			const board = await loadBoard(paths)
			const last = [...board.runs].filter(([, record]) => record.node === node).at(-1)
			if (last === undefined) return text(`${node} has not run yet.`)
			const output = await readRunOutput(paths, last[0])
			const lines = tail(output).map((line) => `${line.kind}: ${line.text}`)
			return text(lines.length === 0 ? 'The run wrote nothing.' : lines.join('\n'))
		}),
	)
}

interface Progress {
	sendNotification?: unknown
	_meta?: { progressToken?: string | number }
}

const notify = async (extra: Progress, message: string): Promise<void> => {
	const token = extra._meta?.progressToken
	const send = extra.sendNotification
	if (token === undefined || typeof send !== 'function') return
	await (send as (notification: unknown) => Promise<void>)({
		method: 'notifications/progress',
		params: { progressToken: token, progress: 0, message },
	}).catch(() => undefined)
}
