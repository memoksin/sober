import {
	correctNode,
	createNode,
	dismissFlag,
	loadBoard,
	reopenNode,
	unlinked,
	whoami,
} from '@besober/core'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { openBoard, text, tool } from '../context.js'
import { renderUnlinked } from '../render.js'

/**
 * DESIGN §7.2's three actions on a flagged node, in a session. Nothing here
 * runs anything: one decision change can reach thirty nodes, and re-running
 * them unasked is what the impact preview exists to prevent (D37).
 *
 * `open_node` is not `propose`. Propose returns a set of nodes, the edges
 * between them and the decisions each introduces, against the code as it is now
 * — that needs a model, and stays where ADR 0009 put it. This is one node with
 * a title, which is data entry, and it is on every surface for `PR-09-08`'s
 * reason.
 */
export const registerFlags = (server: McpServer, cwd: string): void => {
	server.registerTool(
		'dismiss',
		{
			title: 'Set a node’s flag aside, with the reason',
			description:
				'The bound decision changed and this node is fine anyway. The reason is kept on the node, so a teammate reads the judgement rather than the flag. A later change to the same decision flags it again — that one is a change nobody has judged.',
			inputSchema: { node: z.string(), reason: z.string().min(1) },
		},
		tool(async ({ node, reason }: { node: string; reason: string }) => {
			const paths = await openBoard(cwd)
			const updated = await dismissFlag(paths, node, { by: await whoami(paths.root), reason })
			return text(`${node} is no longer flagged. Kept on it: ${updated.dismissal?.reason ?? ''}`)
		}),
	)

	server.registerTool(
		'reopen',
		{
			title: 'Un-finish a node so it can run again',
			description:
				'Clears what made the node done and puts it back in the loop, with its brief still approved. It does not run it and it does not undo the merge — the work that landed stays landed.',
			inputSchema: { node: z.string() },
		},
		tool(async ({ node }: { node: string }) => {
			const paths = await openBoard(cwd)
			await reopenNode(paths, node, await whoami(paths.root))
			return text(`${node} is back in the loop. Start it with the \`run\` tool when you are ready.`)
		}),
	)

	server.registerTool(
		'correct_node',
		{
			title: 'Rewrite a node’s title, description or name in place',
			description:
				'Fixes the node’s own words and keeps its id, edges and history. An edit withdraws an approval already on its brief — the human approved words that no longer exist — so the brief needs approving again; the approach stays.',
			inputSchema: {
				node: z.string(),
				title: z.string().min(1).nullish(),
				description: z.string().nullish(),
				name: z.string().min(1).max(40).nullish(),
			},
		},
		tool(
			async (input: {
				node: string
				title?: string | null
				description?: string | null
				name?: string | null
			}) => {
				const paths = await openBoard(cwd)
				const before = (await loadBoard(paths)).nodes.get(input.node)
				await correctNode(paths, input.node, {
					title: input.title ?? undefined,
					description: input.description ?? undefined,
					name: input.name ?? undefined,
					by: await whoami(paths.root),
				})
				const changed = (['title', 'description', 'name'] as const).filter(
					(field) => input[field] !== undefined && input[field] !== null,
				)
				return text(
					[
						`${input.node}: ${changed.join(', ')} corrected.`,
						...(before?.brief?.approval
							? ['Its brief was approved against the old words, so it needs approving again.']
							: []),
					].join(' '),
				)
			},
		),
	)

	server.registerTool(
		'open_node',
		{
			title: 'Open one node for a fix',
			description:
				'One node, with a title and its edges — not a plan. It arrives with no brief, so nothing about it can run until one is written and a human approves it. Use `propose` when the work is a set of nodes with the decisions they introduce.',
			inputSchema: {
				title: z.string().min(1),
				name: z
					.string()
					.min(1)
					.max(40)
					.describe('a short name a person tells this node from its siblings by, like `log-wire`'),
				description: z.string().nullish(),
				files: z.array(z.string()).nullish(),
				dependsOn: z.array(z.string()).nullish(),
				decisions: z.array(z.string()).nullish(),
			},
		},
		tool(
			async (input: {
				title: string
				name: string
				description?: string | null
				files?: string[] | null
				dependsOn?: string[] | null
				decisions?: string[] | null
			}) => {
				const paths = await openBoard(cwd)
				const { id } = await createNode(paths, {
					title: input.title,
					name: input.name,
					by: await whoami(paths.root),
					description: input.description ?? undefined,
					files: input.files ?? undefined,
					dependsOn: input.dependsOn ?? undefined,
					decisions: input.decisions ?? undefined,
				})
				const warning = renderUnlinked(
					new Map([[id, unlinked((await loadBoard(paths)).nodes, id)]]),
				)
				return text(
					[
						`${id} is on the board. It needs a brief before anything can run.`,
						...(warning === '' ? [] : ['', warning]),
					].join('\n'),
				)
			},
		),
	)
}
