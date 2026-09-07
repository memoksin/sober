import type { Distribution } from '@besober/schema'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { DistributionScreen } from './Distribution.js'

afterEach(cleanup)

const plan: Distribution = {
	by: 'alice',
	at: '2026-09-08T09:00:00.000Z',
	matches: [{ node: 'auth-api-k7f2', handle: 'alice', because: 'she wrote the schema' }],
	skipped: ['db-setup-4t7w'],
}

const screenWith = (props: Partial<Parameters<typeof DistributionScreen>[0]> = {}) =>
	render(
		<DistributionScreen
			plan={plan}
			nodes={[
				{
					id: 'auth-api-k7f2',
					title: 'The auth API',
					status: 'ready',
					dependsOn: [],
					flagged: false,
				},
			]}
			onAccept={vi.fn()}
			onDrop={vi.fn()}
			onClose={vi.fn()}
			{...props}
		/>,
	)

test('the reason each node was matched is on the screen, not only the handle', () => {
	screenWith()

	expect(screen.getByText('she wrote the schema')).toBeTruthy()
	expect(screen.getByText('The auth API')).toBeTruthy()
})

test('what was passed over is named, so eight of twelve does not read as a plan that gave up', () => {
	screenWith()

	expect(screen.getByText(/passed over/)).toBeTruthy()
})

test('both ways out are on the screen — accepting is not the only exit', () => {
	const onAccept = vi.fn()
	const onDrop = vi.fn()
	screenWith({ onAccept, onDrop })

	fireEvent.click(screen.getByRole('button', { name: /assign/i }))
	expect(onAccept).toHaveBeenCalledOnce()

	fireEvent.click(screen.getByRole('button', { name: /drop/i }))
	expect(onDrop).toHaveBeenCalledOnce()
})

test('a plan that proposed nothing offers no way to assign it', () => {
	screenWith({ plan: { ...plan, matches: [] } })

	expect(screen.queryByRole('button', { name: /assign/i })).toBeNull()
	expect(screen.getByRole('button', { name: /drop/i })).toBeTruthy()
})
