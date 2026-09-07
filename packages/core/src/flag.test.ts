import { beforeEach, describe, expect, test } from 'vitest'
import { initBoard } from './board.js'
import { NotOnBoardError } from './errors.js'
import { createNode, dismissFlag, reopenNode } from './flag.js'
import { readLog } from './local.js'
import type { Paths } from './paths.js'
import { aDecision, aNode } from './records.fixture.js'
import { readNode, writeDecision, writeNode } from './records.js'
import { tmpRoot } from './tmp.fixture.js'

const AT = '2026-09-04T00:00:00.000Z'

/**
 * DESIGN §7.2's three actions, on a board on disk: each one writes a record,
 * and none of them happens to any node but the one named. Automatic re-running
 * is what §7.2 refuses, so every one of these is a thing a person did.
 */
describe('on a board', () => {
	let paths: Paths

	beforeEach(async () => {
		const root = await tmpRoot('sober-flag-')
		paths = (await initBoard(root, { title: 'Acme', intent: '', constraints: [] })).paths
		await writeNode(
			paths,
			'auth-api-k7f2',
			aNode({
				title: 'The auth API',
				accepted: { by: 'memoksin', at: AT, flagged: true, scan: 'clean', audit: 'passed' },
			}),
		)
		await writeDecision(paths, 'auth-model-k7f2', aDecision({}))
	})

	test('a dismissal is kept, with who wrote it and why', async () => {
		const node = await dismissFlag(paths, 'auth-api-k7f2', {
			by: 'memoksin',
			reason: 'The endpoints never read the session store.',
		})

		expect(node.dismissal?.by).toBe('memoksin')
		expect(node.dismissal?.reason).toBe('The endpoints never read the session store.')
		// Stored, so a teammate's clone knows the flag was dealt with (§7.2).
		const written = await readNode(paths, 'auth-api-k7f2')
		expect(written.kind === 'ok' && written.value.dismissal?.reason).toBe(
			'The endpoints never read the session store.',
		)
	})

	test('a dismissal with nothing in it is refused — the reason is the record', async () => {
		await expect(
			dismissFlag(paths, 'auth-api-k7f2', { by: 'memoksin', reason: '   ' }),
		).rejects.toThrow('reason')
	})

	test('reopening clears what made the node done, and nothing else', async () => {
		const node = await reopenNode(paths, 'auth-api-k7f2', 'memoksin')

		expect(node.accepted).toBeNull()
		expect(node.title).toBe('The auth API')
	})

	test('a node that was never accepted has nothing to reopen', async () => {
		await writeNode(paths, 'plain-node-m3q8', aNode({}))

		await expect(reopenNode(paths, 'plain-node-m3q8', 'memoksin')).rejects.toThrow('not finished')
	})

	test('opening a node for the fix writes it, bound to what it corrects', async () => {
		const { id, node } = await createNode(paths, {
			title: 'Re-check the session store reads',
			by: 'memoksin',
			dependsOn: ['auth-api-k7f2'],
			decisions: ['auth-model-k7f2'],
		})

		expect(id).toMatch(/^re-check-the-session-store-reads-[a-z0-9]+$/)
		expect(node.dependsOn).toEqual(['auth-api-k7f2'])
		expect(node.decisions).toEqual(['auth-model-k7f2'])
		// No brief and nothing approved: the fix is work to be planned, not work
		// to be started (§3.2 — nothing runs without an approved brief).
		expect(node.brief).toBeNull()
	})

	test('a new node bound to a node that is not here is refused', async () => {
		await expect(
			createNode(paths, { title: 'A fix', by: 'memoksin', dependsOn: ['gone-x9y8'] }),
		).rejects.toThrow(NotOnBoardError)
	})

	test('all three are on the audit log — a person did each of them', async () => {
		await dismissFlag(paths, 'auth-api-k7f2', { by: 'memoksin', reason: 'Fine as it is.' })
		await reopenNode(paths, 'auth-api-k7f2', 'memoksin')
		await createNode(paths, { title: 'A fix', by: 'memoksin' })

		expect((await readLog(paths)).events.map((event) => event.action)).toEqual([
			'node.dismissed',
			'node.reopened',
			'node.created',
		])
	})
})
