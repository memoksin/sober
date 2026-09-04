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
import { askYes } from '../ask.js'
import { openBoard, text, tool } from '../context.js'
import { renderReview } from '../render.js'

/**
 * Review, and the two ways out of it. Accepting is a human act — it is recorded
 * with their name and with how the scan read at that moment (`PR-09-06`) — so,
 * like a decision and like an approval, it goes to them through elicitation and
 * never through the agent that did the work.
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
			title: 'Ask the human to accept the work',
			description:
				'Put the result to the human. If they accept, the work is merged into the base, the node is done, and the worktree goes away. One node per call.',
			inputSchema: { node: z.string(), base: z.string().nullish() },
		},
		tool(async ({ node, base }: { node: string; base?: string | null }) => {
			const paths = await openBoard(cwd)
			const ref = base ?? (await currentBranch(paths.root))
			const found = await reviewNode(paths, node, ref)
			if (found === null) return text(`${node} is not on this board.`)

			const scan = found.scan.result
			// One line, and the line says the two things that decide it: how the
			// scan read, and where it lands. The findings are read in the
			// conversation, where nothing truncates them.
			const yes = await askYes(
				server.server,
				`Accept ${node}?`,
				`Merge ${found.files.length} file(s) into ${ref}? The scan reads: ${scan}${
					scan === 'clean'
						? ''
						: ` (${found.scan.findings.length + found.scan.didNotRun.length} to read above)`
				}.`,
				scan === 'clean'
					? `Yes, merge it into ${ref}`
					: `Yes — merge it, knowing the scan says ${scan}`,
			)
			if (!yes) return text('Not accepted. Nothing was merged and nothing was deleted.')

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
			return text(
				`${node} is done — ${where}.${freed.length > 0 ? ` ${freed.join(', ')} can move now.` : ''}`,
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
