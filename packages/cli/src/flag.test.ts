import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNode, initBoard, loadBoard, type Paths, statusOf } from '@besober/core'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { openBoard } from './board.js'
import { question } from './flag.js'

vi.mock('./board.js', () => ({ openBoard: vi.fn() }))

let paths: Paths
let out: string[]

beforeEach(async () => {
	const root = await mkdtemp(join(tmpdir(), 'sober-cli-question-'))
	paths = (await initBoard(root, { title: 'Acme', intent: '', constraints: [] })).paths
	vi.mocked(openBoard).mockResolvedValue(paths)
	out = []
	const capture = (chunk: unknown) => {
		out.push(String(chunk))
		return true
	}
	vi.spyOn(process.stdout, 'write').mockImplementation(capture)
	vi.spyOn(process.stderr, 'write').mockImplementation(capture)
	vi.spyOn(process, 'exit').mockImplementation(() => {
		throw new Error('exit')
	})
	return () => rm(root, { recursive: true, force: true })
})

afterEach(() => {
	vi.restoreAllMocks()
})

test('sober question opens an unopened decision that holds the nodes it binds', async () => {
	const { createNode } = await import('@besober/core')
	const { id: node } = await createNode(paths, { title: 'The auth API', by: 'memoksin' })

	await question('Where does state live?', { category: 'state', binds: node })

	const board = await loadBoard(paths)
	const [id] = [...board.decisions.keys()]
	expect(board.decisions.get(id as string)?.options).toBeNull()
	expect(board.nodes.get(node)?.decisions).toEqual([id])
	expect(statusOf(board, node)).toBe('held')
	expect(out.join('')).toContain('/sober:decide')
})

test.each([
	['a category it does not know', { category: 'vibes', binds: 'x-a1b2' }, '--category is one of'],
	['no nodes to hold', { category: 'state' }, 'name at least one node'],
	['a node that is not on the board', { category: 'state', binds: 'ghost-zz99' }, 'ghost-zz99'],
])('sober question refuses %s in a sentence', async (_, given, said) => {
	await expect(question('Where does state live?', given)).rejects.toThrow('exit')

	expect(out.join('')).toContain(said)
	expect((await loadBoard(paths)).decisions.size).toBe(0)
})
