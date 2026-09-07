import type { Decision, Node, Option, Project, Status, Waiting } from '@besober/schema'
import { decisionState } from '@besober/schema'

/**
 * `GET /read/board`. The whole board in one answer — the panel needs a node's
 * record, the decisions bound to it, and the titles of what it waits on, and
 * three requests to draw one drawer is three loading states to render.
 *
 * `status` and `waitingOn` are derived on the server by `core` (ADR 0035): the
 * browser cannot import `core`, and a second derivation is a second answer.
 */
export interface BoardRead {
	readonly project: Project | null
	readonly nodes: readonly (Node & {
		readonly id: string
		readonly status: Status | null
		readonly waitingOn: readonly Waiting[]
	})[]
	readonly decisions: readonly (Decision & {
		readonly id: string
		readonly archived: boolean
	})[]
	readonly broken: readonly string[]
}

export interface Held {
	readonly kind: Waiting['kind']
	readonly id: string
	/** The question, or the title. What the reader was going to look up anyway. */
	readonly label: string
	/**
	 * Nothing on this board offers to answer it: archived, or not here at all.
	 * Kept in the list rather than filtered out — a node held by nothing and
	 * still not ready is the worse of the two things to render (§8.4).
	 */
	readonly gone: boolean
}

/** What is standing between a node and starting, in words rather than in ids. */
export const held = (board: BoardRead, id: string): Held[] => {
	const node = board.nodes.find((one) => one.id === id)
	if (node === undefined) return []

	return node.waitingOn.map((wait): Held => {
		if (wait.kind === 'decision') {
			const decision = board.decisions.find((one) => one.id === wait.id)
			return {
				kind: 'decision',
				id: wait.id,
				label: decision?.question ?? wait.id,
				gone: decision === undefined || wait.archived,
			}
		}

		const other = board.nodes.find((one) => one.id === wait.id)
		return { kind: 'node', id: wait.id, label: other?.title ?? wait.id, gone: other === undefined }
	})
}

export interface Choice extends Option {
	readonly suggested: boolean
	/** The answer that stands. Re-picking it would move the answer's `at` for nothing. */
	readonly chosen: boolean
}

export interface Offer {
	readonly kind: 'unopened' | 'open' | 'answered'
	readonly options: readonly Choice[]
	/** Why there is nothing to choose. Null when there is. */
	readonly refusal: string | null
}

/**
 * What the decision screen puts in front of a person.
 *
 * An answered decision offers its options again (§2.8): on the screen the
 * preview *is* the screen, so what stops an accidental change is the fan-out
 * rendered in front of the save, not a screen that refuses to open. The answer
 * that stands is marked rather than removed — a reader wants to see what was
 * picked, and re-picking it would move the answer's timestamp and flag every
 * node built on it for no change at all.
 *
 * The one refusal left carries a reason rather than a greyed-out button. A
 * decision nobody has opened has nothing to choose between, and saying which
 * surface produces options is the difference between a dead end and a next step.
 */
export const offer = (decision: Decision): Offer => {
	const state = decisionState(decision)

	if (state === 'unopened')
		return {
			kind: 'unopened',
			options: [],
			refusal:
				'Nothing has proposed options for this yet. Options are generated in a session, against the code as it is now.',
		}

	return {
		kind: state === 'answered' ? 'answered' : 'open',
		options: (decision.options ?? []).map((option) => ({
			...option,
			suggested: option.id === decision.suggested,
			chosen: option.id === decision.answer?.option,
		})),
		refusal: null,
	}
}

/**
 * DESIGN §7.2's three actions on a flagged node. Beside `actions` below rather
 * than inside the component, for the same reason that one is here: what a
 * person may do with a node is a fact about the board, and a fact rendered by
 * one screen is a fact that can be tested without one.
 *
 * Two of the three take words first. A dismissal without a reason is a mute
 * button and §7.2 keeps the judgement; a node with no title cannot be read.
 */
export interface FlagAction {
	readonly does: 'dismiss' | 'reopen' | 'open'
	readonly label: string
	/** What to ask for before acting, or null when the action needs no words. */
	readonly asks: {
		readonly title: string
		readonly placeholder: string
		readonly go: string
	} | null
}

export const FLAG_ACTIONS: readonly FlagAction[] = [
	{
		does: 'dismiss',
		label: 'It is fine anyway',
		asks: {
			title: 'Why it is fine',
			placeholder: 'Kept on the node, so a teammate reads the judgement rather than the flag.',
			go: 'Set it aside',
		},
	},
	// Reopening does not run it. Approving and starting have never been one
	// step, and a reopen that dispatched would be the automatic re-run §7.2
	// refuses with a click in front of it.
	{ does: 'reopen', label: 'Run it again', asks: null },
	{
		does: 'open',
		label: 'Open a node for the fix',
		asks: {
			title: 'What the fix is',
			placeholder: 'A title. The new node depends on this one and arrives with no brief.',
			go: 'Open it',
		},
	},
]

/** What to ask for before an action can act. Null when it needs no words. */
export const asksFor = (does: FlagAction['does']): FlagAction['asks'] =>
	FLAG_ACTIONS.find((action) => action.does === does)?.asks ?? null

/**
 * Which operation each action is, and what it carries. Here rather than in the
 * component for `actions`' reason: what a button does to the board is a fact
 * about the board.
 *
 * `open` binds the new node to the one it corrects. A fix that does not say
 * what it is fixing is a node nobody can place a week later.
 */
export const flagOp = (
	node: string,
	does: FlagAction['does'],
	words: string,
): readonly [string, Record<string, unknown>] => {
	if (does === 'dismiss') return ['dismiss', { node, reason: words }]
	if (does === 'reopen') return ['reopen', { node }]
	return ['create_node', { title: words, dependsOn: [node] }]
}

export interface Action {
	/**
	 * An operation on the wire, or `review` and `logs`, which open screens.
	 * `watch` is both: it dispatches with watching on and opens the log.
	 */
	readonly does: 'approve' | 'run' | 'stop' | 'review' | 'logs' | 'watch'
	readonly label: string
}

/**
 * Which statuses have a log to open. A node that has never been dispatched has
 * nothing to read, and offering a button that can only answer "it has not run
 * yet" is the surface lying about what it holds.
 *
 * `done` is on the list for ADR 0037's reason, one level out: a run survives a
 * closed tab, so what it said survives one too — and the finished runs are the
 * ones people come back to.
 */
const HAS_RUN: readonly Status[] = ['running', 'in-review', 'done']

/**
 * What a person can do with this node right now, from its status and nothing
 * else. Status is derived (DESIGN §3.2), so a button offered here cannot
 * disagree with the board — which is the failure this exists to make
 * impossible, and the one M2's gate found in the terminal: a node accepted from
 * a session still read as reviewable and offered an accept that had no branch
 * left to merge.
 *
 * Approving and running are never offered together. They are one step of the
 * loop and two acts on the board, and a panel that offered both would be
 * offering to start work nobody has read.
 */
export const actions = (status: Status | null): readonly Action[] => {
	// The log comes first on a running node and last everywhere else, and that
	// is the whole of the ordering rule: while it is running, reading what the
	// agent is saying is the only thing anyone came for.
	const log: readonly Action[] =
		status !== null && HAS_RUN.includes(status) ? [{ does: 'logs', label: 'Watch the run' }] : []

	switch (status) {
		case 'needs-approval':
			return [{ does: 'approve', label: 'Approve the brief' }]
		// Two ways to start, and the plain one is first. A watched run stays open
		// for a reply, so it ends when somebody ends it — that is the right trade
		// for a person who meant to sit with it and a bad surprise for anyone who
		// clicked the nearest button (ADR 0046).
		case 'ready':
			return [
				{ does: 'run', label: 'Run' },
				{ does: 'watch', label: 'Run and watch' },
			]
		case 'running':
			return [...log, { does: 'stop', label: 'Stop' }]
		case 'in-review':
			return [{ does: 'review', label: 'Review' }, ...log]
		// A review of accepted work is a record of what was accepted rather than
		// a decision waiting to be made — still worth opening, never a second
		// accept.
		case 'done':
			return [{ does: 'review', label: 'What was accepted' }, ...log]
		default:
			return []
	}
}

/**
 * What to do next, in a sentence, from the status and nothing else.
 *
 * M3's gate, finding 2. `M2-GATE.md`'s finding 6 split `needs-brief` in two so
 * the status stopped lying, and a status still is not an instruction: the
 * command line ends nearly everything it prints with where to go next, and the
 * panel ended with a coloured dot and a word. It costs most on the three
 * statuses `actions` offers no button for — `needs-brief`, `held` and `blocked`
 * — because there a person has a colour, a word, and nothing to press.
 *
 * Beside `actions` for `actions`' reason: what a node's status means for a
 * person is a fact about the board, and a fact rendered by one screen is a fact
 * that can be tested without one.
 */
export const nextMove = (status: Status | null): string | null => {
	switch (status) {
		// There is no operation for this on any wire: a brief is written in a
		// session against the repository, which is exactly why the screen has to
		// say where it comes from rather than leaving an empty drawer.
		case 'needs-brief':
			return 'No brief yet. Ask a session for one — /sober:brief — then approve it here.'
		case 'needs-approval':
			return 'Read the approach and the criteria below. Nothing runs until you approve them.'
		case 'ready':
			return 'The brief is approved. Running cuts a worktree and spends real money.'
		// ADR 0045 sent people to a terminal here, because the screen could not
		// show a run. ADR 0046 built the screen, and a pointer at somewhere else
		// is what a surface says only while it is missing the thing.
		case 'running':
			return 'The agent is working. Watch the run to read what it is saying as it says it.'
		case 'in-review':
			return 'The scan has run. Open the review to read what it found before accepting.'
		case 'held':
			return 'A decision this node binds is unanswered. Answer it below and the node frees itself.'
		case 'blocked':
			return 'Something it depends on is not accepted yet. Nothing here moves until that does.'
		case 'done':
			return 'Accepted and merged. Opening the review shows what was accepted, not a second one.'
		default:
			return null
	}
}
