import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import type { BoardRead } from './data.js'
import { nextMove } from './data.js'
import { Panel } from './Panel.js'

afterEach(cleanup)

const nothing = () => Promise.resolve()

const node = (over: Partial<BoardRead['nodes'][number]> = {}) =>
	({
		id: 'auth-api-k7f2',
		title: 'The auth API',
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
		status: 'needs-brief',
		waitingOn: [],
		...over,
	}) as BoardRead['nodes'][number]

const panel = (one: BoardRead['nodes'][number]) =>
	render(
		<Panel
			board={{ project: null, nodes: [one], decisions: [], broken: [] }}
			id={one.id}
			flagged={false}
			onClose={() => {}}
			onPick={() => {}}
			onDecide={() => {}}
			onDo={nothing}
			onDismiss={nothing}
			onReopen={nothing}
			onOpen={nothing}
		/>,
	)

/**
 * M3's gate, finding 2. `needs-brief` offers no button — a brief is written in
 * a session, not by a click — so the sentence is the only thing on the screen
 * that says where the next move comes from.
 */
test('a node with no brief says where a brief comes from', () => {
	panel(node({ status: 'needs-brief' }))

	expect(screen.getByText(nextMove('needs-brief') as string)).toBeTruthy()
})

test('a node with a button still says what the button is for', () => {
	panel(node({ status: 'ready' }))

	expect(screen.getByRole('button', { name: 'Run' })).toBeTruthy()
	expect(screen.getByText(nextMove('ready') as string)).toBeTruthy()
})

/**
 * M3's gate, finding 3. The approach is written by an agent and an agent writes
 * markdown. The panel showed the source.
 */
test('the approach renders as what was written, not as its source', () => {
	const { container } = panel(
		node({
			status: 'needs-approval',
			brief: {
				approach: '## How\n\n- read `board.ts`\n- write the route',
				acceptance: [{ run: 'pnpm test', proves: 'the `board` still loads' }],
				approval: null,
				at: '2026-09-07T00:00:00.000Z',
				by: 'agent',
			} as BoardRead['nodes'][number]['brief'],
		}),
	)

	expect(screen.getByRole('heading', { name: 'How' })).toBeTruthy()
	expect(container.querySelectorAll('li').length).toBeGreaterThanOrEqual(2)
	expect(container.textContent).not.toContain('## How')
	// A criterion's `proves` is one phrase, and its inline code is marked too.
	expect([...container.querySelectorAll('code')].map((one) => one.textContent)).toContain('board')
})
