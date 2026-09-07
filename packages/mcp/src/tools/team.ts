import {
	addContributor,
	assignNode,
	type Chained,
	claimChain,
	claimNode,
	type Overlap,
	readContributors,
	releaseChain,
	releaseNode,
	removeContributor,
	whoami,
} from '@besober/core'
import { chainEnds } from '@besober/schema'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { askYes } from '../ask.js'
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
				'Claim is a fact: whoever actually starts it. A signal, never a lock — taking one someone else is heading for is reported, not refused. `release` gives it back. A whole run of linked nodes goes in one act as `from..to`, naming the node the work starts at and the one it ends at; a run crossing somebody else’s node asks first.',
			inputSchema: { node: z.string(), release: z.boolean().default(false) },
		},
		tool(async ({ node, release }: { node: string; release: boolean }) => {
			const paths = await openBoard(cwd)
			const ends = chainEnds(node)
			const by = await whoami(paths.root)

			if (ends !== null) {
				const run = release
					? await releaseChain(paths, ends[0], ends[1], by)
					: await claimChain(paths, ends[0], ends[1], by)
				if (run.nodes.length === 0)
					return text(
						`Nothing links ${ends[0]} to ${ends[1]}, so there is no run to take. A run reads from the node the work starts at to the one it ends at.`,
					)
				// ADR 0032's shape on the surface that has a dialog: one question for
				// the whole run rather than one per node, which is how nobody reads
				// any of them (M1's gate, defect 11).
				if (!release && run.changed.length === 0 && (await anyway(server, run.taken)))
					return text(told(await claimChain(paths, ends[0], ends[1], by, { anyway: true }), by))
				return text(told(run, by, release))
			}

			if (release) {
				const had = await releaseNode(paths, node)
				return text(had === null ? `Nobody had claimed ${node}.` : `${node} is nobody's again.`)
			}
			const taken = await claimNode(paths, node, by)
			const before =
				taken.previous !== null && taken.previous.by !== by
					? ` It was ${taken.previous.by}'s — they were not asked, and not stopped.`
					: ''
			return text(`${node} is ${by}'s.${before}${said(taken.overlaps)}`)
		}),
	)
}

const anyway = (server: McpServer, taken: Chained['taken']): Promise<boolean> =>
	askYes(
		server.server,
		// A phrase rather than a question: this one is only ever read inside
		// "this host cannot put a question to you, so it cannot …".
		'take a run that crosses somebody else’s node',
		`${taken.map((one) => `${one.id} (${one.by})`).join(', ')} ${taken.length === 1 ? 'is' : 'are'} already someone else's. A claim is a signal rather than a lock, so nobody is stopped — they are also not asked.`,
		'Yes, take the whole run',
	)

const told = (run: Chained, by: string, release = false): string => {
	if (release)
		return [
			run.changed.length === 0
				? `You had claimed none of these ${run.nodes.length} nodes.`
				: `${run.changed.join(', ')} ${run.changed.length === 1 ? 'is' : 'are'} nobody's again.`,
			run.taken.length === 0
				? ''
				: ` Left alone, because they are not yours: ${run.taken.map((one) => `${one.id} (${one.by})`).join(', ')}.`,
		].join('')

	if (run.changed.length === 0)
		return `Nothing was taken. ${run.taken.map((one) => `${one.id} (${one.by})`).join(', ')} ${run.taken.length === 1 ? 'is' : 'are'} already someone else's.`

	return [
		`${run.changed.join(', ')} ${run.changed.length === 1 ? 'is' : 'are'} ${by}'s.`,
		run.done.length === 0 ? '' : ` Passed over, already done: ${run.done.join(', ')}.`,
		run.taken.length === 0
			? ''
			: ` Taken from ${run.taken.map((one) => one.by).join(', ')} — they were not asked, and not stopped.`,
	].join('')
}
