import {
	acceptWork,
	archiveDecision,
	archiveNode,
	currentBranch,
	loadBoard,
	rejectWork,
	reviewNode,
	whoami,
} from '@besober/core'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { openBoard, text, tool } from '../context.js'
import { drained } from '../queue.js'
import { renderReview } from '../render.js'

/**
 * Review, and the two ways out of it. Accepting is a human act — it is recorded
 * with their name and with how the scan read at that moment (`PR-09-06`) — so,
 * like a decision and like an approval, the host's own question tool asks them
 * and the agent relays their yes (ADR 0057).
 */
export const registerReview = (server: McpServer, cwd: string): void => {
	server.registerTool(
		'review',
		{
			title: 'Review a node’s work',
			description:
				'The scan, then what must be true when it is done, then the files. The diff comes last and only when you ask: a reviewer who reads every line to find the problem is doing the scan’s job by hand.',
			inputSchema: {
				node: z.string(),
				base: z.string().nullish(),
				diff: z.boolean().default(false),
			},
		},
		tool(async ({ node, base, diff }: { node: string; base?: string | null; diff: boolean }) => {
			const paths = await openBoard(cwd)
			const found = await reviewNode(paths, node, base ?? (await currentBranch(paths.root)))
			if (found === null) return text(`${node} is not on this board.`)
			return text(renderReview(found, diff))
		}),
	)

	server.registerTool(
		'accept',
		{
			title: 'Record the human’s acceptance of the work',
			description:
				'Merge a node’s work into the base once the human accepted it: the node is done and the worktree goes away. Before calling, tell them what the review found, ask with this host’s own question tool — one question, a yes and a no — and call only on an explicit yes. Never on a yes they did not give, never on one carried over from earlier in the conversation, one node per call (ADR 0057).',
			inputSchema: {
				node: z.string(),
				base: z.string().nullish(),
				confirmed: z.literal(true).describe('the human said yes to merging this node, just now'),
			},
		},
		tool(async ({ node, base }: { node: string; base?: string | null }) => {
			const paths = await openBoard(cwd)
			const ref = base ?? (await currentBranch(paths.root))
			const found = await reviewNode(paths, node, ref)
			if (found === null) return text(`${node} is not on this board.`)

			const scan = found.scan.result
			const landed = await acceptWork(paths, node, {
				by: await whoami(paths.root),
				base: ref,
				// Recorded as it read at the moment a human accepted, including
				// "the scan did not run" (`PR-09-06`).
				scan,
			})
			const after = await loadBoard(paths)
			const freed = [...after.nodes]
				.filter(([, record]) => record.dependsOn.includes(node))
				.map(([id]) => id)
			const where =
				landed.kind === 'merged'
					? `merged into ${landed.base} as ${landed.commit.slice(0, 8)}`
					: `pull request #${landed.pr.number} was marked ready and merged`
			const draft =
				landed.kind === 'merged' && landed.openPr !== null
					? ` Draft #${landed.openPr.number} is still open — it closes when the human pushes ${landed.base}.`
					: ''
			return text(
				`${node} is done — ${where}.${draft}${freed.length > 0 ? ` ${freed.join(', ')} can move now.` : ''}${await drained(paths, ref)}`,
			)
		}),
	)

	server.registerTool(
		'reject',
		{
			title: 'Send the work back',
			description:
				'Nothing is deleted: the branch and the worktree stay, and the next run carries your note alongside the brief. Say what was wrong in the words the next run should read.',
			inputSchema: {
				node: z.string(),
				feedback: z.string().min(1),
				clean: z
					.boolean()
					.default(false)
					.describe('reset the branch to its base, so the next run starts from nothing'),
				base: z.string().nullish(),
			},
		},
		tool(
			async ({
				node,
				feedback,
				clean,
				base,
			}: {
				node: string
				feedback: string
				clean: boolean
				base?: string | null
			}) => {
				const paths = await openBoard(cwd)
				await rejectWork(paths, node, {
					by: await whoami(paths.root),
					text: feedback,
					clean,
					base: base ?? (await currentBranch(paths.root)),
				})
				return text(
					`${node} is back in the queue. Nothing was deleted. ${
						clean
							? 'The branch was reset to its base, so the next run starts from nothing.'
							: 'The next run keeps this attempt’s work and carries your note.'
					}`,
				)
			},
		),
	)

	server.registerTool(
		'archive',
		{
			title: 'Take a node or decision off the board',
			description:
				'It leaves the board and keeps its record: every node that referenced it still reads it.',
			inputSchema: { id: z.string() },
		},
		tool(async ({ id }: { id: string }) => {
			const paths = await openBoard(cwd)
			const board = await loadBoard(paths)
			if (board.nodes.has(id)) await archiveNode(paths, id)
			else if (board.decisions.has(id)) await archiveDecision(paths, id)
			else return text(`${id} is not on this board.`)
			return text(`${id} is archived. Every node that referenced it still reads it.`)
		}),
	)
}
