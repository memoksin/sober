import type { Conflict } from '@besober/core'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ConflictScreen } from './Conflicts.js'

afterEach(cleanup)

const first: Conflict = {
	kind: 'fields',
	path: 'n/a.json',
	id: 'a',
	fields: [
		{ field: 'title', ours: 'Ours title', theirs: 'Their title' },
		{ field: 'status', ours: 'ready', theirs: 'done' },
	],
}
const second: Conflict = { kind: 'archived', path: 'n/b.json', id: 'b', by: 'ours' }

const submit = () => screen.getByRole('button', { name: /answer and/ }) as HTMLButtonElement

test('nothing is checked and the submit waits for every field', () => {
	render(
		<ConflictScreen conflicts={[first]} resolve={vi.fn()} onDone={vi.fn()} onClose={vi.fn()} />,
	)
	for (const radio of screen.getAllByRole('radio'))
		expect((radio as HTMLInputElement).checked).toBe(false)
	expect(submit().disabled).toBe(true)
	expect(screen.getByText('Still to answer: title, status')).toBeTruthy()
	fireEvent.click(screen.getAllByRole('radio', { name: /ours/ })[0] as HTMLElement)
	expect(submit().disabled).toBe(true)
	expect(screen.getByText('Still to answer: status')).toBeTruthy()
})

test('each record sends exactly its choices, and the last one ends in onDone', async () => {
	const resolve = vi
		.fn()
		.mockResolvedValueOnce({ kind: 'recorded', left: [second], findings: [] })
		.mockResolvedValueOnce({ kind: 'done', left: [], findings: [] })
	const onDone = vi.fn()
	render(
		<ConflictScreen
			conflicts={[first, second]}
			resolve={resolve}
			onDone={onDone}
			onClose={vi.fn()}
		/>,
	)

	const [titleOurs, , statusOurs, statusTheirs] = screen.getAllByRole('radio')
	fireEvent.click(titleOurs as HTMLElement)
	fireEvent.click(statusOurs as HTMLElement)
	fireEvent.click(statusTheirs as HTMLElement)
	fireEvent.click(submit())
	await waitFor(() => expect(screen.getByText('b changed on both sides')).toBeTruthy())
	expect(resolve).toHaveBeenCalledWith('a', { title: 'ours', status: 'theirs' })
	expect(onDone).not.toHaveBeenCalled()

	for (const radio of screen.getAllByRole('radio'))
		expect((radio as HTMLInputElement).checked).toBe(false)
	fireEvent.click(screen.getByRole('radio', { name: /restore/ }))
	fireEvent.click(submit())
	await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
	expect(resolve).toHaveBeenLastCalledWith('b', { record: 'restore' })
})

test('closing partway sends nothing further', () => {
	const resolve = vi.fn()
	const onClose = vi.fn()
	render(
		<ConflictScreen conflicts={[first]} resolve={resolve} onDone={vi.fn()} onClose={onClose} />,
	)
	fireEvent.click(screen.getAllByRole('radio')[0] as HTMLElement)
	fireEvent.click(screen.getByRole('button', { name: 'Close' }))
	expect(onClose).toHaveBeenCalledTimes(1)
	expect(resolve).not.toHaveBeenCalled()
})
