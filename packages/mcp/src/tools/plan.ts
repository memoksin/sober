import {
	answerDecision,
	applySetting,
	approveBrief,
	bind,
	createBoardBranch,
	currentBranch,
	detectSetup,
	editDecision,
	findCycle,
	findRoot,
	impactOf,
	initBoard,
	isRepo,
	loadBoard,
	newId,
	queueByDefault,
	readConfig,
	renderBrief,
	whoami,
	writeBrief,
	writeDecision,
	writeNode,
} from '@besober/core'
import { CATEGORIES, type Decision, type Impact, type Node, type Option } from '@besober/schema'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { askYes } from '../ask.js'
import { openBoard, text, tool } from '../context.js'
import { drained } from '../queue.js'
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
	derived: z
		.string()
		.min(1)
		.nullish()
		.describe(
			'where you read this project’s existing answer — a path, a file, “the import graph”. Never an answer either: it says where the options came from, and the human still picks.',
		),
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
						assignee: null,
						claim: null,
						accepted: null,
						dismissal: null,
						createdAt: at,
					},
				])
				for (const [id, record] of records) written.set(id, record)

				// A decision nothing binds holds no work: it reads as a question
				// waiting on the human and blocks nobody, which is the failure the
				// one hard block exists to prevent (§2.3). Found in the M1 gate.
				const bound = new Set(nodes.flatMap((node) => node.decisions))
				const loose = decisions.filter((decision) => !bound.has(decision.key))
				if (loose.length > 0)
					return text(
						[
							`Nothing was written. These decisions bind no node: ${loose.map((one) => one.key).join(', ')}.`,
							'A decision holds the nodes that bind it and nothing else — one nobody binds blocks no work.',
							'Put its key in the `decisions` list of every node whose shape the answer changes, and propose again.',
						].join(' '),
					)

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
						derived: decision.derived ?? null,
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
				'Write the options for a decision that has no answer yet, replacing any already there — a question whose options came out wrong is rewritten in place, not archived and reopened. Options are pitched at the answerer: each carries why someone picks it and what it costs later. Never supply the answer — that is the human’s, through `decide`.',
			inputSchema: {
				decision: z.string(),
				options: z.array(OptionInput).min(2).max(4),
				suggested: z.string().nullish(),
				derived: z.string().min(1).nullish(),
			},
		},
		tool(
			async ({
				decision,
				options,
				suggested,
				derived,
			}: {
				decision: string
				options: z.infer<typeof OptionInput>[]
				suggested?: string | null
				derived?: string | null
			}) => {
				const paths = await openBoard(cwd)
				const board = await loadBoard(paths)
				const record = board.decisions.get(decision)
				if (record === undefined) return text(`${decision} is not on this board.`)
				if (record.answer !== null)
					return text(
						`${decision} is already answered — its options are settled. To change the answer among these options, use \`edit_decision\`. If the options themselves turned out wrong, archive the decision and open a new one: the answer names an option id, and rewriting the list underneath it would orphan the record.`,
					)

				await writeDecision(paths, decision, {
					...record,
					options: options.map((option) => ({ ...option })),
					suggested: suggested ?? null,
					derived: derived ?? null,
				})
				return text(
					`${decision} now has ${options.length} options. Put the question to the human with the \`decide\` tool — it asks them directly, one decision at a time.`,
				)
			},
		),
	)

	server.registerTool(
		'bind',
		{
			title: 'Correct a node’s edges',
			description:
				'Set which decisions a node binds and what it depends on. The lists replace what was there, so pass the full list — this is how a wrong edge is removed, not only how one is added.',
			inputSchema: {
				node: z.string(),
				decisions: z.array(z.string()).nullish().describe('decision ids; omit to leave unchanged'),
				dependsOn: z.array(z.string()).nullish().describe('node ids; omit to leave unchanged'),
			},
		},
		tool(
			async ({
				node,
				decisions,
				dependsOn,
			}: {
				node: string
				decisions?: string[] | null
				dependsOn?: string[] | null
			}) => {
				const paths = await openBoard(cwd)
				const updated = await bind(paths, node, {
					decisions: decisions ?? undefined,
					dependsOn: dependsOn ?? undefined,
				})
				return text(
					`${node} now binds ${updated.decisions.join(', ') || 'no decision'} and depends on ${updated.dependsOn.join(', ') || 'nothing'}.`,
				)
			},
		),
	)

	server.registerTool(
		'decide',
		{
			title: 'Record the human’s pick for one decision',
			description:
				'Record the option the human picked for one decision. Before calling, ask them with this host’s own question tool — one question per call, the option labels exactly as listed — and pass exactly the option they picked. Never an option they did not pick, never a pick carried over from earlier in the conversation, never a list (ADR 0057).',
			inputSchema: { decision: z.string(), option: z.string() },
		},
		tool(async ({ decision, option }: { decision: string; option: string }) => {
			const paths = await openBoard(cwd)
			const board = await loadBoard(paths)
			const record = board.decisions.get(decision)
			if (record === undefined) return text(`${decision} is not on this board.`)
			if (record.options === null)
				return text(`${decision} has no options yet — produce them with \`open_decision\` first.`)
			if (record.answer !== null)
				return text(`${decision} is already answered: ${record.answer.option}.`)

			const base = await currentBranch(paths.root)
			const answered = await answerDecision(paths, decision, {
				option,
				by: await whoami(paths.root),
			})
			const after = await loadBoard(paths)
			const freed = [...after.nodes]
				.filter(([id, node]) => node.decisions.includes(decision) && id !== undefined)
				.map(([id]) => id)
			return text(
				`${decision} is answered: ${answered.answer?.option}. It no longer holds ${freed.join(', ') || 'any node'}.${await drained(paths, base)}`,
			)
		}),
	)

	server.registerTool(
		'edit_decision',
		{
			title: 'Change an answer already given',
			description:
				'Change an answered decision. It shows the human what the change reaches — which briefs are withdrawn and which nodes are flagged — and asks once for the whole fan-out. Nothing is written unless they confirm, and nothing is stopped or re-run.',
			inputSchema: {
				decision: z.string(),
				option: z.string(),
				rationale: z.string().nullish(),
			},
		},
		tool(
			async ({
				decision,
				option,
				rationale,
			}: {
				decision: string
				option: string
				rationale?: string | null
			}) => {
				const paths = await openBoard(cwd)
				const board = await loadBoard(paths)
				const record = board.decisions.get(decision)
				if (record === undefined) return text(`${decision} is not on this board.`)
				if (record.answer === null)
					return text(`${decision} has no answer yet — \`decide\` gives it its first one.`)
				const offered = record.options ?? []
				if (!offered.some((one) => one.id === option))
					return text(
						`${decision} has no option called ${option} — it offers ${offered.map((one) => one.id).join(', ')}.`,
					)

				// One question for the whole fan-out, never one per node: a window per
				// node is how nobody reads any of them (M1 gate, defect 11). The
				// command line spells the same confirmation as a second command
				// (ADR 0032); this host can ask, so it asks.
				const impact = impactOf(board, decision) ?? { decision, nodes: [] }
				const confirmed = await askYes(
					server.server,
					'change an answer',
					`${record.question}\n\nChanging this to ${option} ${reaches(impact)}`,
					'Change it anyway',
				)
				if (!confirmed) return text('The human did not confirm. Nothing was changed.')

				const answered = await editDecision(paths, decision, {
					option,
					rationale: rationale ?? '',
					by: await whoami(paths.root),
					anyway: true,
				})
				return text(
					`${decision} is now ${answered.answer?.option}. ${reaches(impact)} Nothing was stopped and nothing was re-run — say so, and show them what is flagged.`,
				)
			},
		),
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
			title: 'Record the human’s approval of one brief',
			description:
				'Record that the human approved one node’s brief. Before calling, show them the approach and the criteria, ask with this host’s own question tool — one question, a yes and a no — and call only on an explicit yes. Never on a yes they did not give, never on one carried over from earlier in the conversation, never a batch (ADR 0057).',
			inputSchema: {
				node: z.string(),
				confirmed: z.literal(true).describe('the human said yes to this brief, just now'),
				queue: z
					.boolean()
					.nullish()
					.describe(
						'start it without asking again, the moment it becomes ready; omit it to follow the board’s dispatch.queueByDefault',
					),
			},
		},
		tool(async ({ node, queue }: { node: string; queue?: boolean | null }) => {
			const paths = await openBoard(cwd)
			const board = await loadBoard(paths)
			const record = board.nodes.get(node)
			if (record === undefined) return text(`${node} is not on this board.`)
			if (record.brief === null)
				return text(`${node} has no brief yet — write one with \`write_brief\` first.`)

			// The human confirms one of two actions, so the button has to name the
			// one that will happen — which is the board's default when the caller
			// said nothing (ADR 0056).
			const queued = queue ?? (await queueByDefault(paths))

			// One line. The approach and the criteria are read in the conversation,
			// where nothing truncates them; the prompt is where the human decides.
			const yes = await askYes(
				server.server,
				'Approve this brief?',
				`Approve the brief for “${record.title}”, with ${record.brief.acceptance.length} acceptance criteria?`,
				queued ? 'Yes — approve, and start it when it is ready' : 'Yes, approve it',
			)
			if (!yes) return text('Not approved. Nothing was recorded.')

			await approveBrief(paths, node, { by: await whoami(paths.root), queue: queued })
			return text(
				queued
					? `${node} is approved and will start when it is ready.`
					: `${node} is approved. Start it with the \`run\` tool.`,
			)
		}),
	)
}

/**
 * The fan-out as one sentence, because it is asked as one question. The status
 * is named for every node: §2.8 counts running nodes so a person can stop a run
 * that is building against the answer they are about to change, and a list that
 * hides which ones are running takes that away.
 */
const reaches = (impact: Impact): string => {
	if (impact.nodes.length === 0) return 'reaches no node — nothing was built against it yet.'
	const rebrief = impact.nodes.filter((one) => one.effect === 'rebrief')
	const flag = impact.nodes.filter((one) => one.effect === 'flag')
	return [
		`reaches ${impact.nodes.length === 1 ? '1 node' : `${impact.nodes.length} nodes`}:`,
		rebrief.length === 0
			? ''
			: `${rebrief.map((one) => one.id).join(', ')} lose their briefs and are briefed again.`,
		flag.length === 0
			? ''
			: `${flag.map((one) => `${one.id} (${one.status})`).join(', ')} are flagged and left alone.`,
	]
		.filter((part) => part !== '')
		.join(' ')
}
