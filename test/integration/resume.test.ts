import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	dispatch,
	initBoard,
	type Paths,
	readRunOutput,
	readRuns,
	rejectWork,
	setSetting,
	writeBrief,
	writeNode,
} from '@besober/core'
import { afterEach, expect, test } from 'vitest'
import { createTempRepo, type TempRepo } from './fixture.js'

/**
 * A rejected node continues the session that built it (ADR 0069): compacted
 * first when it grew large, and started cold with the last attempt's own report
 * when it cannot be resumed.
 */
const FAKE_HOST = `${process.execPath} ${fileURLToPath(new URL('./hosts/claude.mjs', import.meta.url))}`

let repo: TempRepo | undefined

afterEach(() => {
	repo?.cleanup()
	repo = undefined
	for (const key of [
		'FAKE_HOST_ARGV',
		'FAKE_HOST_CONTEXT',
		'FAKE_HOST_NO_SESSION',
		'FAKE_HOST_WRITE',
	])
		delete process.env[key]
})

const board = async (): Promise<Paths> => {
	const created = createTempRepo()
	repo = created
	writeFileSync(join(created.dir, 'README.md'), '# fixture\n')
	created.git('add', 'README.md')
	created.git('commit', '-m', 'chore: first')

	const { paths } = await initBoard(created.dir, { title: 'Acme', intent: 'ship', constraints: [] })
	writeFileSync(
		paths.config,
		setSetting(readFileSync(paths.config, 'utf8'), ['dispatch', 'host'], FAKE_HOST),
	)
	await writeNode(paths, 'auth-api-k7f2', {
		title: 'The auth API',
		name: 'The auth API',
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
	await writeBrief(paths, 'auth-api-k7f2', {
		approach: 'Add the endpoints, then the middleware.',
		acceptance: [{ run: 'node -e 0', proves: 'It runs.' }],
	})
	created.git('add', '.gitignore', '.sober/config.jsonc')
	created.git('commit', '-m', 'chore: sober')
	return paths
}

const argvs = (file: string): string[][] =>
	readFileSync(file, 'utf8')
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line) as string[])

const promptOf = (argv: readonly string[]): string => argv[argv.indexOf('-p') + 1] ?? ''

test('a run records its session, and a rejected node resumes it after compacting', async () => {
	const paths = await board()
	process.env.FAKE_HOST_CONTEXT = '110000'
	await dispatch(paths, 'auth-api-k7f2', { base: 'main' })

	const first = [...(await readRuns(paths)).records.values()][0]
	expect(first).toMatchObject({ session: 'fake', usage: { contextPeak: 110_002 } })

	await rejectWork(paths, 'auth-api-k7f2', { by: 'memoksin', text: 'Nothing checks the session.' })
	const seen = join(dirname(paths.root), 'argv.jsonl')
	process.env.FAKE_HOST_ARGV = seen
	const result = await dispatch(paths, 'auth-api-k7f2', { base: 'main' })
	expect(result.exit).toBe('finished')

	const [compact, resumed] = argvs(seen)
	expect(promptOf(compact ?? [])).toMatch(/^\/compact /)
	expect(compact?.[compact.indexOf('--effort') + 1]).toBe('low')
	expect(compact?.[compact.indexOf('--resume') + 1]).toBe('fake')
	expect(resumed?.[resumed.indexOf('--resume') + 1]).toBe('fake')
	expect(promptOf(resumed ?? [])).toContain('Nothing checks the session.')
	// The session already holds what the last attempt said; it is not repeated.
	expect(promptOf(resumed ?? [])).not.toContain('What the last attempt reported')
})

test('a small session is resumed as it is, with no compaction', async () => {
	const paths = await board()
	await dispatch(paths, 'auth-api-k7f2', { base: 'main' })
	await rejectWork(paths, 'auth-api-k7f2', { by: 'memoksin', text: 'Nothing checks the session.' })

	const seen = join(dirname(paths.root), 'argv.jsonl')
	process.env.FAKE_HOST_ARGV = seen
	await dispatch(paths, 'auth-api-k7f2', { base: 'main' })
	const calls = argvs(seen)
	expect(calls).toHaveLength(1)
	expect(calls[0]).toContain('--resume')
})

test('a session that cannot be resumed starts cold, headed by the last attempt’s report', async () => {
	const paths = await board()
	await dispatch(paths, 'auth-api-k7f2', { base: 'main' })
	await rejectWork(paths, 'auth-api-k7f2', { by: 'memoksin', text: 'Nothing checks the session.' })

	const seen = join(dirname(paths.root), 'argv.jsonl')
	process.env.FAKE_HOST_ARGV = seen
	process.env.FAKE_HOST_NO_SESSION = '1'
	const result = await dispatch(paths, 'auth-api-k7f2', { base: 'main' })
	expect(result.exit).toBe('finished')

	const [refused, cold] = argvs(seen)
	expect(refused).toContain('--resume')
	expect(cold).not.toContain('--resume')
	// The fake's last words from the first run: "wrote the file for: <first prompt line>".
	expect(promptOf(cold ?? [])).toContain('# What the last attempt reported')
	expect(promptOf(cold ?? [])).toContain('wrote the file for:')
	expect(await readRunOutput(paths, result.run)).toContain('could not be resumed')
})
