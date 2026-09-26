import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

// The canvas is Cytoscape, and Cytoscape needs a layout engine `happy-dom` does
// not have. What is under test here is the board's wiring — the poll, the plan
// and what the two buttons send — so the drawing is stood in for.
vi.mock('./canvas/Canvas.js', () => ({
	Canvas: ({ onPick }: { readonly onPick?: (id: string | null) => void }) => (
		<div data-testid="canvas">
			<button type="button" onClick={() => onPick?.('auth-api-k7f2')}>
				auth-api-k7f2
			</button>
		</div>
	),
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

test('known host windows show usage and their reset times', async () => {
	serving({
		projection,
		distribution: null,
		digest: null,
		availability: {
			claude: { windows: { 'five-hour': { used: 0.92, resetsAt: 1_790_453_168 } } },
		},
	})
	render(<App token="t" />)
	await waitFor(() => expect(screen.getByText(/claude five-hour: 92% used/)).toBeTruthy())
	expect(screen.getByText(/resets/)).toBeTruthy()
})

/**
 * The server, answered by hand. A read named in `reads` is served; one that is
 * not comes back as a refusal, which is how a failing plan read is arranged
 * without touching any other one.
 */
const serving = (
	reads: Record<string, unknown>,
	ops: Record<string, () => Promise<Response>> = {},
) => {
	const sent: string[] = []
	vi.stubGlobal('fetch', (url: string, init?: { method?: string }) => {
		const address = String(url)
		if (init?.method === 'POST') {
			const name = address.replace('/op/', '')
			sent.push(name)
			return ops[name]?.() ?? Promise.resolve(new Response('{}', { status: 200 }))
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

const aNode = (status: string) => ({
	id: 'auth-api-k7f2',
	title: 'The auth API',
	name: 'The auth API',
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
	createdAt: '2026-09-04T00:00:00.000Z',
	status,
	waitingOn: [],
})

const inReviewProjection = {
	nodes: [
		{
			id: 'auth-api-k7f2',
			title: 'The auth API',
			status: 'in-review',
			dependsOn: [],
			flagged: false,
		},
	],
}

const inReviewBoard = { project: null, nodes: [aNode('in-review')], decisions: [], broken: [] }

const reviewOf = (result: 'failed' | 'passed') => ({
	node: 'auth-api-k7f2',
	scan: { result: 'clean', ruleSet: 'default', findings: [], didNotRun: [], files: [] },
	diff: '',
	files: [],
	run: 'run-1',
	exit: null,
	acceptance: [
		{
			run: 'pnpm test',
			proves: 'the login form validates',
			result: result === 'passed' ? { exit: 0 } : { exit: 1 },
		},
	],
	verify: null,
	ci: { kind: 'none' },
	pr: null,
	uncommitted: [],
	accepted: null,
	flagged: false,
})

test('re-running the checks from the review screen sends `audit` and replaces what it shows', async () => {
	let audited = false
	const sent: string[] = []
	vi.stubGlobal('fetch', (url: string, init?: { method?: string }) => {
		const address = String(url)
		if (init?.method === 'POST') {
			const name = address.replace('/op/', '')
			sent.push(name)
			if (name === 'audit') audited = true
			return Promise.resolve(new Response('{}', { status: 200 }))
		}
		const name = address.replace('/read/', '').split('?')[0] ?? ''
		const reads: Record<string, unknown> = {
			projection: inReviewProjection,
			distribution: null,
			digest: null,
			board: inReviewBoard,
			review: reviewOf(audited ? 'passed' : 'failed'),
		}
		return name in reads
			? Promise.resolve(new Response(JSON.stringify(reads[name]), { status: 200 }))
			: Promise.resolve(new Response('{"error":"that record is not here"}', { status: 409 }))
	})

	render(<App token="t" />)

	await waitFor(() => expect(screen.getByTestId('canvas')).toBeTruthy())
	fireEvent.click(screen.getByText('auth-api-k7f2'))
	await waitFor(() => expect(screen.getByText('Review')).toBeTruthy())
	fireEvent.click(screen.getByText('Review'))

	await waitFor(() => expect(screen.getByText('failed · exit 1')).toBeTruthy())

	fireEvent.click(screen.getByText('Run the checks again'))
	expect(screen.getByText('Running the acceptance list…')).toBeTruthy()

	await waitFor(() => expect(screen.getByText('passed')).toBeTruthy())
	expect(sent).toContain('audit')
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

test('the decision list mounts only when opened, and Escape closes it alone', async () => {
	serving({ projection, distribution: null, digest: null, board })

	render(<App token="t" />)
	await waitFor(() => expect(screen.getByTestId('canvas')).toBeTruthy())
	expect(screen.queryByText('What this project has decided')).toBeNull()

	fireEvent.click(screen.getByRole('button', { name: 'decisions' }))
	await waitFor(() => expect(screen.getByText('What this project has decided')).toBeTruthy())

	fireEvent.keyDown(window, { key: 'Escape' })
	await waitFor(() => expect(screen.queryByText('What this project has decided')).toBeNull())
	expect(screen.getByTestId('canvas')).toBeTruthy()
})

const syncResult = {
	kind: 'synced',
	committed: false,
	pulled: { updated: [], removed: [] },
	pushed: false,
	conflicts: [],
	findings: [],
	outgoing: false,
}

const answering = (result: unknown) => ({
	sync: () => Promise.resolve(new Response(JSON.stringify(result), { status: 200 })),
})

const pressSync = async (
	reads: Record<string, unknown>,
	ops: Record<string, () => Promise<Response>>,
) => {
	const sent = serving(reads, ops)
	render(<App token="t" />)
	await waitFor(() => expect(screen.getByTestId('canvas')).toBeTruthy())
	fireEvent.click(screen.getByRole('button', { name: 'sync' }))
	return sent
}

const reads = { projection, distribution: null, digest: null, board }

test('a synced board says what came in and what went out, and the board is read again', async () => {
	const sent = await pressSync(
		reads,
		answering({
			...syncResult,
			pulled: { updated: ['a', 'b'], removed: ['c'] },
			pushed: true,
			outgoing: true,
		}),
	)
	await waitFor(() =>
		expect(
			screen.getByText(
				'Synced: 2 records came in updated and 1 record removed, your changes went out.',
			),
		).toBeTruthy(),
	)
	expect(sent).toEqual(['sync'])
})

test('a sync where nothing moved says so', async () => {
	await pressSync(reads, answering(syncResult))
	await waitFor(() =>
		expect(screen.getByText('Synced: nothing came in, nothing went out.')).toBeTruthy(),
	)
})

test('no remote is said plainly, not as an error', async () => {
	await pressSync(reads, answering({ ...syncResult, kind: 'no-remote', committed: true }))
	await waitFor(() => expect(screen.getByText(/There is no remote to send it to/)).toBeTruthy())
	expect(screen.queryByRole('alert')).toBeNull()
})

test('an invalid merge lists its findings', async () => {
	await pressSync(
		reads,
		answering({
			...syncResult,
			kind: 'invalid',
			findings: ['x depends on a missing node', 'a cycle'],
		}),
	)
	await waitFor(() => expect(screen.getByText(/x depends on a missing node; a cycle/)).toBeTruthy())
})

test('a conflict names the records both sides changed', async () => {
	await pressSync(
		reads,
		answering({
			...syncResult,
			kind: 'conflicted',
			conflicts: [
				{ kind: 'fields', path: 'nodes/a.json', id: 'auth-api-k7f2', fields: [] },
				{ kind: 'fields', path: 'nodes/b.json', id: 'ui-9x1q', fields: [] },
			],
		}),
	)
	await waitFor(() =>
		expect(screen.getByText(/auth-api-k7f2, ui-9x1q changed on both sides/)).toBeTruthy(),
	)
	expect(screen.queryByText(/Synced/)).toBeNull()
})

test('a rejected sync renders the failure, not a success line', async () => {
	await pressSync(reads, {
		sync: () =>
			Promise.resolve(new Response('{"error":"the remote refused the push"}', { status: 500 })),
	})
	await waitFor(() =>
		expect(screen.getByRole('alert').textContent).toContain('the remote refused the push'),
	)
	expect(screen.queryByText(/Synced/)).toBeNull()
})

test('a second press while a sync is in flight sends nothing', async () => {
	let finish: (response: Response) => void = () => {}
	const sent = await pressSync(reads, {
		sync: () => new Promise<Response>((done) => (finish = done)),
	})
	const button = await screen.findByRole('button', { name: 'syncing…' })
	fireEvent.click(button)
	expect(sent).toEqual(['sync'])
	finish(new Response(JSON.stringify(syncResult), { status: 200 }))
	await waitFor(() => expect(screen.getByRole('button', { name: 'sync' })).toBeTruthy())
	expect(sent).toEqual(['sync'])
})

const level = { kind: 'ok', ahead: 0, behind: 0, remote: 'origin', pulled: null }

test.each([
	[{ ...level, behind: 3 }, '3 behind'],
	[{ ...level, ahead: 2 }, '2 unsent'],
	[{ ...level, behind: 3, ahead: 2 }, '3 behind · 2 unsent'],
	[{ ...level, behind: 4, pulled: { updated: [], removed: [] } }, 'pulled 4'],
	[{ kind: 'offline' }, 'offline'],
])('the distance %j is said as %s beside the sync button', async (distance, phrase) => {
	serving({ ...reads, distance })
	render(<App token="t" />)
	expect(await screen.findByText(phrase)).toBeTruthy()
})

test.each([level, { kind: 'no-remote' }])('%j says nothing about distance', async (distance) => {
	serving({ ...reads, distance })
	render(<App token="t" />)
	await waitFor(() => expect(screen.getByText('1 nodes')).toBeTruthy())
	expect(screen.queryByText(/behind|unsent|offline|pulled/)).toBeNull()
})

test('a distance that cannot be read leaves the header usable', async () => {
	serving(reads)
	render(<App token="t" />)
	await waitFor(() => expect(screen.getByText('1 nodes')).toBeTruthy())
	expect(screen.getByRole('button', { name: 'sync' })).toBeTruthy()
	expect(screen.getByTestId('canvas')).toBeTruthy()
})

test('a conflicted sync opens the screen, and answering the last record syncs once more', async () => {
	let syncs = 0
	const sent = await pressSync(reads, {
		sync: () =>
			Promise.resolve(
				new Response(
					JSON.stringify(
						syncs++ === 0
							? {
									...syncResult,
									kind: 'conflicted',
									conflicts: [{ kind: 'archived', path: 'n/a.json', id: 'a', by: 'theirs' }],
								}
							: { ...syncResult, pushed: true, outgoing: true },
					),
					{ status: 200 },
				),
			),
		resolve: () =>
			Promise.resolve(
				new Response(JSON.stringify({ kind: 'done', left: [], findings: [] }), { status: 200 }),
			),
	})
	const keep = await screen.findByRole('radio', { name: /keep/ })
	expect(screen.getByText(/a changed on both sides\. Each one/)).toBeTruthy()
	fireEvent.click(keep)
	fireEvent.click(screen.getByRole('button', { name: 'answer and sync' }))
	await waitFor(() =>
		expect(screen.getByText('Synced: nothing came in, your changes went out.')).toBeTruthy(),
	)
	expect(sent).toEqual(['sync', 'resolve', 'sync'])
	expect(screen.queryByRole('dialog')).toBeNull()
})
