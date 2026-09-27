import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { acceptWork, addWorktree, declaredAccuracy, initBoard, writeNode } from '@besober/core'
import { afterEach, beforeAll, expect, test } from 'vitest'
import { createTempRepo, type TempRepo } from './fixture.js'

/**
 * `declaredAccuracy` and its `sober accuracy` surface, against real merges
 * (ADR 0014): a node's declared `files` measured against the first-parent
 * diff of the exact `sober: <id>` merge its work landed as.
 */
const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const SOBER = join(repoRoot, 'packages/cli/dist/sober.js')
const AT = '2026-09-04T00:00:00.000Z'

beforeAll(() => {
	execFileSync(process.execPath, ['build.mjs'], { cwd: join(repoRoot, 'packages/cli') })
}, 180_000)

let repo: TempRepo | undefined

afterEach(() => {
	repo?.cleanup()
	repo = undefined
})

const sober = (cwd: string, ...args: string[]): string =>
	execFileSync(process.execPath, [SOBER, ...args], {
		cwd,
		encoding: 'utf8',
		env: { ...process.env, NO_COLOR: '1' },
	})

const node = (files: string[], accepted: Parameters<typeof writeNode>[2]['accepted'] = null) => ({
	title: 'A node',
	name: 'A node',
	description: '',
	notes: '',
	dependsOn: [],
	decisions: [],
	files,
	brief: null,
	outcome: null,
	assignee: null,
	claim: null,
	accepted,
	dismissal: null,
	createdAt: AT,
})

test('measures touched files, deletions, an empty declaration and an unmatched glob against real merges', async () => {
	const created = createTempRepo()
	repo = created
	mkdirSync(join(created.dir, 'src/auth'), { recursive: true })
	writeFileSync(join(created.dir, 'src/legacy.ts'), 'export const old = 1\n')
	writeFileSync(join(created.dir, 'README.md'), '# fixture\n')
	created.git('add', '-A')
	created.git('commit', '-m', 'chore: first')

	const { paths } = await initBoard(created.dir, { title: 'Acme', intent: '', constraints: [] })
	await writeNode(paths, 'declared-clean-k7f2', node(['src/auth/**']))
	await writeNode(paths, 'empty-declared-m3n2', node([]))
	await writeNode(paths, 'unmatched-glob-q9x4', node(['src/unused/**']))
	created.git('add', '-A')
	created.git('commit', '-m', 'chore: sober')

	// Adds a file its glob declares, and deletes one it never named.
	{
		const { path } = await addWorktree(paths, 'declared-clean-k7f2', 'main')
		mkdirSync(join(path, 'src/auth'), { recursive: true })
		writeFileSync(join(path, 'src/auth/token.ts'), 'export const sign = () => "ok"\n')
		execFileSync('git', ['rm', 'src/legacy.ts'], { cwd: path })
		execFileSync('git', ['add', '-A'], { cwd: path })
		execFileSync('git', ['commit', '-m', 'feat: work'], { cwd: path })
		await acceptWork(paths, 'declared-clean-k7f2', { by: 'memoksin', base: 'main', scan: 'clean' })
	}

	// Declares nothing, so the one file it touches is undeclared.
	{
		const { path } = await addWorktree(paths, 'empty-declared-m3n2', 'main')
		mkdirSync(join(path, 'src/misc'), { recursive: true })
		writeFileSync(join(path, 'src/misc/thing.ts'), 'export const thing = 1\n')
		execFileSync('git', ['add', '-A'], { cwd: path })
		execFileSync('git', ['commit', '-m', 'feat: work'], { cwd: path })
		await acceptWork(paths, 'empty-declared-m3n2', { by: 'memoksin', base: 'main', scan: 'clean' })
	}

	// Its declared glob matches nothing it actually touched.
	{
		const { path } = await addWorktree(paths, 'unmatched-glob-q9x4', 'main')
		mkdirSync(join(path, 'src/other'), { recursive: true })
		writeFileSync(join(path, 'src/other/thing.ts'), 'export const thing = 1\n')
		execFileSync('git', ['add', '-A'], { cwd: path })
		execFileSync('git', ['commit', '-m', 'feat: work'], { cwd: path })
		await acceptWork(paths, 'unmatched-glob-q9x4', { by: 'memoksin', base: 'main', scan: 'clean' })
	}

	const { rows, totals } = await declaredAccuracy(paths, 'main')
	const byId = new Map(rows.map((row) => [row.id, row]))

	expect(byId.get('declared-clean-k7f2')).toMatchObject({
		measurable: true,
		touched: 2,
		undeclared: 1,
		declaredGlobs: 1,
		unmatchedGlobs: 0,
	})
	expect(byId.get('empty-declared-m3n2')).toMatchObject({
		measurable: true,
		touched: 1,
		undeclared: 1,
		declaredGlobs: 0,
		unmatchedGlobs: 0,
	})
	expect(byId.get('unmatched-glob-q9x4')).toMatchObject({
		measurable: true,
		touched: 1,
		undeclared: 1,
		declaredGlobs: 1,
		unmatchedGlobs: 1,
	})
	expect(totals).toEqual({
		measurableNodes: 3,
		touchedFiles: 4,
		undeclaredFiles: 3,
		unmatchedGlobs: 1,
	})

	const output = sober(created.dir, 'accuracy')
	expect(output).toContain('declared-clean-k7f2')
	expect(output).toContain('empty-declared-m3n2')
	expect(output).toContain('unmatched-glob-q9x4')
	expect(output).toContain('measurable nodes  3')
	expect(output).toContain('touched files     4')
	expect(output).toContain('undeclared files  3')
	expect(output).toContain('unmatched globs   1')
})

test('work not attributable to exactly one reachable local merge is unmeasurable, never zero', async () => {
	const created = createTempRepo()
	repo = created
	writeFileSync(join(created.dir, 'README.md'), '# fixture\n')
	created.git('add', '-A')
	created.git('commit', '-m', 'chore: first')

	const { paths } = await initBoard(created.dir, { title: 'Acme', intent: '', constraints: [] })
	// Accepted with no reachable merge at all — the shape a remote PR squash or
	// an unavailable history leaves behind.
	await writeNode(
		paths,
		'pr-landed-a1b2',
		node([], { by: 'memoksin', at: AT, flagged: false, scan: 'clean', audit: 'none' }),
	)
	await writeNode(paths, 'dup-merge-c3d4', node(['src/**']))
	created.git('add', '-A')
	created.git('commit', '-m', 'chore: sober')

	// Two merges answer to the same "sober: <id>" message — ambiguous, so
	// neither is picked, rather than guessing at the wrong one.
	mkdirSync(join(created.dir, 'src'), { recursive: true })
	created.git('checkout', '-b', 'first')
	writeFileSync(join(created.dir, 'src/one.ts'), 'export const one = 1\n')
	created.git('add', '-A')
	created.git('commit', '-m', 'feat: one')
	created.git('checkout', 'main')
	created.git('merge', '--no-ff', '-m', 'sober: dup-merge-c3d4', 'first')

	created.git('checkout', '-b', 'second')
	writeFileSync(join(created.dir, 'src/two.ts'), 'export const two = 1\n')
	created.git('add', '-A')
	created.git('commit', '-m', 'feat: two')
	created.git('checkout', 'main')
	created.git('merge', '--no-ff', '-m', 'sober: dup-merge-c3d4', 'second')
	// The board lives off-branch (§1.2, `.sober/*` is gitignored save for
	// `config.jsonc`): marking it accepted needs no commit of its own.
	await writeNode(
		paths,
		'dup-merge-c3d4',
		node(['src/**'], { by: 'memoksin', at: AT, flagged: false, scan: 'clean', audit: 'none' }),
	)

	const { rows, totals } = await declaredAccuracy(paths, 'main')
	const byId = new Map(rows.map((row) => [row.id, row]))

	expect(byId.get('pr-landed-a1b2')).toMatchObject({ measurable: false })
	expect(byId.get('dup-merge-c3d4')).toMatchObject({ measurable: false })
	expect(totals).toEqual({
		measurableNodes: 0,
		touchedFiles: 0,
		undeclaredFiles: 0,
		unmatchedGlobs: 0,
	})

	const output = sober(created.dir, 'accuracy')
	expect(output).toContain('pr-landed-a1b2')
	expect(output).toContain('dup-merge-c3d4')
	expect(output).toContain('unmeasurable')
	expect(output).toContain('measurable nodes  0')
})
