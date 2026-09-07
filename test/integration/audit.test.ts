import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	acceptWork,
	auditNode,
	dispatch,
	greenNodes,
	initBoard,
	NotOnBoardError,
	type Paths,
	readNodes,
	readRuns,
	reviewNode,
	runLog,
	setSetting,
	writeBrief,
	writeNode,
} from '@besober/core'
import { afterEach, expect, test } from 'vitest'
import { createTempRepo, type TempRepo } from './fixture.js'

/**
 * The auditor: the acceptance list runs, and the review says what each command
 * did (ADR 0049). Real child processes against a real git repository, with only
 * the host faked (ADR 0014) — the commands under test here are the point, so
 * faking them would test nothing.
 */
const FAKE_HOST = `${process.execPath} ${fileURLToPath(new URL('./hosts/claude.mjs', import.meta.url))}`

/** Portable, and exits with what it is told to: no shell builtin is. */
const exits = (code: number): string => `${process.execPath} -e "process.exit(${code})"`

const aNode = (title: string) => ({
	title,
	description: 'Sign in and sign out.',
	notes: '',
	dependsOn: [],
	decisions: [],
	files: ['src/auth.ts'],
	brief: null,
	outcome: null,
	assignee: null,
	claim: null,
	accepted: null,
	dismissal: null,
	createdAt: '2026-09-04T00:00:00.000Z',
})

let repo: TempRepo | undefined

afterEach(() => {
	repo?.cleanup()
	repo = undefined
	delete process.env.FAKE_HOST_COMMIT
	delete process.env.FAKE_HOST_FAIL
})

const board = async (settings: Record<string, unknown> = {}): Promise<Paths> => {
	const created = createTempRepo()
	repo = created
	writeFileSync(join(created.dir, 'README.md'), '# fixture\n')
	created.git('add', 'README.md')
	created.git('commit', '-m', 'chore: first')

	const { paths } = await initBoard(created.dir, { title: 'Acme', intent: 'ship', constraints: [] })
	let config = readFileSync(paths.config, 'utf8')
	config = setSetting(config, ['dispatch', 'host'], FAKE_HOST)
	for (const [key, value] of Object.entries(settings))
		config = setSetting(config, ['dispatch', key], value)
	writeFileSync(paths.config, config)

	await writeNode(paths, 'auth-api-k7f2', aNode('The auth API'))

	// Read from the base ref, never from the branch under review (ADR 0019).
	created.git('add', '.gitignore', '.sober/config.jsonc')
	created.git('commit', '-m', 'chore: sober')
	return paths
}

const criteria = (paths: Paths, ...list: readonly { run: string; proves: string }[]) =>
	writeBrief(paths, 'auth-api-k7f2', { approach: 'Write it.', acceptance: [...list] })

test('the acceptance commands run when the agent exits, and the record says how each one went', async () => {
	const paths = await board()
	await criteria(
		paths,
		{ run: exits(0), proves: 'a signed-in user reaches the account page' },
		{ run: exits(1), proves: 'a signed-out user is sent to the login page' },
	)

	const result = await dispatch(paths, 'auth-api-k7f2', { base: 'main', prompt: 'do the thing' })

	const run = (await readRuns(paths)).records.get(result.run)
	expect(run?.acceptance).toEqual([{ exit: 0 }, { exit: 1 }])
})

test('a criterion whose command is not installed is “did not run”, never a pass', async () => {
	const paths = await board()
	await criteria(
		paths,
		{ run: 'sober-no-such-command-anywhere --please', proves: 'the login form validates' },
		{ run: exits(0), proves: 'the session cookie is httpOnly' },
	)

	const result = await dispatch(paths, 'auth-api-k7f2', { base: 'main', prompt: 'do the thing' })

	const run = (await readRuns(paths)).records.get(result.run)
	// null, not `{ exit: 0 }` and not `{ exit: 127 }`: the command produced no
	// verdict, and a verdict is what the human is reading (ADR 0021, ADR 0011).
	expect(run?.acceptance).toEqual([null, { exit: 0 }])

	const found = await reviewNode(paths, 'auth-api-k7f2', 'main')
	expect(found?.acceptance[0]?.result).toBeNull()
	expect(found?.acceptance[1]?.result).toEqual({ exit: 0 })
})

test('`dispatch.verify` runs in the worktree and lands on the same record', async () => {
	const paths = await board({ verify: exits(0) })
	await criteria(paths, { run: exits(0), proves: 'the build is green' })

	const result = await dispatch(paths, 'auth-api-k7f2', { base: 'main', prompt: 'do the thing' })

	const run = (await readRuns(paths)).records.get(result.run)
	expect(run?.verify).toEqual({ exit: 0 })
	expect((await reviewNode(paths, 'auth-api-k7f2', 'main'))?.verify).toEqual({ exit: 0 })
})

test('the commands run in the node’s worktree, not in the project root', async () => {
	const paths = await board()
	const marker = 'audit-ran-here.txt'
	await criteria(paths, {
		run: `${process.execPath} -e "require('fs').writeFileSync('${marker}','')"`,
		proves: 'the worktree is the working directory',
	})

	const result = await dispatch(paths, 'auth-api-k7f2', { base: 'main', prompt: 'do the thing' })

	expect(existsSync(join(result.worktree, marker))).toBe(true)
	expect(existsSync(join(paths.root, marker))).toBe(false)
})

test('what runs is the approved list on the board, not the copy in the worktree', async () => {
	const paths = await board()
	await criteria(paths, { run: exits(1), proves: 'the token expires' })
	const first = await dispatch(paths, 'auth-api-k7f2', { base: 'main', prompt: 'do the thing' })

	// The agent rewrites its own node record — the acceptance list included —
	// inside the worktree it was given. A retry reuses that worktree, so the
	// rewrite is sitting there when the next run is judged.
	mkdirSync(join(first.worktree, '.sober', 'nodes'), { recursive: true })
	writeFileSync(
		join(first.worktree, '.sober', 'nodes', 'auth-api-k7f2.json'),
		JSON.stringify({
			...aNode('The auth API'),
			brief: {
				approach: 'Write it.',
				acceptance: [{ run: exits(0), proves: 'nothing at all' }],
				approval: null,
			},
		}),
	)

	const second = await dispatch(paths, 'auth-api-k7f2', { base: 'main', prompt: 'do the thing' })

	expect((await readRuns(paths)).records.get(second.run)?.acceptance).toEqual([{ exit: 1 }])
})

test('a run that did not finish leaves every criterion unrun rather than guessing', async () => {
	const paths = await board()
	await criteria(paths, { run: exits(0), proves: 'the build is green' })
	process.env.FAKE_HOST_FAIL = '1'

	const result = await dispatch(paths, 'auth-api-k7f2', { base: 'main', prompt: 'do the thing' })
	delete process.env.FAKE_HOST_FAIL

	expect(result.exit).toBe('failed')
	const run = (await readRuns(paths)).records.get(result.run)
	expect(run?.acceptance).toEqual([null])
})

test('the output of a criterion is in the run log, where the reason lives', async () => {
	const paths = await board()
	await criteria(paths, {
		run: `${process.execPath} -e "console.log('expected 200, got 401'); process.exit(1)"`,
		proves: 'the session cookie is httpOnly',
	})

	const result = await dispatch(paths, 'auth-api-k7f2', { base: 'main', prompt: 'do the thing' })

	expect(readFileSync(runLog(paths, result.run), 'utf8')).toContain('expected 200, got 401')
})

test('`sober audit` re-runs the list against the last run and rewrites its results', async () => {
	const paths = await board()
	await criteria(paths, { run: exits(1), proves: 'the token expires' })
	const result = await dispatch(paths, 'auth-api-k7f2', { base: 'main', prompt: 'do the thing' })
	expect((await readRuns(paths)).records.get(result.run)?.acceptance).toEqual([{ exit: 1 }])

	// The criterion was wrong, not the work. Correcting it and re-auditing does
	// not cost a second dispatch.
	await criteria(paths, { run: exits(0), proves: 'the token expires' })
	const again = await auditNode(paths, 'auth-api-k7f2', 'main')

	expect(again?.run).toBe(result.run)
	expect((await readRuns(paths)).records.get(result.run)?.acceptance).toEqual([{ exit: 0 }])
})

test('`sober audit` on a node that never ran has nothing to audit', async () => {
	const paths = await board()
	await criteria(paths, { run: exits(0), proves: 'the token expires' })

	expect(await auditNode(paths, 'auth-api-k7f2', 'main')).toBeNull()
})

test('a failed criterion holds the node out of green, and never blocks the accept', async () => {
	const paths = await board()
	await criteria(paths, { run: exits(1), proves: 'the token expires' })
	process.env.FAKE_HOST_COMMIT = 'src/auth.ts'

	await dispatch(paths, 'auth-api-k7f2', { base: 'main', prompt: 'do the thing' })

	const { green, held } = await greenNodes(paths, 'main')
	expect(green).not.toContain('auth-api-k7f2')
	expect(held.find((node) => node.id === 'auth-api-k7f2')?.why).toContain('failed')

	// A machine that refuses an accept is a gate, and this product's gates are
	// decisions (ADR 0003). The human reads the failure and still decides.
	await expect(
		acceptWork(paths, 'auth-api-k7f2', { by: 'SOBER Test', base: 'main', scan: 'clean' }),
	).resolves.toMatchObject({ kind: 'merged' })
})

test('accepting records how the audit read at that moment, so it travels with the board', async () => {
	const paths = await board()
	await criteria(paths, { run: exits(1), proves: 'the token expires' })
	process.env.FAKE_HOST_COMMIT = 'src/auth.ts'

	await dispatch(paths, 'auth-api-k7f2', { base: 'main', prompt: 'do the thing' })
	await acceptWork(paths, 'auth-api-k7f2', { by: 'SOBER Test', base: 'main', scan: 'clean' })

	// The run record is local and disposable (§5.5); this is not. A week later a
	// teammate who never had that laptop can still say what was true.
	expect((await readNodes(paths)).records.get('auth-api-k7f2')?.accepted?.audit).toBe('failed')
})

test('`sober audit` refuses a node that is not on the board', async () => {
	const paths = await board()

	await expect(auditNode(paths, 'no-such-node-zzzz', 'main')).rejects.toBeInstanceOf(
		NotOnBoardError,
	)
})

test('a config the base cannot be read from stops the audit rather than skipping verification', async () => {
	const paths = await board()
	await criteria(paths, { run: exits(0), proves: 'the token expires' })
	await dispatch(paths, 'auth-api-k7f2', { base: 'main', prompt: 'do the thing' })

	// A verification command nobody can read is not a verification that passed,
	// and it is not one that was never configured either.
	writeFileSync(paths.config, '{ this is not jsonc')
	;(repo as TempRepo).git('add', '.sober/config.jsonc')
	;(repo as TempRepo).git('commit', '-m', 'chore: break it')

	await expect(auditNode(paths, 'auth-api-k7f2', 'main')).rejects.toThrow('config.jsonc')
})
