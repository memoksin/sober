import {
	addContributor,
	assignNode,
	claimNode,
	type Overlap,
	readContributors,
	releaseNode,
	removeContributor,
	whoami,
} from '@besober/core'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { openBoard, text, tool } from '../context.js'

const said = (overlaps: readonly Overlap[]): string =>
	overlaps.length === 0
		? ''
		: `\n\nHeading for the same files, and not blocked:\n${overlaps
				.map(
					(overlap) =>
						`- ${overlap.id} (${overlap.by ?? 'not started yet'}): ${overlap.files.join(', ')}`,
				)
				.join('\n')}`

/**
 * The team, in a session (DESIGN §3.3). Assignment and claim are the graph's,
 * not a machine's, so they are here for the same reason every other
 * state-changing operation is on every surface (`PR-09-08`).
 */
export const registerTeam = (server: McpServer, cwd: string): void => {
	server.registerTool(
		'contributors',
		{
			title: 'Who is on this project',
			description:
				'Lists the team, or puts someone on it and takes someone off. Board state, not a machine setting: it travels with the graph.',
			inputSchema: {
				action: z.enum(['list', 'add', 'remove']).default('list'),
				handle: z.string().nullish(),
				name: z.string().nullish(),
				role: z.string().nullish(),
				focus: z.string().nullish(),
			},
		},
		tool(
			async (input: {
				action: 'list' | 'add' | 'remove'
				handle?: string | null
				name?: string | null
				role?: string | null
				focus?: string | null
			}) => {
				const paths = await openBoard(cwd)
				if (input.action === 'list') {
					const team = await readContributors(paths)
					if (team.length === 0) return text('Nobody is on this project yet.')
					return text(
						team
							.map((person) => `- ${person.handle} ${person.name} ${person.role} ${person.focus}`)
							.join('\n'),
					)
				}
				const handle = input.handle
				if (handle === undefined || handle === null || handle === '')
					return text('Which handle? `add` and `remove` both need one.')

				if (input.action === 'remove') {
					const gone = await removeContributor(paths, handle)
					return text(gone ? `${handle} is off the project.` : `${handle} was not on it.`)
				}
				await addContributor(paths, {
					handle,
					name: input.name ?? '',
					role: input.role ?? '',
					focus: input.focus ?? '',
				})
				return text(`${handle} is on the project.`)
			},
		),
	)

	server.registerTool(
		'assign',
		{
			title: 'Hand a node to someone',
			description:
				'Assignment is a plan: who a node is meant for, ahead of time. Leave the handle out to assign it to nobody. Someone who is not on the project is refused — add them first.',
			inputSchema: { node: z.string(), handle: z.string().nullish() },
		},
		tool(async ({ node, handle }: { node: string; handle?: string | null }) => {
			const paths = await openBoard(cwd)
			await assignNode(paths, node, handle ?? null)
			return text(handle ? `${node} is assigned to ${handle}.` : `${node} is assigned to nobody.`)
		}),
	)

	server.registerTool(
		'claim',
		{
			title: 'Say who is on a node now',
			description:
				'Claim is a fact: whoever actually starts it. A signal, never a lock — taking one someone else is heading for is reported, not refused. `release` gives it back.',
			inputSchema: { node: z.string(), release: z.boolean().default(false) },
		},
		tool(async ({ node, release }: { node: string; release: boolean }) => {
			const paths = await openBoard(cwd)
			if (release) {
				const had = await releaseNode(paths, node)
				return text(had === null ? `Nobody had claimed ${node}.` : `${node} is nobody's again.`)
			}
			const by = await whoami(paths.root)
			const taken = await claimNode(paths, node, by)
			const before =
				taken.previous !== null && taken.previous.by !== by
					? ` It was ${taken.previous.by}'s — they were not asked, and not stopped.`
					: ''
			return text(`${node} is ${by}'s.${before}${said(taken.overlaps)}`)
		}),
	)
}
