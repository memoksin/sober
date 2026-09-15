import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { beforeEach, expect, test } from 'vitest'
import { initBoard } from './board.js'
import { stopRun } from './dispatch.js'
import { loadBoard } from './graph.js'
import { readRun, writeRunPid } from './local.js'
import type { Paths } from './paths.js'
import { aNode } from './records.fixture.js'
import { writeNode } from './records.js'
import { startRun } from './run.js'
import { statusOf } from './status.js'
import { tmpRoot } from './tmp.fixture.js'

let paths: Paths

beforeEach(async () => {
	const root = await tmpRoot('sober-dispatch-')
	paths = (await initBoard(root, { title: 'Acme', intent: 'ship', constraints: [] })).paths
	await writeNode(paths, 'auth-api-k7f2', aNode())
})

test('stopping a run whose owning process is gone closes it as failed', async () => {
	const started = await startRun(paths, 'auth-api-k7f2', 'claude-code')
	// A pid that just exited, so it cannot collide with a live process.
	const child = spawn(process.execPath, ['-e', ''])
	await once(child, 'exit')
	await writeRunPid(paths, started.id, child.pid as number)

	expect(await stopRun(paths, started.id)).toBe(false)

	const run = await readRun(paths, started.id)
	expect(run).toMatchObject({ value: { exit: 'failed', error: expect.stringMatching(/gone/) } })
	expect(statusOf(await loadBoard(paths), 'auth-api-k7f2')).not.toBe('running')
	await expect(startRun(paths, 'auth-api-k7f2', 'claude-code')).resolves.toBeDefined()
})
