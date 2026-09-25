import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Checks, Node, Run } from '@besober/schema'
import { beforeEach, expect, test, vi } from 'vitest'
import { archiveDecision } from './archive.js'
import { autoAccept, autoApprove, autoDispatch, autoGate } from './auto.js'
import { initBoard } from './board.js'
import { applySetting } from './config.js'
import { approveBrief } from './decide.js'
import { loadBoard } from './graph.js'
import { readLog, writeFeedback, writeRun } from './local.js'
import { acquire } from './lock.js'
import type { Paths } from './paths.js'
import { aDecision, aNode, aRun } from './records.fixture.js'
import { readNode, writeDecision, writeNode } from './records.js'
import { tmpRoot } from './tmp.fixture.js'

// Counts finished board reads, so the concurrency test knows the gate's first
// read is done before it opens a decision.
const loaded = vi.hoisted(() => ({ count: 0 }))
vi.mock('./graph.js', async (original) => {
	const real = await original<typeof import('./graph.js')>()
	return {
		...real,
		loadBoard: async (paths: Paths) => {
			const board = await real.loadBoard(paths)
			loaded.count++
			return board
		},
	}
})

const NODE = 'auth-api-k7f2'
const BASE = 'development'
const AT = '2026-09-04T00:00:00.000Z'
const LATER = '2026-09-05T00:00:00.000Z'
const auto = { invokedBy: 'memoksin', base: BASE }
const brief = {
	approach: 'Endpoints first.',
	complexity: 3,
	acceptance: [{ run: 'pnpm test', proves: 'They answer.' }],
	approval: null,
}
const approved = { ...brief, approval: { by: 'memoksin', at: AT, queue: false } }

let paths: Paths

beforeEach(async () => {
	loaded.count = 0
	const root = await tmpRoot('sober-auto-')
	paths = (await initBoard(root, { title: 'Acme', intent: '', constraints: [] })).paths
	await applySetting(paths, ['dispatch', 'base'], BASE)
	await writeNode(paths, NODE, aNode({ files: ['src/auth/**'], brief }))
})

const put = (overrides: Partial<Node>, id = NODE) =>
	writeNode(paths, id, aNode({ files: ['src/auth/**'], brief, ...overrides }))

const gate = (transition: 'approve' | 'dispatch' | 'accept' = 'approve', options = auto) =>
	autoGate(paths, NODE, transition, options)

const inReview = async (run: Partial<Run> = {}) => {
	await put({ brief: approved })
	await writeRun(
		paths,
		'run-1',
		aRun(NODE, { endedAt: AT, exit: 'finished', acceptance: [{ exit: 0 }], ...run }),
	)
}

test('a clean board lets every transition through at the status it expects', async () => {
	expect(await gate('approve')).toEqual([])
	await put({ brief: approved })
	expect(await gate('dispatch')).toEqual([])
	await inReview()
	expect(await gate('accept')).toEqual([])
})

test('an open decision anywhere holds auto, even one this node does not bind', async () => {
	await writeDecision(paths, 'elsewhere-k7f2', aDecision())
	expect(await gate()).toEqual([expect.stringMatching(/open decisions: elsewhere-k7f2/)])
})

test('a draft decision is open too', async () => {
	await writeDecision(paths, 'elsewhere-k7f2', aDecision({ suggested: 'cookie' }))
	expect((await gate()).join()).toMatch(/open decisions/)
})

test('an archived decision is not open', async () => {
	await writeDecision(paths, 'elsewhere-k7f2', aDecision())
	await archiveDecision(paths, 'elsewhere-k7f2')
	expect(await gate()).toEqual([])
})

test('a broken record refuses', async () => {
	await writeFile(join(paths.nodes, 'torn-k7f2.json'), '{ "title": ')
	expect((await gate()).join()).toMatch(/broken records/)
})

test('a cycle refuses', async () => {
	await put({ dependsOn: ['loop-b-k7f2'], files: [] }, 'loop-a-k7f2')
	await put({ dependsOn: ['loop-a-k7f2'], files: [] }, 'loop-b-k7f2')
	expect((await gate()).join()).toMatch(/cycle/)
})

test('a claim by someone else refuses, and the invoker’s own does not', async () => {
	await put({ claim: { by: 'someone', at: AT } })
	expect((await gate()).join()).toMatch(/claimed by someone/)
	await put({ claim: { by: 'MemoKsin', at: AT } })
	expect(await gate()).toEqual([])
})

test('an active node on the same files refuses', async () => {
	await put({ claim: { by: 'someone', at: AT } }, 'auth-ui-k7f2')
	expect((await gate()).join()).toMatch(/share its files: auth-ui-k7f2/)
})

test('a node flagged by a changed decision refuses', async () => {
	await writeDecision(
		paths,
		'store-k7f2',
		aDecision({ answer: { option: 'cookie', rationale: '', by: 'x', at: LATER, derived: null } }),
	)
	await put({ brief: approved, decisions: ['store-k7f2'] })
	expect((await gate('dispatch')).join()).toMatch(/flagged/)
})

test('a node with no brief refuses, naming both the status and the brief', async () => {
	await put({ brief: null })
	const reasons = (await gate()).join()
	expect(reasons).toMatch(/needs-brief/)
	expect(reasons).toMatch(/no brief/)
})

test('the wrong status refuses: a ready node is not approved again', async () => {
	await put({ brief: approved })
	expect((await gate('approve')).join()).toMatch(/is ready, and approve needs it needs-approval/)
})

test('a node not on the board refuses', async () => {
	expect(await autoGate(paths, 'nope-k7f2', 'approve', auto)).toEqual([
		'nope-k7f2 is not on this board',
	])
})

test('no configured base refuses, and says to set it', async () => {
	await applySetting(paths, ['dispatch', 'base'], null)
	expect((await gate()).join()).toMatch(/dispatch.base is not set .* set it/)
})

test('a base other than the configured one refuses', async () => {
	expect((await gate('approve', { ...auto, base: 'feature' })).join()).toMatch(
		/not the configured base/,
	)
})

test('main, master and release branches refuse even when configured', async () => {
	for (const base of ['main', 'master', 'release/1.2', 'release-1.2']) {
		await applySetting(paths, ['dispatch', 'base'], base)
		expect((await gate('approve', { ...auto, base })).join()).toMatch(/release/)
	}
})

test('dispatch never retries a run that failed or was stopped', async () => {
	await put({ brief: approved })
	for (const exit of ['failed', 'stopped'] as const) {
		await writeRun(paths, 'run-1', aRun(NODE, { endedAt: AT, exit }))
		await expect(autoDispatch(paths, NODE, auto)).rejects.toMatchObject({
			code: 'auto-refused',
			reasons: [expect.stringMatching(/never retries/)],
		})
	}
})

test('dispatch never retries a node a human rejected', async () => {
	await inReview()
	await writeFeedback(paths, NODE, { at: LATER, by: 'memoksin', text: 'no', clean: false })
	await expect(autoDispatch(paths, NODE, auto)).rejects.toMatchObject({
		reasons: [expect.stringMatching(/rejected before/)],
	})
})

const PASSING: Checks = { kind: 'passing' }

test('accept refuses every inconclusive or failing input, and leaves the node in review', async () => {
	const cases: [Partial<Run>, Parameters<typeof autoAccept>[2], RegExp][] = [
		[{}, { ...auto, scan: 'did-not-run', ci: PASSING }, /scan reads did-not-run/],
		[{}, { ...auto, scan: 'findings', ci: PASSING }, /scan reads findings/],
		[{ acceptance: [null] }, { ...auto, scan: 'clean', ci: PASSING }, /reads did-not-run/],
		[{ acceptance: [{ exit: 1 }] }, { ...auto, scan: 'clean', ci: PASSING }, /reads failed/],
		[{}, { ...auto, scan: 'clean', ci: { kind: 'unavailable', reason: 'x' } }, /CI is unavailable/],
		[{}, { ...auto, scan: 'clean', ci: { kind: 'pending' } }, /CI is pending/],
		[{}, { ...auto, scan: 'clean', ci: { kind: 'failing', failed: ['t'] } }, /CI is failing/],
	]
	for (const [run, options, reason] of cases) {
		await inReview(run)
		await expect(autoAccept(paths, NODE, options)).rejects.toMatchObject({
			code: 'auto-refused',
			reasons: [expect.stringMatching(reason)],
		})
		const record = await readNode(paths, NODE)
		expect(record.kind === 'ok' && record.value.accepted).toBe(null)
	}
})

test('an autonomous approval is recorded as one, on the record and in the log', async () => {
	await autoApprove(paths, NODE, auto)

	const record = await readNode(paths, NODE)
	expect(record.kind === 'ok' && record.value.brief?.approval).toMatchObject({
		by: 'memoksin',
		queue: false,
		autonomous: { invocation: 'sober:auto', invokedBy: 'memoksin' },
	})
	const { events } = await readLog(paths)
	expect(events.find((event) => event.action === 'brief.approved')).toMatchObject({
		autonomous: { invocation: 'sober:auto', invokedBy: 'memoksin' },
	})
})

test('a decision opened after the gate passed but before the locked write refuses, and writes nothing', async () => {
	const held = await acquire(paths, 'test')
	const approving = autoApprove(paths, NODE, auto)
	void approving.catch(() => {})
	// The first read is done: whatever opens now is only seen under the lock.
	await vi.waitFor(() => expect(loaded.count).toBe(1))
	await writeDecision(paths, 'late-k7f2', aDecision())
	await held.release()

	await expect(approving).rejects.toMatchObject({
		code: 'auto-refused',
		reasons: [expect.stringMatching(/open decisions: late-k7f2/)],
	})
	expect(loaded.count).toBe(2)
	const record = await readNode(paths, NODE)
	expect(record.kind === 'ok' && record.value.brief?.approval).toBe(null)
})

test('a human approval carries no provenance, is not held by the auto-only rule, and loads', async () => {
	await writeDecision(paths, 'elsewhere-k7f2', aDecision())
	await approveBrief(paths, NODE, { by: 'memoksin' })

	const record = await readNode(paths, NODE)
	expect(record.kind === 'ok' && record.value.brief?.approval).not.toHaveProperty('autonomous')
	expect((await loadBoard(paths)).broken).toEqual([])
})
