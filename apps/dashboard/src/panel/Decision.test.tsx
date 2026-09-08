import type { Impact } from '@besober/schema'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { DecisionScreen } from './Decision.js'
import type { BoardRead } from './data.js'

afterEach(cleanup)

const AT = '2026-09-07T00:00:00.000Z'

const board = (answered: boolean): BoardRead => ({
	project: null,
	nodes: [],
	decisions: [
		{
			id: 'auth-model-k7f2',
			category: 'state',
			question: 'Where does session state live?',
			options: [
				{ id: 'cookie', label: 'Cookie', reason: 'No server state', costLater: 'Size limits' },
				{ id: 'redis', label: 'Redis', reason: 'Revocable', costLater: 'A service to run' },
			],
			suggested: null,
			derived: null,
			answer: answered
				? { option: 'cookie', rationale: 'Simplest', by: 'memoksin', at: AT, derived: null }
				: null,
			createdAt: AT,
			archived: false,
		},
	],
	broken: [],
})

const impact: Impact = {
	decision: 'auth-model-k7f2',
	nodes: [
		{ id: 'auth-api-k7f2', title: 'The auth API', status: 'running', effect: 'flag' },
		{ id: 'auth-ui-m3q8', title: 'The sign-in screen', status: 'ready', effect: 'rebrief' },
	],
}

const screenFor = (over: Partial<Parameters<typeof DecisionScreen>[0]> = {}) => {
	const onPreview = vi.fn(() => Promise.resolve(impact))
	const onEdit = vi.fn(() => Promise.resolve())
	render(
		<DecisionScreen
			board={board(true)}
			id="auth-model-k7f2"
			onClose={() => {}}
			onAnswer={() => Promise.resolve()}
			onPreview={onPreview}
			onEdit={onEdit}
			{...over}
		/>,
	)
	return { onPreview, onEdit }
}

/**
 * DESIGN §2.8: an irreversible change is never triggered unseen. On this
 * surface the preview *is* the screen, so the save is not reachable until the
 * fan-out has been asked for.
 */
test('a changed answer cannot be saved before the fan-out has been seen', () => {
	const { onEdit } = screenFor()

	fireEvent.click(screen.getByLabelText(/Redis/))

	expect(screen.queryByText(/Change it anyway/)).toBeNull()
	expect(onEdit).not.toHaveBeenCalled()
})

test('asking for the preview names every node it reaches, and what happens to each', async () => {
	const { onPreview } = screenFor()

	fireEvent.click(screen.getByLabelText(/Redis/))
	fireEvent.click(screen.getByText(/See what this changes/))
	await screen.findByText(/auth-api-k7f2/)

	expect(onPreview).toHaveBeenCalledWith('auth-model-k7f2')
	// §2.8 counts running nodes precisely so a person can stop one that is
	// building against the answer they are about to change.
	expect(screen.getByText(/running/)).toBeTruthy()
	expect(screen.getByText(/auth-ui-m3q8/)).toBeTruthy()
})

test('confirming sends the edit, with the option the fan-out was read against', async () => {
	const { onEdit } = screenFor()

	fireEvent.click(screen.getByLabelText(/Redis/))
	fireEvent.click(screen.getByText(/See what this changes/))
	fireEvent.click(await screen.findByText(/Change it anyway/))

	expect(onEdit).toHaveBeenCalledWith('redis', '')
})

test('the answer that stands is not offered again — re-picking it would flag the board for nothing', () => {
	screenFor()

	expect(screen.getByLabelText(/Cookie/).hasAttribute('disabled')).toBe(true)
})

test('an unanswered decision still answers in one step — there is no fan-out to see', () => {
	const onAnswer = vi.fn(() => Promise.resolve())
	screenFor({ board: board(false), onAnswer })

	fireEvent.click(screen.getByLabelText(/Redis/))

	expect(screen.queryByText(/See what this changes/)).toBeNull()
	expect(screen.getByText(/Answer/)).toBeTruthy()
})
