import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	acceptWork,
	addWorktree,
	declaredFileAccuracy,
	initBoard,
	loadBoard,
	type Paths,
	writeNode,
} from '@besober/core'
import { afterEach, beforeAll, expect, test } from 'vitest'
import { createTempRepo, type TempRepo } from './fixture.js'

/**
 * SCOPE.md's scope rule 3 keeps `undeclared-file` (`signals.ts`) a flag,
 * unmeasured, until this exists. Real merges, a real deletion, a real
 * unmatched glob, an empty declaration and a node nobody merged — the same way
 * `review.test.ts` drives `acceptWork` against a real repository (ADR 0014).
 */
const AT = '2026-09-04T00:00:00.000Z'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const SOBER = join(repoRoot, 'packages/cli/dist/sober.js')

beforeAll(() => {
	execFileSync(process.execPath, ['build.mjs'], { cwd: join(repoRoot, 'packages/cli') })
}, 180_000)

let repo: TempRepo | undefined

afterEach(() => {
	repo?.cleanup()
	repo = undefined
})

const git = (...args: string[]): string => {
	if (repo === undefined) throw new Error('no repository')
	return repo.git(...args)
}

const sober = (cwd: string, ...args: string[]): string =>
	execFileSync(process.execPath, [SOBER, ...args], {
		cwd,
		encoding: 'utf8',
		env: { ...process.env, NO_COLOR: '1' },
	})

const node = (id: string, title: string, files: string[]) =>
	writeNode(paths, id, {
		title,
		name: title,
		description: '',
		notes: '',
		dependsOn: [],
		decisions: [],
		files,
		brief: null,
		outcome: null,
		assignee: null,
		claim: null,
		accepted: null,
		dismissal: null,
		createdAt: AT,
	})

let paths: Paths

const board = async (): Promise<Paths> => {
	const created = createTempRepo()
	repo = created
	// A file each declared node's glob leaves alone, so a deletion inside a
	// glob is unambiguous work rather than the fixture's own bootstrap.
	mkdirSync(join(created.dir, 'src/alpha'), { recursive: true })
	writeFileSync(join(created.dir, 'src/alpha/old.ts'), 'export const old = 1\n')
	writeFileSync(join(created.dir, 'README.md'), '# fixture\n')
	created.git('add', '-A')
	created.git('commit', '-m', 'chore: first')

	const { paths: created2 } = await initBoard(created.dir, {
		title: 'Acme',
		intent: 'ship',
		constraints: [],
	})
	paths = created2
	created.git('add', '-A')
	created.git('commit', '-m', 'chore: sober')
	return paths
}

/** A worktree with real, committed changes — additions, one deletion, one untouched glob. */
const work = async (id: string): Promise<void> => {
	const { path } = await addWorktree(paths, id, 'main')
	mkdirSync(join(path, 'src/alpha'), { recursive: true })
	writeFileSync(join(path, 'src/alpha/one.ts'), 'export const one = 1\n')
	writeFileSync(join(path, 'src/alpha/two.ts'), 'export const two = 2\n')
	// Undeclared: outside every glob the node named.
	writeFileSync(join(path, 'extra.txt'), 'not declared\n')
	rmSync(join(path, 'src/alpha/old.ts'))
	execFileSync('git', ['add', '-A'], { cwd: path })
	execFileSync('git', ['commit', '-m', 'feat: work'], { cwd: path })
}

test('measures touched files against declared globs — additions, a deletion, an undeclared file and an unmatched glob', async () => {
	await board()
	await node('alpha-node-a1b2', 'Alpha', ['src/alpha/**', 'docs/**'])
	await work('alpha-node-a1b2')
	await acceptWork(paths, 'alpha-node-a1b2', { by: 'memoksin', base: 'main', scan: 'clean' })

	const report = await declaredFileAccuracy(paths, await loadBoard(paths), 'main')
	expect(report.nodes).toHaveLength(1)
	const row = report.nodes[0]
	expect(row).toMatchObject({
		id: 'alpha-node-a1b2',
		measurable: true,
		reason: null,
		declaredGlobs: 2,
		// one.ts, two.ts, extra.txt added; old.ts deleted — the first-parent diff
		// counts all four, the deletion included.
		touchedFiles: 4,
		undeclaredFiles: 1,
		// `docs/**` matched nothing this node touched.
		unmatchedGlobs: 1,
	})
	expect(report.totals).toEqual({
		measurableNodes: 1,
		touchedFiles: 4,
		undeclaredFiles: 1,
		unmatchedGlobs: 1,
	})
})

test('an empty declaration leaves every touched path undeclared, and declares no glob to leave unmatched', async () => {
	await board()
	await node('bare-node-b3c4', 'Bare', [])
	await work('bare-node-b3c4')
	await acceptWork(paths, 'bare-node-b3c4', { by: 'memoksin', base: 'main', scan: 'clean' })

	const report = await declaredFileAccuracy(paths, await loadBoard(paths), 'main')
	const row = report.nodes[0]
	expect(row).toMatchObject({
		measurable: true,
		declaredGlobs: 0,
		touchedFiles: 4,
		undeclaredFiles: 4,
		unmatchedGlobs: 0,
	})
})

test('an accepted node with no reachable sober merge is reported unmeasurable, and excluded from the totals rather than counted as zero', async () => {
	await board()
	// Accepted by hand, never through `acceptWork` — there is no `sober: <id>`
	// merge commit for this node anywhere in the repository's history.
	await node('ghost-node-g5h6', 'Ghost', ['src/**'])
	const record = (await loadBoard(paths)).nodes.get('ghost-node-g5h6')
	if (record === undefined) throw new Error('node vanished')
	await writeNode(paths, 'ghost-node-g5h6', {
		...record,
		accepted: { by: 'memoksin', at: AT, flagged: false, scan: 'clean', audit: 'none' },
	})

	const report = await declaredFileAccuracy(paths, await loadBoard(paths), 'main')
	expect(report.nodes).toHaveLength(1)
	expect(report.nodes[0]).toMatchObject({
		id: 'ghost-node-g5h6',
		measurable: false,
		touchedFiles: 0,
	})
	expect(report.nodes[0]?.reason).toMatch(/no `sober: ghost-node-g5h6` commit is reachable/)
	expect(report.totals).toEqual({
		measurableNodes: 0,
		touchedFiles: 0,
		undeclaredFiles: 0,
		unmatchedGlobs: 0,
	})
})

test('two commits reading the same `sober: <id>` subject are not attributable to one merge', async () => {
	await board()
	await node('dup-node-d7e8', 'Duplicate', ['src/**'])
	await work('dup-node-d7e8')
	await acceptWork(paths, 'dup-node-d7e8', { by: 'memoksin', base: 'main', scan: 'clean' })
	// A second, unrelated commit that happens to read the same subject line.
	writeFileSync(join(paths.root, 'unrelated.txt'), 'noise\n')
	git('add', '-A')
	git('commit', '-m', 'sober: dup-node-d7e8')

	const report = await declaredFileAccuracy(paths, await loadBoard(paths), 'main')
	expect(report.nodes[0]).toMatchObject({ measurable: false })
	expect(report.nodes[0]?.reason).toMatch(/2 commits read/)
})

test('the CLI renders one row per accepted node and the totals across the measurable ones', async () => {
	await board()
	await node('alpha-node-a1b2', 'Alpha', ['src/alpha/**', 'docs/**'])
	await work('alpha-node-a1b2')
	await acceptWork(paths, 'alpha-node-a1b2', { by: 'memoksin', base: 'main', scan: 'clean' })

	const out = sober(paths.root, 'accuracy')
	expect(out).toContain('alpha-node-a1b2')
	expect(out).toContain('2 glob(s)')
	expect(out).toContain('4 touched')
	expect(out).toContain('1 undeclared')
	expect(out).toContain('1 unmatched')
	expect(out).toMatch(/1 measurable node/)
})

test('the CLI names a node with no reachable merge as unmeasurable, rather than silently dropping it', async () => {
	await board()
	await node('ghost-node-g5h6', 'Ghost', ['src/**'])
	const record = (await loadBoard(paths)).nodes.get('ghost-node-g5h6')
	if (record === undefined) throw new Error('node vanished')
	await writeNode(paths, 'ghost-node-g5h6', {
		...record,
		accepted: { by: 'memoksin', at: AT, flagged: false, scan: 'clean', audit: 'none' },
	})

	const out = sober(paths.root, 'accuracy')
	expect(out).toContain('ghost-node-g5h6')
	expect(out).toContain('unmeasurable')
	expect(out).toMatch(/1 accepted node\(s\) are not attributable/)
})

test('a board with no accepted nodes says so', async () => {
	await board()
	await node('idle-node-i9j0', 'Idle', ['src/**'])

	const out = sober(paths.root, 'accuracy')
	expect(out).toContain('No accepted nodes yet.')
})
