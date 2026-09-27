import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNode, initBoard, loadBoard, type Paths, writeRun } from '@besober/core'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { openBoard } from './board.js'
import { question } from './flag.js'

vi.mock('./board.js', () => ({ openBoard: vi.fn() }))

let dir: string
let paths: Paths
let out: string

beforeEach(async () => {
	dir = mkdtempSync(join(tmpdir(), 'sober-question-'))
	paths = (await initBoard(dir, { title: 'Acme', intent: '', constraints: [] })).paths
	vi.mocked(openBoard).mockResolvedValue(paths)
	out = ''
	const capture = (chunk: unknown) => {
		out += String(chunk)
		return true
	}
	vi.spyOn(process.stdout, 'write').mockImplementation(capture)
	vi.spyOn(process.stderr, 'write').mockImplementation(capture)
	vi.spyOn(process, 'exit').mockImplementation(() => {
		throw new Error('exit')
	})
})

afterEach(() => {
	vi.restoreAllMocks()
	rmSync(dir, { recursive: true, force: true })
})

test('sober question opens an unopened decision that holds the node it binds', async () => {
	const { id: node } = await createNode(paths, { title: 'Auth API', by: 'me' })

	await question('Where does session state live?', { category: 'state', binds: node })

	const board = await loadBoard(paths)
	const [id] = [...board.decisions.keys()]
	expect(board.nodes.get(node)?.decisions).toEqual([id])
	expect(out).toContain(`${id} holds ${node}`)
	expect(out).toContain('/sober:decide')
})

test.each([
	['an empty question', '  ', { category: 'state', binds: 'NODE' }, 'what is the question?'],
	['no category', 'Where?', { binds: 'NODE' }, 'which category?'],
	['no node', 'Where?', { category: 'state' }, 'at least one node'],
	['a node in review', 'Where?', { category: 'state', binds: 'NODE' }, 'is in-review'],
])('sober question with %s is refused and writes nothing', async (name, text, given, said) => {
	const { id: node } = await createNode(paths, { title: 'Auth API', by: 'me' })
	if (name === 'a node in review')
		await writeRun(paths, 'run-1', {
			node,
			host: 'claude-code',
			branch: `sober/${node}`,
			worktree: dir,
			startedAt: '2026-09-04T00:00:00.000Z',
			endedAt: '2026-09-04T01:00:00.000Z',
			exit: 'finished',
			error: null,
			verify: null,
			acceptance: [],
		})
	const before = (await loadBoard(paths)).nodes.get(node)

	await expect(
		question(text, { ...given, binds: given.binds?.replace('NODE', node) }),
	).rejects.toThrow('exit')

	const board = await loadBoard(paths)
	expect(out).toContain(said)
	expect(board.decisions.size).toBe(0)
	expect(board.nodes.get(node)).toEqual(before)
})
