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

test("a rename from an undeclared path into a declared one counts both the source and the destination, regardless of the user's `diff.renames`", async () => {
	await board()
	// A user-level rename-detection config a contributor might have set —
	// the accuracy report must not vary with it (`git diff` without
	// `--no-renames` would otherwise fold this into one destination-only entry).
	git('config', 'diff.renames', 'true')
	// The source path must already exist on `main` before this node's branch —
	// otherwise merge^1..merge sees no source to rename from and it's a plain
	// addition either way, which would not exercise the bug this test guards.
	mkdirSync(join(paths.root, 'undeclared'), { recursive: true })
	const body = 'export const moved = 1\n'.repeat(50)
	writeFileSync(join(paths.root, 'undeclared/moved.ts'), body)
	git('add', '-A')
	git('commit', '-m', 'chore: add file that will move')

	await node('rename-node-r1e2', 'Renamed', ['src/alpha/**'])
	const { path } = await addWorktree(paths, 'rename-node-r1e2', 'main')
	mkdirSync(join(path, 'src/alpha'), { recursive: true })
	execFileSync('git', ['mv', 'undeclared/moved.ts', 'src/alpha/moved.ts'], { cwd: path })
	execFileSync('git', ['commit', '-m', 'feat: move into declared dir'], { cwd: path })
	await acceptWork(paths, 'rename-node-r1e2', { by: 'memoksin', base: 'main', scan: 'clean' })

	// Confirm the setup actually exercises rename detection before trusting
	// the assertion below to mean anything.
	const merge = git('log', 'main', '--format=%H%x09%s')
		.split('\n')
		.find((line) => line.endsWith('sober: rename-node-r1e2'))
		?.split('\t')[0] as string
	const renameStat = git('diff', '--find-renames', '--name-status', `${merge}^1`, merge)
	expect(renameStat).toMatch(/^R/m)

	const report = await declaredFileAccuracy(paths, await loadBoard(paths), 'main')
	const row = report.nodes[0]
	expect(row).toMatchObject({
		id: 'rename-node-r1e2',
		measurable: true,
		declaredGlobs: 1,
		// Both the deleted undeclared source and the added declared destination —
		// a rename collapsed to its destination only would read 1 here.
		touchedFiles: 2,
		undeclaredFiles: 1,
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

test('a commit reading the exact `sober: <id>` subject that is not a merge is not attributable', async () => {
	await board()
	await node('lone-node-l3m4', 'Lone', ['src/**'])
	// A plain, single-parent commit that happens to read the merge subject a
	// real `mergeNode` would have written — never one, since it has one parent.
	writeFileSync(join(paths.root, 'unrelated.txt'), 'noise\n')
	git('add', '-A')
	git('commit', '-m', 'sober: lone-node-l3m4')
	const record = (await loadBoard(paths)).nodes.get('lone-node-l3m4')
	if (record === undefined) throw new Error('node vanished')
	await writeNode(paths, 'lone-node-l3m4', {
		...record,
		accepted: { by: 'memoksin', at: AT, flagged: false, scan: 'clean', audit: 'none' },
	})

	const report = await declaredFileAccuracy(paths, await loadBoard(paths), 'main')
	expect(report.nodes[0]).toMatchObject({ measurable: false })
	expect(report.nodes[0]?.reason).toMatch(/is not a merge commit/)
})

/** A worktree with one committed addition, distinct per node so two can run without conflict. */
const smallWork = async (id: string, file: string): Promise<void> => {
	const { path } = await addWorktree(paths, id, 'main')
	writeFileSync(join(path, file), 'export const x = 1\n')
	execFileSync('git', ['add', '-A'], { cwd: path })
	execFileSync('git', ['commit', '-m', 'feat: work'], { cwd: path })
}

test('rows sort by id regardless of the order nodes were declared in', async () => {
	await board()
	await node('zeta-node-z1z2', 'Zeta', ['src/**'])
	await smallWork('zeta-node-z1z2', 'src/z.ts')
	await acceptWork(paths, 'zeta-node-z1z2', { by: 'memoksin', base: 'main', scan: 'clean' })
	await node('alpha-node-a1b2', 'Alpha', ['src/**'])
	await smallWork('alpha-node-a1b2', 'src/a.ts')
	await acceptWork(paths, 'alpha-node-a1b2', { by: 'memoksin', base: 'main', scan: 'clean' })

	const report = await declaredFileAccuracy(paths, await loadBoard(paths), 'main')
	expect(report.nodes.map((row) => row.id)).toEqual(['alpha-node-a1b2', 'zeta-node-z1z2'])
})

test('a board with no accepted nodes says so', async () => {
	await board()
	await node('idle-node-i9j0', 'Idle', ['src/**'])

	const out = sober(paths.root, 'accuracy')
	expect(out).toContain('No accepted nodes yet.')
})
