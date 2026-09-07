import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

// The canvas is Cytoscape, and Cytoscape needs a layout engine `happy-dom` does
// not have. What is under test here is the board's wiring — the poll, the plan
// and what the two buttons send — so the drawing is stood in for.
vi.mock('./canvas/Canvas.js', () => ({
	Canvas: () => <div data-testid="canvas" />,
}))

const { App } = await import('./App.js')

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
})

const projection = {
	nodes: [
		{
			id: 'auth-api-k7f2',
			title: 'The auth API',
			status: 'ready',
			dependsOn: [],
			flagged: false,
		},
	],
}

// What `refresh` reads after an operation. Nothing renders it while no drawer
// is open; it is here so the refresh resolves rather than rejecting into the
// test run.
const board = { project: null, nodes: [], decisions: [], broken: [] }

const plan = {
	by: 'alice',
	at: '2026-09-08T09:00:00.000Z',
	matches: [{ node: 'auth-api-k7f2', handle: 'alice', because: 'the api is hers' }],
	skipped: [],
}

/**
 * The server, answered by hand. A read named in `reads` is served; one that is
 * not comes back as a refusal, which is how a failing plan read is arranged
 * without touching any other one.
 */
const serving = (reads: Record<string, unknown>) => {
	const sent: string[] = []
	vi.stubGlobal('fetch', (url: string, init?: { method?: string }) => {
		const address = String(url)
		if (init?.method === 'POST') {
			sent.push(address.replace('/op/', ''))
			return Promise.resolve(new Response('{}', { status: 200 }))
		}
		const name = address.replace('/read/', '').split('?')[0] ?? ''
		return name in reads
			? Promise.resolve(new Response(JSON.stringify(reads[name]), { status: 200 }))
			: Promise.resolve(new Response('{"error":"that record is not here"}', { status: 409 }))
	})
	return sent
}

test('a plan waiting on the board is announced, with its size and whose it is', async () => {
	serving({ projection, distribution: plan, digest: null })

	render(<App token="t" />)

	await waitFor(() => expect(screen.getByText(/A distribution is waiting/)).toBeTruthy())
	expect(screen.getByText(/1 node proposed by alice/)).toBeTruthy()
})

test('a board with no plan on it says nothing about one', async () => {
	serving({ projection, distribution: null, digest: null })

	render(<App token="t" />)

	await waitFor(() => expect(screen.getByTestId('canvas')).toBeTruthy())
	expect(screen.queryByText(/A distribution is waiting/)).toBeNull()
})

/**
 * §8.4 at the one place this feature could break it: the plan's read goes out
 * beside the projection's and both are awaited together. One bad record has
 * never taken the board down, and a read added to the poll is how that stops
 * being true.
 */
test('a plan that cannot be read is its own line, and the canvas keeps drawing', async () => {
	serving({ projection, digest: null })

	render(<App token="t" />)

	await waitFor(() => expect(screen.getByText(/cannot be read/)).toBeTruthy())
	expect(screen.getByTestId('canvas')).toBeTruthy()
	expect(screen.getByText('1 nodes')).toBeTruthy()
})

test('the plan opens as a screen, and taking it sends the operation that assigns', async () => {
	const sent = serving({ projection, distribution: plan, digest: null, board })

	render(<App token="t" />)
	await waitFor(() => expect(screen.getByText(/A distribution is waiting/)).toBeTruthy())

	fireEvent.click(screen.getByText(/A distribution is waiting/))
	expect(screen.getByText('the api is hers')).toBeTruthy()

	fireEvent.click(screen.getByRole('button', { name: /assign/i }))
	await waitFor(() => expect(sent).toContain('accept_distribution'))
})

test('dropping sends the other one, and neither is sent by opening the screen', async () => {
	const sent = serving({ projection, distribution: plan, digest: null, board })

	render(<App token="t" />)
	await waitFor(() => expect(screen.getByText(/A distribution is waiting/)).toBeTruthy())

	fireEvent.click(screen.getByText(/A distribution is waiting/))
	expect(sent).toEqual([])

	fireEvent.click(screen.getByRole('button', { name: /drop/i }))
	await waitFor(() => expect(sent).toContain('drop_distribution'))
	expect(sent).not.toContain('accept_distribution')
})
