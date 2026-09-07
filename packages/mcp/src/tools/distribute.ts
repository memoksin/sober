import {
	acceptDistribution,
	dropDistribution,
	loadBoard,
	proposeDistribution,
	readContributors,
	readDistribution,
	whoami,
} from '@besober/core'
import type { Distribution } from '@besober/schema'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { askYes } from '../ask.js'
import { openBoard, text, tool } from '../context.js'

const MatchInput = z.object({
	node: z.string(),
	handle: z.string().describe('a contributor already on this project'),
	because: z
		.string()
		.describe('why this person and not another — the sentence the human reads when they accept'),
})

/**
 * The proposal as it reads on a surface that is not this session. Every match
 * carries the reason it was made, because by the time somebody opens this the
 * conversation that produced it is gone.
 */
const said = (plan: Distribution, titles: ReadonlyMap<string, string>): string =>
	[
		`Proposed by ${plan.by}, ${plan.at}. Nothing is assigned until it is accepted.`,
		'',
		...plan.matches.map(
			(one) => `${one.handle}  ${one.node}  ${titles.get(one.node) ?? ''}\n    ${one.because}`,
		),
		plan.skipped.length === 0
			? ''
			: `\nPassed over, because somebody is already on them or they are finished: ${plan.skipped.join(', ')}.`,
	]
		.filter((line) => line !== '')
		.join('\n')

/**
 * Allocating a board of thirty nodes across four people (DESIGN §3.3, ADR
 * 0051). The matching is this session's: it reads the board, the roles and the
 * focus globs, and writes a plan. It does not write an assignment — that is the
 * human's, and it is `accept` below, which every surface has.
 *
 * The rule the session does not get to overrule is in `core`: a node somebody
 * has claimed is passed over, because a claim is a fact and an assignment is a
 * plan (§3.3).
 */
export const registerDistribution = (server: McpServer, cwd: string): void => {
	server.registerTool(
		'distribute',
		{
			title: 'Propose who does what',
			description:
				'Read the board against the team and propose which contributor takes which node. Supply `matches` to write a proposal; call it with nothing to read the one that is waiting, `accept: true` to apply it, `drop: true` to take it off the board. A proposal changes no node — accepting is what assigns, and it asks the human directly, so it is never yours to decide. Nodes somebody has already claimed, and finished nodes, are passed over whatever you propose for them.',
			inputSchema: {
				matches: z.array(MatchInput).nullish(),
				accept: z.boolean().default(false),
				drop: z.boolean().default(false),
			},
		},
		tool(
			async ({
				matches,
				accept,
				drop,
			}: {
				matches?: z.infer<typeof MatchInput>[] | null
				accept: boolean
				drop: boolean
			}) => {
				const paths = await openBoard(cwd)

				if (drop)
					return text(
						(await dropDistribution(paths))
							? 'The proposal is off the board. Nothing was assigned.'
							: 'There was no proposal waiting.',
					)

				if (accept) {
					const waiting = await readDistribution(paths)
					if (waiting === null) return text('There is no proposal waiting to be accepted.')

					// The human's act, so the human is asked — the same rule that
					// stops this session answering its own decisions and approving
					// its own briefs (ADR 0010). Telling a model in prose not to
					// accept its own plan is advice from an agent to itself, which
					// is the thing that ADR argues is unenforceable.
					//
					// Dropping is not asked about: it lands nothing, and a dialog to
					// tidy up is friction with nothing to show for it.
					const yes = await askYes(
						server.server,
						'accept a distribution',
						`Assign ${waiting.matches.length} node${waiting.matches.length === 1 ? '' : 's'}: ${waiting.matches
							.map((one) => `${one.node} → ${one.handle}`)
							.join(', ')}?`,
						'Yes, assign them',
					)
					if (!yes)
						return text('Not accepted. Nothing was assigned, and the proposal is still there.')

					const landed = await acceptDistribution(paths)
					if (landed === null) return text('There is no proposal waiting to be accepted.')
					return text(
						[
							landed.matches.length === 0
								? 'Nothing was assigned.'
								: `Assigned: ${landed.matches.map((one) => `${one.node} → ${one.handle}`).join(', ')}.`,
							landed.skipped.length === 0
								? ''
								: `Passed over: ${landed.skipped.join(', ')} — somebody is on them, or they are done.`,
						]
							.filter((part) => part !== '')
							.join(' '),
					)
				}

				const board = await loadBoard(paths)
				const titles = new Map([...board.nodes].map(([id, node]) => [id, node.title]))

				if (matches == null) {
					const waiting = await readDistribution(paths)
					if (waiting === null) {
						const team = await readContributors(paths)
						return text(
							team.length === 0
								? 'Nobody is on this project yet, so there is nobody to distribute to — the `contributors` tool puts someone on it.'
								: `No proposal is waiting. The team:\n${team
										.map(
											(person) =>
												`- ${person.handle} (${person.role || 'no role'}) ${person.focus.join(' ') || 'no focus'}`,
										)
										.join('\n')}`,
						)
					}
					return text(said(waiting, titles))
				}

				const plan = await proposeDistribution(
					paths,
					await whoami(paths.root),
					matches.map((one) => ({ ...one })),
				)
				return text(
					`${said(plan, titles)}\n\nShow this to the human. It assigns nobody until they accept it — here, on the command line, or on the dashboard.`,
				)
			},
		),
	)
}
