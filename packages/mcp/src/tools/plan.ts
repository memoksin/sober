import {
	answerDecision,
	applySetting,
	approveBrief,
	createBoardBranch,
	detectSetup,
	findCycle,
	findRoot,
	initBoard,
	isRepo,
	loadBoard,
	newId,
	readConfig,
	renderBrief,
	whoami,
	writeBrief,
	writeDecision,
	writeNode,
} from '@besober/core'
import { CATEGORIES, type Decision, type Node, type Option } from '@besober/schema'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { askChoice, askYes } from '../ask.js'
import { openBoard, text, tool } from '../context.js'
import { renderBoard, renderDecisions } from '../render.js'

const CriterionInput = z.object({
	run: z.string().describe('the command that proves it, exactly as it is typed'),
	proves: z.string().describe('what passing it establishes'),
})

const OptionInput = z.object({
	id: z.string().describe('a short slug, unique within this decision'),
	label: z.string(),
	reason: z.string().describe('why someone would pick this one'),
	costLater: z.string().describe('what it costs later — the half people find out too late'),
})

const NodeInput = z.object({
	key: z
		.string()
		.describe('a name for this node inside this call, so other entries can point at it'),
	title: z.string(),
	description: z.string().default(''),
	files: z.array(z.string()).default([]).describe('globs this node is expected to touch'),
	dependsOn: z.array(z.string()).default([]).describe('node ids, or keys from this same call'),
	decisions: z.array(z.string()).default([]).describe('decision ids, or keys from this same call'),
})

const DecisionInput = z.object({
	key: z.string(),
	category: z.enum(CATEGORIES),
	question: z.string(),
	options: z.array(OptionInput).min(2).max(4).nullish(),
	suggested: z.string().nullish().describe('an option id you would pick — never an answer'),
})

/**
 * Planning happens in the session that already holds the repository in context
 * (ADR 0009). These are the tools it plans with: the board it reads, the graph
 * it proposes, the decisions it opens and the briefs it writes — and the two
 * things it may not do alone, which go to the human through elicitation.
 */
export const registerPlanning = (server: McpServer, cwd: string): void => {
	server.registerTool(
		'init',
		{
			title: 'Create the board',
			description: 'Create the SOBER board in this repository. Safe to call twice.',
			inputSchema: {
				title: z.string().nullish(),
				intent: z.string().nullish().describe('one sentence on what this project is for'),
			},
		},
		tool(async ({ title, intent }: { title?: string | null; intent?: string | null }) => {
			const root = cwd
			if (findRoot(root) !== null) return text('There is already a board here — nothing changed.')
			if (!(await isRepo(root)))
				return text('This is not a git repository. SOBER plans work that git tracks.')

			const { paths } = await initBoard(root, {
				title: title ?? root.split('/').pop() ?? 'project',
				intent: intent ?? '',
				constraints: [],
			})
			// A default that can be detected is written in concretely (`PR-00-06`).
			const setup = await detectSetup(root)
			if (setup !== null) await applySetting(paths, ['dispatch', 'setup'], setup)
			const settings = await readConfig(paths)
			if (settings.kind === 'ok') await createBoardBranch(root, settings.value.board.branch)

			return text(
				[
					'The board is ready.',
					setup === null
						? 'dispatch.setup is empty. It is the command that prepares a fresh worktree — without it an agent cannot build or test what it writes. Ask the human what it should be, and put it in .sober/config.jsonc.'
						: `dispatch.setup was detected as \`${setup}\`. Tell the human, in case it is wrong.`,
				].join('\n'),
			)
		}),
	)

	server.registerTool(
		'board',
		{
			title: 'Read the board',
			description:
				'Every node with its derived status, what each is waiting for, and the decisions still open.',
			inputSchema: {},
		},
		tool(async () => text(renderBoard(await loadBoard(await openBoard(cwd))))),
	)

	server.registerTool(
		'decisions',
		{
			title: 'Open decisions',
			description: 'Every decision waiting on the human, with each option and what it costs later.',
			inputSchema: {},
		},
		tool(async () => text(renderDecisions(await loadBoard(await openBoard(cwd))))),
	)

	server.registerTool(
		'propose',
		{
			title: 'Propose nodes and decisions',
			description:
				'Write proposed nodes, the edges between them, and the decisions they bind. Proposals are written to disk as they are made, so nothing is lost if this session ends. A decision written here has no answer: every node bound by it is held until a human picks.',
			inputSchema: {
				nodes: z.array(NodeInput).default([]),
				decisions: z.array(DecisionInput).default([]),
			},
		},
		tool(
			async ({
				nodes,
				decisions,
			}: {
				nodes: z.infer<typeof NodeInput>[]
				decisions: z.infer<typeof DecisionInput>[]
			}) => {
				const paths = await openBoard(cwd)
				const board = await loadBoard(paths)
				const at = new Date().toISOString()

				// A key is local to this call; an id is what lands on disk. Resolving
				// them here is what lets one call write a graph with its edges in it.
				const ids = new Map<string, string>()
				for (const decision of decisions) ids.set(decision.key, newId(decision.question))
				for (const node of nodes) ids.set(node.key, newId(node.title))
				const idOf = (reference: string): string => ids.get(reference) ?? reference

				const written = new Map<string, Node>(board.nodes)
				const records = nodes.map((node): [string, Node] => [
					idOf(node.key),
					{
						title: node.title,
						description: node.description,
						notes: '',
						dependsOn: node.dependsOn.map(idOf),
						decisions: node.decisions.map(idOf),
						files: node.files,
						brief: null,
						outcome: null,
						accepted: null,
						createdAt: at,
					},
				])
				for (const [id, record] of records) written.set(id, record)

				// A dependency that would close a cycle is refused, with the cycle
				// shown (§3.6). Refused before anything is written, so a rejected
				// proposal leaves the board exactly as it was.
				const cycle = findCycle(written)
				if (cycle !== null)
					return text(
						`That proposal closes a cycle: ${cycle.join(' → ')}. Nothing was written. Break it and propose again.`,
					)

				for (const decision of decisions) {
					const options: Option[] | null =
						decision.options == null ? null : decision.options.map((option) => ({ ...option }))
					const record: Decision = {
						category: decision.category,
						question: decision.question,
						options,
						suggested: decision.suggested ?? null,
						answer: null,
						createdAt: at,
					}
					await writeDecision(paths, idOf(decision.key), record)
				}
				for (const [id, record] of records) await writeNode(paths, id, record)

				const lines = [
					...decisions.map((decision) => `decision ${idOf(decision.key)}  ${decision.question}`),
					...nodes.map((node) => `node     ${idOf(node.key)}  ${node.title}`),
				]
				return text(
					[
						`Written to the board:`,
						...lines,
						'',
						'Show these to the human. Decisions are answered one at a time with the `decide` tool.',
					].join('\n'),
				)
			},
		),
	)

	server.registerTool(
		'open_decision',
		{
			title: 'Produce the options for a decision',
			description:
				'Fill in the options for a decision that has none. Options are pitched at the answerer: each carries why someone picks it and what it costs later. Never supply the answer — that is the human’s, through `decide`.',
			inputSchema: {
				decision: z.string(),
				options: z.array(OptionInput).min(2).max(4),
				suggested: z.string().nullish(),
			},
		},
		tool(
			async ({
				decision,
				options,
				suggested,
			}: {
				decision: string
				options: z.infer<typeof OptionInput>[]
				suggested?: string | null
			}) => {
				const paths = await openBoard(cwd)
				const board = await loadBoard(paths)
				const record = board.decisions.get(decision)
				if (record === undefined) return text(`${decision} is not on this board.`)
				if (record.answer !== null)
					return text(`${decision} is already answered — its options are settled.`)

				await writeDecision(paths, decision, {
					...record,
					options: options.map((option) => ({ ...option })),
					suggested: suggested ?? null,
				})
				return text(
					`${decision} now has ${options.length} options. Put the question to the human with the \`decide\` tool — it asks them directly, one decision at a time.`,
				)
			},
		),
	)

	server.registerTool(
		'decide',
		{
			title: 'Ask the human to answer one decision',
			description:
				'Put one decision to the human and record what they pick. The choice comes from them, never from you: this tool takes no answer and never a list of decisions.',
			inputSchema: { decision: z.string() },
		},
		tool(async ({ decision }: { decision: string }) => {
			const paths = await openBoard(cwd)
			const board = await loadBoard(paths)
			const record = board.decisions.get(decision)
			if (record === undefined) return text(`${decision} is not on this board.`)
			if (record.options === null)
				return text(`${decision} has no options yet — produce them with \`open_decision\` first.`)
			if (record.answer !== null)
				return text(`${decision} is already answered: ${record.answer.option}.`)

			const picked = await askChoice(
				server.server,
				'Which one?',
				[
					record.question,
					'',
					...record.options.map(
						(option) => `${option.label} — because ${option.reason}; later: ${option.costLater}`,
					),
				].join('\n'),
				record.options.map((option) => ({ id: option.id, label: option.label })),
			)
			if (picked === null) return text('The human did not answer. Nothing was recorded.')

			const answered = await answerDecision(paths, decision, {
				option: picked,
				by: await whoami(paths.root),
			})
			const after = await loadBoard(paths)
			const freed = [...after.nodes]
				.filter(([id, node]) => node.decisions.includes(decision) && id !== undefined)
				.map(([id]) => id)
			return text(
				`${decision} is answered: ${answered.answer?.option}. It no longer holds ${freed.join(', ') || 'any node'}.`,
			)
		}),
	)

	server.registerTool(
		'brief',
		{
			title: 'Read a node’s brief',
			description:
				'The brief as the agent will receive it: rendered from the records at read time, with the answered decisions in it.',
			inputSchema: { node: z.string() },
		},
		tool(async ({ node }: { node: string }) => {
			const paths = await openBoard(cwd)
			const board = await loadBoard(paths)
			const rendered = renderBrief(board, node)
			if (rendered === null) return text(`${node} is not on this board.`)
			const approval = board.nodes.get(node)?.brief?.approval
			return text(
				`${rendered}\n\n${
					approval == null
						? 'Not approved. Nothing runs without an approval, which is the human’s.'
						: `Approved by ${approval.by}${approval.queue ? ', and queued' : ''}.`
				}`,
			)
		}),
	)

	server.registerTool(
		'write_brief',
		{
			title: 'Write a node’s approach',
			description:
				'The written half of a brief: how you would do it, and what must be true when it is done. Writing one clears any approval on it — the approved thing was the old approach.',
			inputSchema: {
				node: z.string(),
				approach: z.string(),
				acceptance: z.array(CriterionInput).min(1),
			},
		},
		tool(
			async ({
				node,
				approach,
				acceptance,
			}: {
				node: string
				approach: string
				acceptance: z.infer<typeof CriterionInput>[]
			}) => {
				const paths = await openBoard(cwd)
				await writeBrief(paths, node, {
					approach,
					acceptance: acceptance.map((criterion) => ({ ...criterion })),
				})
				return text(
					`${node} has a brief. Show it to the human and ask for approval with the \`approve\` tool.`,
				)
			},
		),
	)

	server.registerTool(
		'approve',
		{
			title: 'Ask the human to approve one brief',
			description:
				'Put one node’s brief to the human. Approval is theirs, per node, never a batch — this tool takes one node and asks them directly.',
			inputSchema: {
				node: z.string(),
				queue: z
					.boolean()
					.default(false)
					.describe('start it without asking again, the moment it becomes ready'),
			},
		},
		tool(async ({ node, queue }: { node: string; queue: boolean }) => {
			const paths = await openBoard(cwd)
			const board = await loadBoard(paths)
			const record = board.nodes.get(node)
			if (record === undefined) return text(`${node} is not on this board.`)
			if (record.brief === null)
				return text(`${node} has no brief yet — write one with \`write_brief\` first.`)

			const yes = await askYes(
				server.server,
				'Approve this brief?',
				`${record.title}\n\n${record.brief.approach}\n\nWhen it is done:\n${record.brief.acceptance
					.map((criterion) => `· ${criterion.proves} (${criterion.run})`)
					.join('\n')}`,
				queue ? 'Yes — approve, and start it when it is ready' : 'Yes, approve it',
			)
			if (!yes) return text('Not approved. Nothing was recorded.')

			await approveBrief(paths, node, { by: await whoami(paths.root), queue })
			return text(
				queue
					? `${node} is approved and will start when it is ready.`
					: `${node} is approved. Start it with the \`run\` tool.`,
			)
		}),
	)
}
