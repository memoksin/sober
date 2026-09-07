import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { Flag } from './Flag.js'

afterEach(cleanup)

const AT = '2026-09-07T00:00:00.000Z'

const nothing = () => Promise.resolve()

const flag = (over: Partial<Parameters<typeof Flag>[0]> = {}) =>
	render(
		<Flag
			flagged
			dismissal={null}
			onDismiss={nothing}
			onReopen={nothing}
			onOpen={nothing}
			{...over}
		/>,
	)

test('a node nobody flagged and nobody judged renders nothing at all', () => {
	const { container } = flag({ flagged: false })

	expect(container.innerHTML).toBe('')
})

/**
 * §7.2's dismissal is a judgement that is kept, and it outlives the flag it
 * settled — which is how a reader knows the last change was looked at rather
 * than missed.
 */
test('the judgement stays on screen after the flag it settled is gone', () => {
	flag({
		flagged: false,
		dismissal: { by: 'memoksin', at: AT, reason: 'The endpoints never read it.' },
	})

	expect(screen.getByText(/memoksin set an earlier flag aside/)).toBeTruthy()
	expect(screen.getByText(/The endpoints never read it/)).toBeTruthy()
})

test('a flagged node offers §7.2’s three and says what moved', () => {
	flag()

	expect(screen.getByText(/answered after its brief was approved/)).toBeTruthy()
	for (const label of ['It is fine anyway', 'Run it again', 'Open a node for the fix'])
		expect(screen.getByRole('button', { name: label })).toBeTruthy()
})

/**
 * The two that take words ask before they act. A dismissal with nothing in it
 * is a mute button, and §7.2 asks for a judgement.
 */
test('dismissing asks for the reason first, and will not send without one', () => {
	const onDismiss = vi.fn(nothing)
	flag({ onDismiss })

	fireEvent.click(screen.getByRole('button', { name: 'It is fine anyway' }))
	const send = screen.getByRole('button', { name: 'Set it aside' })
	expect((send as HTMLButtonElement).disabled).toBe(true)

	// Whitespace is not a reason.
	fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } })
	expect((send as HTMLButtonElement).disabled).toBe(true)

	fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Fine as it is.' } })
	fireEvent.click(send)
	expect(onDismiss).toHaveBeenCalledWith('Fine as it is.')
})

test('opening a node for the fix asks for a title, and the wording is its own', () => {
	const onOpen = vi.fn(nothing)
	flag({ onOpen })

	fireEvent.click(screen.getByRole('button', { name: 'Open a node for the fix' }))
	expect(screen.getByText('What the fix is')).toBeTruthy()

	fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Re-read the store' } })
	fireEvent.click(screen.getByRole('button', { name: 'Open it' }))
	expect(onOpen).toHaveBeenCalledWith('Re-read the store')
})

/**
 * Reopening takes no words — and it is not `run`. It clears what made the node
 * done and stops, because approving and starting have never been one step.
 */
test('running it again acts on the click, with nothing to fill in', () => {
	const onReopen = vi.fn(nothing)
	flag({ onReopen })

	fireEvent.click(screen.getByRole('button', { name: 'Run it again' }))
	expect(onReopen).toHaveBeenCalled()
	expect(screen.queryByRole('textbox')).toBeNull()
})

test('a refusal from core is shown, never swallowed into a button that does nothing', async () => {
	flag({ onReopen: () => Promise.reject(new Error('auth-api-k7f2 is not finished')) })

	fireEvent.click(screen.getByRole('button', { name: 'Run it again' }))

	expect(await screen.findByText('auth-api-k7f2 is not finished')).toBeTruthy()
})

test('never mind puts the buttons back and drops what was typed', () => {
	flag()

	fireEvent.click(screen.getByRole('button', { name: 'It is fine anyway' }))
	fireEvent.change(screen.getByRole('textbox'), { target: { value: 'half a thought' } })
	fireEvent.click(screen.getByRole('button', { name: 'Never mind' }))

	expect(screen.queryByRole('textbox')).toBeNull()
	expect(screen.getByRole('button', { name: 'It is fine anyway' })).toBeTruthy()
})
