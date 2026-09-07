import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { paths, writeDecision, writeNode } from '@besober/core'
import { type Served, serve } from '@besober/server'
import { afterEach, beforeAll, expect, test } from 'vitest'
import { createTempRepo, type TempRepo } from './fixture.js'

/**
 * One board, two surfaces, and the thing `PR-09-08` actually promises: what
 * you do on one is what the other sees. The contract test proves the
 * operations exist everywhere; this proves they mean the same thing.
 */
const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const SOBER = join(repoRoot, 'packages/cli/dist/sober.js')

beforeAll(() => {
	execFileSync(process.execPath, ['build.mjs'], { cwd: join(repoRoot, 'packages/cli') })
}, 180_000)

let repo: TempRepo | undefined
let server: Served | undefined

afterEach(async () => {
	await server?.close()
	server = undefined
	repo?.cleanup()
	repo = undefined
})

const sober = (cwd: string, ...args: string[]): string =>
	execFileSync(process.execPath, [SOBER, ...args], {
		cwd,
		encoding: 'utf8',
		env: { ...process.env, NO_COLOR: '1' },
	})

const board = (): TempRepo => {
	const made = createTempRepo()
	writeFileSync(join(made.dir, 'package.json'), '{ "name": "under-test" }\n')
	made.git('add', '-A')
	made.git('commit', '-m', 'first')
	sober(made.dir, 'init')
	return made
}

const post = async (operation: string, body: unknown): Promise<Response> =>
	fetch(new URL(`/op/${operation}`, server?.url), {
		method: 'POST',
		headers: {
			authorization: `Bearer ${server?.token}`,
			'content-type': 'application/json',
		},
		body: JSON.stringify(body),
	})

const get = async (read: string, query = ''): Promise<Response> =>
	fetch(new URL(`/read/${read}${query}`, server?.url), {
		headers: { authorization: `Bearer ${server?.token}` },
	})

test('an operation performed on the wire is one the command line sees', async () => {
	repo = board()
	server = await serve({ paths: paths(repo.dir) })

	const added = await post('contributors_add', {
		contributor: { handle: 'Ada', name: 'Ada Lovelace', role: '', focus: '' },
	})

	expect(added.status).toBe(200)
	expect(sober(repo.dir, 'contributors')).toContain('Ada')
})

test('an operation performed on the command line is one the wire sees', async () => {
	repo = board()
	server = await serve({ paths: paths(repo.dir) })

	sober(repo.dir, 'contributors', 'add', 'Grace')
	const removed = await post('contributors_remove', { handle: 'Grace' })

	expect(removed.status).toBe(200)
	expect(await removed.json()).toEqual({ removed: true })
	expect(sober(repo.dir, 'contributors')).not.toContain('Grace')
})

test('removing somebody who is not there is a false, not a failure', async () => {
	repo = board()
	server = await serve({ paths: paths(repo.dir) })

	const removed = await post('contributors_remove', { handle: 'Nobody' })

	expect(removed.status).toBe(200)
	expect(await removed.json()).toEqual({ removed: false })
})

/**
 * A valid body naming a node that is not there. The parse succeeds, so the
 * handler runs and `core` is the thing that refuses — which is what separates
 * "this route reaches core" from "this route dies in its own wrapper". A wrong
 * argument order inside a handler is the one mistake typechecking cannot catch
 * on calls whose parameters share a type.
 */
const missing = 'not-on-this-board-aaaa'
const reachesCore: readonly (readonly [string, unknown])[] = [
	['bind', { node: missing, dependsOn: [] }],
	['approve', { node: missing }],
	['run', { node: missing }],
	['accept', { node: missing }],
	['reject', { node: missing, text: 'no' }],
	['archive', { node: missing }],
	['assign', { node: missing, handle: 'Ada' }],
	['claim', { node: missing }],
	['release', { node: missing }],
	['decide', { decision: missing, option: 'one' }],
]

test.each(reachesCore)('%s reaches core, and core is what refuses it', async (operation, body) => {
	repo = board()
	server = await serve({ paths: paths(repo.dir) })

	const response = await post(operation, body)

	// Not 400: the body was the right shape. Not 500: nothing broke.
	expect(response.status, await response.text()).toBe(409)
})

test('stopping a node that was never running is a false, not a refusal', async () => {
	repo = board()
	server = await serve({ paths: paths(repo.dir) })

	const response = await post('stop', { node: missing })

	// `stopRun` answers whether it stopped something, and "there was nothing"
	// is a true answer rather than an error. The wire keeps it that way.
	expect(response.status).toBe(200)
	expect(await response.json()).toEqual({ stopped: false })
})

test('the canvas is served a projection and never a record', async () => {
	repo = board()
	server = await serve({ paths: paths(repo.dir) })

	const response = await get('projection')

	expect(response.status).toBe(200)
	expect(await response.json()).toEqual({ nodes: [] })
})

test('a read the board cannot answer says so rather than answering nothing', async () => {
	repo = board()
	server = await serve({ paths: paths(repo.dir) })

	const response = await get('review', '?node=not-on-this-board-aaaa')

	// `reviewNode` answers `null` for a node that is not there, and null is a
	// real answer: the surface renders "not on this board" rather than an
	// empty review that reads like a clean one.
	expect(response.status).toBe(200)
	expect(await response.json()).toBeNull()
})

test('the board a panel reads says what each node is waiting for', async () => {
	repo = board()
	const at = '2026-09-06T00:00:00.000Z'
	const there = paths(repo.dir)

	await writeDecision(there, 'auth-model-k7f2', {
		category: 'state',
		question: 'Where does session state live?',
		options: [
			{ id: 'cookie', label: 'Cookie', reason: 'No server state', costLater: 'Size limits' },
			{ id: 'redis', label: 'Redis', reason: 'Revocable', costLater: 'A service to run' },
		],
		suggested: null,
		answer: null,
		createdAt: at,
	})
	await writeNode(there, 'auth-api-k7f2', {
		title: 'Session endpoints',
		description: '',
		notes: '',
		dependsOn: [],
		decisions: ['auth-model-k7f2'],
		files: [],
		brief: null,
		outcome: null,
		assignee: null,
		claim: null,
		accepted: null,
		dismissal: null,
		createdAt: at,
	})
	await writeNode(there, 'billing-api-m3q8', {
		title: 'Billing',
		description: '',
		notes: '',
		dependsOn: ['auth-api-k7f2'],
		decisions: [],
		files: [],
		brief: null,
		outcome: null,
		assignee: null,
		claim: null,
		accepted: null,
		dismissal: null,
		createdAt: at,
	})

	server = await serve({ paths: there })
	const read = (await (await get('board')).json()) as {
		nodes: { id: string; waitingOn: unknown }[]
	}
	const of = (id: string) => read.nodes.find((node) => node.id === id)?.waitingOn

	// The panel's whole question. Derived on the server by the same `core`
	// function the command line calls, so the two cannot come to disagree about
	// what is holding a node up.
	expect(of('auth-api-k7f2')).toEqual([
		{ kind: 'decision', id: 'auth-model-k7f2', archived: false },
	])
	expect(of('billing-api-m3q8')).toEqual([{ kind: 'node', id: 'auth-api-k7f2', archived: false }])
})

/**
 * DESIGN §2.8 over the wire: the preview is a read and the confirmation is a
 * flag on the operation (ADR 0044). What this asks is whether the screen's two
 * halves reach `core`, and whether the flag is what separates seeing from
 * saving — on the surface where the preview *is* the screen.
 */
test('the impact preview is read, and the save is the same call with the flag', async () => {
	repo = board()
	const at = '2026-09-06T00:00:00.000Z'
	const there = paths(repo.dir)

	await writeDecision(there, 'auth-model-k7f2', {
		category: 'state',
		question: 'Where does session state live?',
		options: [
			{ id: 'cookie', label: 'Cookie', reason: 'No server state', costLater: 'Size limits' },
			{ id: 'redis', label: 'Redis', reason: 'Revocable', costLater: 'A service to run' },
		],
		suggested: null,
		answer: { option: 'cookie', rationale: '', by: 'memoksin', at },
		createdAt: at,
	})
	await writeNode(there, 'auth-api-k7f2', {
		title: 'Session endpoints',
		description: '',
		notes: '',
		dependsOn: [],
		decisions: ['auth-model-k7f2'],
		files: [],
		brief: {
			approach: 'Write the endpoints.',
			acceptance: [{ run: 'pnpm test', proves: 'They answer.' }],
			approval: { by: 'memoksin', at, queue: false },
		},
		outcome: null,
		assignee: null,
		claim: null,
		accepted: null,
		dismissal: null,
		createdAt: at,
	})

	server = await serve({ paths: there })

	const preview = (await (await get('impact', '?decision=auth-model-k7f2')).json()) as {
		nodes: { id: string; effect: string; status: string }[]
	}
	expect(preview.nodes).toEqual([
		{ id: 'auth-api-k7f2', title: 'Session endpoints', status: 'ready', effect: 'rebrief' },
	])

	// A decision that is not there is a 409 rather than an empty fan-out: an
	// empty preview and a decision nobody has are opposite facts (§8.7).
	expect((await get('impact', '?decision=gone-x9y8')).status).toBe(409)

	// The read wrote nothing, and the edit without the flag writes nothing
	// either — it comes back with the fan-out the screen already rendered.
	const refused = await post('edit_decision', { decision: 'auth-model-k7f2', option: 'redis' })
	expect(refused.status).toBe(409)
	expect(((await refused.json()) as { error: string }).error).toContain('auth-api-k7f2')
	expect(sober(repo.dir, 'decisions')).not.toContain('Redis')

	const saved = await post('edit_decision', {
		decision: 'auth-model-k7f2',
		option: 'redis',
		anyway: true,
	})
	expect(saved.status).toBe(200)
	// §2.8's first row, seen from the other surface: the brief is gone and the
	// node is back to being briefed against the answer that now stands.
	expect(sober(repo.dir, 'status')).toContain('needs-brief')
})

/**
 * DESIGN §7.1's read, over the wire. The delta half is proven against real git
 * in `digest.test.ts`; what this asks is whether the route reaches it — and
 * whether `fetch` survives being a query string, which is the one part of this
 * read that only exists on the wire.
 */
test('the digest is served, and its two halves arrive separately', async () => {
	repo = board()
	const there = paths(repo.dir)
	const at = '2026-09-06T00:00:00.000Z'

	await writeDecision(there, 'auth-model-k7f2', {
		category: 'state',
		question: 'Where does session state live?',
		options: [
			{ id: 'cookie', label: 'Cookie', reason: 'No server state', costLater: 'Size limits' },
			{ id: 'redis', label: 'Redis', reason: 'Revocable', costLater: 'A service to run' },
		],
		suggested: null,
		// Answered after the brief below was approved, which is what §2.8 calls
		// a flag: the work was approved against an answer that has since moved.
		answer: { option: 'cookie', rationale: '', by: 'Ada', at: '2026-09-06T02:00:00.000Z' },
		createdAt: at,
	})
	await writeNode(there, 'auth-api-k7f2', {
		title: 'Session endpoints',
		description: '',
		notes: '',
		dependsOn: [],
		decisions: ['auth-model-k7f2'],
		files: [],
		brief: {
			approach: 'Write the endpoints.',
			acceptance: [{ run: 'pnpm test', proves: 'They answer.' }],
			approval: { by: 'Ada', at: '2026-09-06T01:00:00.000Z', queue: false },
		},
		outcome: null,
		assignee: null,
		claim: null,
		accepted: null,
		dismissal: null,
		createdAt: at,
	})

	server = await serve({ paths: there })
	const response = await get('digest')
	expect(response.status).toBe(200)

	const seen = (await response.json()) as {
		delta: unknown
		unreachable: string | null
		inReview: string[]
		flagged: string[]
	}

	// Nothing has been synced, so there is nothing to diff — and the snapshot
	// half answers anyway, which is the property §7.1 is built on.
	expect(seen.delta).toBeNull()
	expect(seen.unreachable).toContain('sober sync')
	expect(seen.flagged).toEqual(['auth-api-k7f2'])
	expect(seen.inReview).toEqual([])
})

test('the digest fetches only when the caller asks it to', async () => {
	repo = board()
	server = await serve({ paths: paths(repo.dir) })

	// §1.2 permits an automatic fetch; the flag is what keeps it something the
	// caller asks for rather than something the route does on every poll.
	expect((await get('digest', '?fetch=true')).status).toBe(200)
	expect((await get('digest', '?fetch=false')).status).toBe(200)

	// A query string is text, and text that is neither is not a boolean the
	// route guesses at.
	expect((await get('digest', '?fetch=maybe')).status).toBe(400)
})

/**
 * DESIGN §7.2, over the wire. The flag itself is derived in `core` and proven
 * there; what this asks is whether the three actions reach it and whether the
 * projection the canvas polls says which nodes to draw them on.
 */
const flaggedBoard = async (
	accepted: { by: string; at: string; flagged: boolean; scan: 'clean' } | null = null,
): Promise<ReturnType<typeof paths>> => {
	const there = paths((repo as TempRepo).dir)
	const at = '2026-09-06T00:00:00.000Z'

	await writeDecision(there, 'auth-model-k7f2', {
		category: 'state',
		question: 'Where does session state live?',
		options: [
			{ id: 'cookie', label: 'Cookie', reason: 'No server state', costLater: 'Size limits' },
			{ id: 'redis', label: 'Redis', reason: 'Revocable', costLater: 'A service to run' },
		],
		suggested: null,
		// After the approval below: §2.8's flag is a bound decision that moved
		// once the brief was already approved against the earlier answer.
		answer: { option: 'cookie', rationale: '', by: 'Ada', at: '2026-09-06T02:00:00.000Z' },
		createdAt: at,
	})
	await writeNode(there, 'auth-api-k7f2', {
		title: 'Session endpoints',
		description: '',
		notes: '',
		dependsOn: [],
		decisions: ['auth-model-k7f2'],
		files: [],
		brief: {
			approach: 'Write the endpoints.',
			acceptance: [{ run: 'pnpm test', proves: 'They answer.' }],
			approval: { by: 'Ada', at: '2026-09-06T01:00:00.000Z', queue: false },
		},
		outcome: null,
		assignee: null,
		claim: null,
		accepted,
		dismissal: null,
		createdAt: at,
	})
	return there
}

test('the canvas is told which nodes are flagged, so §7.2’s list is the board narrowed', async () => {
	repo = board()
	server = await serve({ paths: await flaggedBoard() })

	const seen = (await (await get('projection')).json()) as {
		nodes: { id: string; flagged: boolean }[]
	}
	expect(seen.nodes.find((node) => node.id === 'auth-api-k7f2')?.flagged).toBe(true)
})

test('dismissing keeps the reason, and settles the answer it was written against', async () => {
	repo = board()
	server = await serve({ paths: await flaggedBoard() })

	const refused = await post('dismiss', { node: 'auth-api-k7f2', reason: '' })
	expect(refused.status).toBe(400)

	const done = await post('dismiss', {
		node: 'auth-api-k7f2',
		reason: 'The endpoints never read the session store.',
	})
	expect(done.status).toBe(200)
	expect((await done.json()) as { dismissal: { reason: string } }).toMatchObject({
		dismissal: { reason: 'The endpoints never read the session store.' },
	})

	// The flag is off the canvas, because the change it named has been judged.
	const seen = (await (await get('projection')).json()) as {
		nodes: { id: string; flagged: boolean }[]
	}
	expect(seen.nodes.find((node) => node.id === 'auth-api-k7f2')?.flagged).toBe(false)
})

test('reopening un-finishes a node and refuses one that was never finished', async () => {
	repo = board()
	server = await serve({ paths: await flaggedBoard() })

	// Nothing has been accepted, so there is nothing to reopen — and the refusal
	// is a state refusal rather than a crash (409, not 500).
	expect((await post('reopen', { node: 'auth-api-k7f2' })).status).toBe(409)
	await server.close()

	repo.cleanup()
	repo = board()
	server = await serve({
		paths: await flaggedBoard({
			by: 'Ada',
			at: '2026-09-06T03:00:00.000Z',
			// §2.8: the human accepted anyway, and the record says so. That is
			// what puts the node in §7.2's list rather than ending the flag.
			flagged: true,
			scan: 'clean',
		}),
	})

	expect((await post('reopen', { node: 'auth-api-k7f2' })).status).toBe(200)
	const after = (await (await get('projection')).json()) as {
		nodes: { id: string; status: string }[]
	}
	// Back in the loop with its brief still approved — reopening does not run it.
	expect(after.nodes.find((node) => node.id === 'auth-api-k7f2')?.status).toBe('ready')
})

test('a node opened for the fix arrives with no brief, bound to what it corrects', async () => {
	repo = board()
	// The node it corrects is finished, which is §7.2's case: the fix is opened
	// beside work that already landed, not in front of work still running.
	server = await serve({
		paths: await flaggedBoard({
			by: 'Ada',
			at: '2026-09-06T03:00:00.000Z',
			flagged: true,
			scan: 'clean',
		}),
	})

	const made = await post('create_node', {
		title: 'Re-read the session store',
		dependsOn: ['auth-api-k7f2'],
	})
	expect(made.status).toBe(200)
	const { id } = (await made.json()) as { id: string }

	const seen = (await (await get('board')).json()) as {
		nodes: { id: string; status: string; brief: unknown; dependsOn: string[] }[]
	}
	const opened = seen.nodes.find((node) => node.id === id)
	// Nothing runs without an approved brief (§3.2), and a node opened to fix a
	// mistake is the last one that should skip being read.
	expect(opened?.brief).toBeNull()
	expect(opened?.status).toBe('needs-brief')
	expect(opened?.dependsOn).toEqual(['auth-api-k7f2'])

	// A dependency the board does not hold is refused, not written.
	expect((await post('create_node', { title: 'A fix', dependsOn: ['gone-x9y8'] })).status).toBe(409)
})
