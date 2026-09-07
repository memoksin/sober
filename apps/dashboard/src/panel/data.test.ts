import { STATUSES } from '@besober/schema'
import { expect, test } from 'vitest'
import type { BoardRead } from './data.js'
import { actions, asksFor, FLAG_ACTIONS, flagOp, held, nextMove, offer } from './data.js'

const AT = '2026-09-06T00:00:00.000Z'

const node = (id: string, over: Partial<BoardRead['nodes'][number]> = {}) => ({
	id,
	title: `Title of ${id}`,
	description: '',
	notes: '',
	dependsOn: [],
	decisions: [],
	files: [],
	brief: null,
	outcome: null,
	assignee: null,
	claim: null,
	accepted: null,
	dismissal: null,
	createdAt: AT,
	status: 'ready' as const,
	waitingOn: [],
	...over,
})

const decision = (id: string, over: Partial<BoardRead['decisions'][number]> = {}) => ({
	id,
	category: 'state' as const,
	question: `Question of ${id}`,
	options: [
		{ id: 'cookie', label: 'Cookie', reason: 'No server state', costLater: 'Size limits' },
		{ id: 'redis', label: 'Redis', reason: 'Revocable', costLater: 'A service to run' },
	],
	suggested: null,
	answer: null,
	createdAt: AT,
	archived: false,
	...over,
})

const board = (nodes: BoardRead['nodes'], decisions: BoardRead['decisions'] = []): BoardRead => ({
	project: null,
	nodes,
	decisions,
	broken: [],
})

test('a wait is resolved to what a person reads, not to the id they were given', () => {
	// A panel that renders `auth-model-k7f2` has handed the reader the lookup
	// the board exists to do for them.
	const one = board(
		[node('a', { waitingOn: [{ kind: 'decision', id: 'd1', archived: false }] })],
		[decision('d1', { question: 'Where does session state live?' })],
	)

	expect(held(one, 'a')).toEqual([
		{ kind: 'decision', id: 'd1', label: 'Where does session state live?', gone: false },
	])
})

test('a node it waits on is named by its title', () => {
	const one = board([
		node('a', { waitingOn: [{ kind: 'node', id: 'b', archived: false }] }),
		node('b', { title: 'Session endpoints' }),
	])

	expect(held(one, 'a')).toEqual([
		{ kind: 'node', id: 'b', label: 'Session endpoints', gone: false },
	])
})

test('a wait on something the board does not hold is marked gone, never dropped', () => {
	// §8.4: one bad record does not take down a board. A panel that silently
	// drops the wait renders a node that is held by nothing and still not ready.
	const one = board([node('a', { waitingOn: [{ kind: 'node', id: 'ghost', archived: false }] })])

	expect(held(one, 'a')).toEqual([{ kind: 'node', id: 'ghost', label: 'ghost', gone: true }])
})

test('an archived decision is gone too — nothing on the board offers to answer it', () => {
	const one = board(
		[node('a', { waitingOn: [{ kind: 'decision', id: 'd1', archived: true }] })],
		[decision('d1', { archived: true })],
	)

	expect(held(one, 'a')[0]?.gone).toBe(true)
})

test('an open decision offers its options', () => {
	const open = offer(decision('d1'))

	expect(open.kind).toBe('open')
	expect(open.options).toHaveLength(2)
	expect(open.refusal).toBeNull()
})

/**
 * §2.8 lifted this refusal: on the screen the preview *is* the screen, so an
 * answered decision offers its options again rather than explaining why it
 * cannot. What stops an accidental change is the preview in front of the save,
 * not a screen that will not open.
 */
test('an answered decision offers its options again — the edit is this same screen', () => {
	const answered = offer(
		decision('d1', { answer: { option: 'redis', rationale: 'We run one.', by: 'me', at: AT } }),
	)

	expect(answered.kind).toBe('answered')
	expect(answered.options).toHaveLength(2)
	expect(answered.refusal).toBeNull()
})

test('the answer already given is marked, so re-picking it is not offered as a change', () => {
	const answered = offer(
		decision('d1', { answer: { option: 'redis', rationale: 'We run one.', by: 'me', at: AT } }),
	)

	expect(answered.options.find((one) => one.id === 'redis')?.chosen).toBe(true)
	expect(answered.options.find((one) => one.id === 'cookie')?.chosen).toBe(false)
})

test('nothing is marked chosen on a decision nobody has answered', () => {
	expect(offer(decision('d1')).options.every((one) => !one.chosen)).toBe(true)
})

test('a decision nobody has opened has nothing to choose between, and says so', () => {
	const unopened = offer(decision('d1', { options: null }))

	expect(unopened.kind).toBe('unopened')
	expect(unopened.options).toEqual([])
	expect(unopened.refusal).toContain('session')
})

test('the suggested option is marked, and no other one is', () => {
	const open = offer(decision('d1', { suggested: 'redis' }))

	expect(open.options.map((option) => option.suggested)).toEqual([false, true])
})

test('a ready node can be run, and nothing else offers to run one', () => {
	expect(actions('ready').map((one) => one.does)).toEqual(['run'])

	for (const status of ['blocked', 'held', 'needs-brief'] as const)
		expect(actions(status), status).toEqual([])
})

test('an unapproved brief is approved before it is run, never beside it', () => {
	// The two are one step in the loop and two acts on the board. A panel that
	// offered both would be offering to start work nobody has read.
	expect(actions('needs-approval').map((one) => one.does)).toEqual(['approve'])
})

test('a run in flight can be stopped, and a finished one is reviewed', () => {
	expect(actions('running').map((one) => one.does)).toEqual(['stop'])
	expect(actions('in-review').map((one) => one.does)).toEqual(['review'])
})

test('done offers the review and never a second accept', () => {
	// M2's gate found this in the terminal: a node accepted from a session still
	// read as reviewable and offered an accept that had no branch left to merge.
	// The review of accepted work is a record, so it is still worth opening.
	expect(actions('done').map((one) => one.does)).toEqual(['review'])
})

test('a status the board could not derive offers nothing', () => {
	expect(actions(null)).toEqual([])
})

/**
 * DESIGN §7.2's three, as a fact rather than as markup. Two of them take words
 * before they act: a dismissal without a reason is a mute button, and a node
 * with no title cannot be read.
 */
test('the three things a flagged node offers, and which of them ask first', () => {
	expect(FLAG_ACTIONS.map((action) => action.does)).toEqual(['dismiss', 'reopen', 'open'])

	expect(asksFor('dismiss')?.title).toBe('Why it is fine')
	expect(asksFor('open')?.title).toBe('What the fix is')
	// Reopening acts on the click. It does not run the node either — approving
	// and starting have never been one step.
	expect(asksFor('reopen')).toBeNull()
})

test('each of the three is its own operation on the wire, and the fix says what it fixes', () => {
	expect(flagOp('auth-api-k7f2', 'dismiss', 'Fine as it is.')).toEqual([
		'dismiss',
		{ node: 'auth-api-k7f2', reason: 'Fine as it is.' },
	])
	// Reopening carries no words, and it is not `run`: it clears what made the
	// node done and stops there (§7.2).
	expect(flagOp('auth-api-k7f2', 'reopen', '')).toEqual(['reopen', { node: 'auth-api-k7f2' }])
	expect(flagOp('auth-api-k7f2', 'open', 'Re-read the store')).toEqual([
		'create_node',
		{ title: 'Re-read the store', dependsOn: ['auth-api-k7f2'] },
	])
})

/**
 * M3's gate, finding 2. `M2-GATE.md`'s finding 6 split `needs-brief` in two, so
 * the status no longer lies — but a status is still not an instruction, and the
 * command line ends what it prints with the next move while the panel ended
 * with nothing.
 */
test('every status a node can hold says what the next move is', () => {
	for (const status of STATUSES) {
		expect(nextMove(status), status).toBeTypeOf('string')
	}
})

test('a status the board could not derive says nothing rather than guessing', () => {
	expect(nextMove(null)).toBeNull()
})

/**
 * The three the panel offers no button for. These are the ones the finding is
 * about: a button is its own instruction, and a drawer with neither a button
 * nor a sentence leaves a person with a colour and a word.
 */
test('the statuses with no button name what produces the move', () => {
	for (const status of ['needs-brief', 'held', 'blocked'] as const) {
		expect(actions(status), status).toEqual([])
	}

	// A brief is written in a session — there is no wire operation for it, which
	// is exactly why the panel has to say where it comes from.
	expect(nextMove('needs-brief')).toMatch(/session/i)
	expect(nextMove('held')).toMatch(/decision/i)
	expect(nextMove('blocked')).toMatch(/depends on/i)
})

/**
 * Finding 4 is out of v1 (ADR 0045), and the honest thing on a screen that
 * cannot show the run is to say where the run can be read instead.
 */
test('a running node points at the one place its output can be read', () => {
	expect(nextMove('running')).toMatch(/sober logs/)
})

test('no two statuses give the same instruction', () => {
	const said = STATUSES.map((status) => nextMove(status))

	expect(new Set(said).size).toBe(said.length)
})
