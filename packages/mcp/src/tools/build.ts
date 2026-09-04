import {
	currentBranch,
	dispatch,
	dispatchWave,
	loadBoard,
	readRunOutput,
	SoberError,
	statusOf,
	stopRun,
	tail,
} from '@besober/core'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { openBoard, text, tool } from '../context.js'

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
					const results = await dispatchWave(
						paths,
						nodes.map((node) => ({ node, options: { base: ref } })),
						ref,
					)
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
				const result = await dispatch(paths, node, {
					base: ref,
					// The progress notification is what keeps a run of several minutes
					// from timing out in the host, and it is also the only thing the
					// human sees while it works.
					onLine: (line) => {
						const [rendered] = tail(line)
						if (rendered === undefined) return
						void notify(extra, `${rendered.kind}: ${rendered.text}`)
					},
				})
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
