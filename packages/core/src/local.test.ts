import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Run } from '@besober/schema'
import { beforeEach, expect, test } from 'vitest'
import { newId } from './id.js'
import {
	appendEvent,
	appendRunOutput,
	readLog,
	readRun,
	readRuns,
	runLog,
	writeRun,
} from './local.js'
import { paths } from './paths.js'

let board: ReturnType<typeof paths>

const run = (node: string): Run => ({
	node,
	host: 'claude-code',
	branch: `sober/${node}`,
	worktree: '/tmp/worktree',
	startedAt: '2026-09-04T00:00:00.000Z',
	endedAt: null,
	exit: null,
	error: null,
	verify: null,
	acceptance: [],
})

beforeEach(async () => {
	board = paths(await mkdtemp(join(tmpdir(), 'sober-local-')))
})

test('a run is one file, and its output is a second one beside it', async () => {
	const id = newId('auth api')
	await writeRun(board, id, run('auth-api-k7f2'))
	await appendRunOutput(board, id, 'thinking...')
	await appendRunOutput(board, id, ' done')

	expect(await readRun(board, id)).toMatchObject({ kind: 'ok', value: { node: 'auth-api-k7f2' } })
	expect(await readFile(runLog(board, id), 'utf8')).toBe('thinking... done')
	expect([...(await readRuns(board)).records.keys()]).toEqual([id])
})

test('newId is a slug with a four-character suffix', () => {
	expect(newId('Auth API — tokens')).toMatch(/^auth-api-tokens-[a-z0-9]{4}$/)
	expect(newId('///')).toMatch(/^item-[a-z0-9]{4}$/)
})

test('a torn line is reported and the rest of the log still loads', async () => {
	await appendEvent(board, { action: 'node.created', node: 'auth-api-k7f2' })
	await appendEvent(board, { action: 'run.started', node: 'auth-api-k7f2' })
	await writeFile(board.log, '{"at":"2026-09-04T00:00', { flag: 'a' })

	const { events, broken } = await readLog(board)

	expect(events.map((event) => event.action)).toEqual(['node.created', 'run.started'])
	expect(events[0]).toMatchObject({ node: 'auth-api-k7f2' })
	expect(broken).toHaveLength(1)
	expect(broken[0]?.file).toBe(`${board.log}:3`)
})
