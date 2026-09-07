import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { addWorktree, initBoard, type Paths, scanNode, setSetting, writeNode } from '@besober/core'
import { afterEach, expect, test } from 'vitest'
import { createTempRepo, type TempRepo } from './fixture.js'

/**
 * The scan against a real repository, a real branch and the real `secretlint`
 * (ADR 0014). Nothing here is mocked: the point of this file is that the thing
 * shipped to a user finds a key in a diff, and that a project's own rules — read
 * from the base — decide which keys count.
 */
let repo: TempRepo | undefined

afterEach(() => {
	repo?.cleanup()
	repo = undefined
})

const NODE = 'auth-api-k7f2'
/** Assembled rather than written out: a literal here is a finding in SOBER's own CI. */
const TOKEN = ['ghp', '16C7e42F292c6912E7710c838347Ae178B4a'].join('_')

const board = async (options: { declared?: string[]; rc?: string; extra?: string[] } = {}) => {
	const created = createTempRepo()
	repo = created
	writeFileSync(join(created.dir, 'README.md'), '# fixture\n')
	created.git('add', 'README.md')
	created.git('commit', '-m', 'chore: first')

	const { paths } = await initBoard(created.dir, { title: 'Acme', intent: 'ship', constraints: [] })
	if (options.extra !== undefined) {
		const config = setSetting(readFileSync(paths.config, 'utf8'), ['scan', 'extra'], options.extra)
		writeFileSync(paths.config, config)
	}
	await writeNode(paths, NODE, {
		title: 'The auth API',
		description: '',
		notes: '',
		dependsOn: [],
		decisions: [],
		files: options.declared ?? ['src/auth/**'],
		brief: null,
		outcome: null,
		assignee: null,
		claim: null,
		accepted: null,
		dismissal: null,
		createdAt: '2026-09-04T00:00:00.000Z',
	})

	// The rule set is read from the base, so the base is where it has to be.
	if (options.rc !== undefined) writeFileSync(join(created.dir, '.secretlintrc.json'), options.rc)
	created.git('add', '-A')
	created.git('commit', '-m', 'chore: sober')
	return paths
}

/** Work committed on the node's own branch, which is what a review reads. */
const work = async (paths: Paths, files: Record<string, string>) => {
	const { path } = await addWorktree(paths, NODE, 'main')
	for (const [name, contents] of Object.entries(files)) {
		mkdirSync(dirname(join(path, name)), { recursive: true })
		writeFileSync(join(path, name), contents)
	}
	execFileSync('git', ['add', '-A'], { cwd: path })
	execFileSync('git', ['commit', '-m', 'feat: work'], { cwd: path })
	return path
}

test('a key in an added line is found, masked, and pinned to its line', async () => {
	const paths = await board()
	await work(paths, {
		'src/auth/token.ts': `const a = 1\nconst token = "${TOKEN}"\n`,
	})

	const report = await scanNode(paths, NODE, { base: 'main' })

	expect(report.result).toBe('findings')
	expect(report.ruleSet).toBe('the bundled preset')
	const secret = report.findings.find((finding) => finding.signal === 'secret')
	expect(secret).toMatchObject({ file: 'src/auth/token.ts', line: 2 })
	expect(secret?.message).toContain('GitHub')
	// Masked: a review panel that reprints the secret has published it again.
	expect(secret?.message).not.toContain(TOKEN)
})

test('a clean diff inside the declared files is clean, and says which rules ran', async () => {
	const paths = await board()
	await work(paths, { 'src/auth/token.ts': 'export const sign = () => "ok"\n' })

	expect(await scanNode(paths, NODE, { base: 'main' })).toMatchObject({
		result: 'clean',
		findings: [],
		didNotRun: [],
		files: ['src/auth/token.ts'],
	})
})

test('the project’s own rules are read from the base, so a suppression is one a human merged', async () => {
	// An empty rule set finds nothing. What matters is that it was honoured at
	// all, and that the review names it rather than reporting "clean".
	const paths = await board({ rc: '{ "rules": [] }' })
	await work(paths, {
		'src/auth/token.ts': `const token = "${TOKEN}"\n`,
	})

	const report = await scanNode(paths, NODE, { base: 'main' })
	expect(report.ruleSet).toBe('main:.secretlintrc.json')
	expect(report.findings.filter((finding) => finding.signal === 'secret')).toEqual([])
})

test('a branch that relaxes the rules does not relax the scan of its own diff', async () => {
	const paths = await board()
	const path = await work(paths, {
		'src/auth/token.ts': `const token = "${TOKEN}"\n`,
	})
	writeFileSync(join(path, '.secretlintrc.json'), '{ "rules": [] }')
	execFileSync('git', ['add', '-A'], { cwd: path })
	execFileSync('git', ['commit', '-m', 'chore: relax the rules'], { cwd: path })

	const report = await scanNode(paths, NODE, { base: 'main' })
	expect(report.ruleSet).toBe('the bundled preset')
	expect(report.findings.some((finding) => finding.signal === 'secret')).toBe(true)
})

test('the six signals ride along with the secrets, over the same diff', async () => {
	const paths = await board()
	await work(paths, {
		'package.json': '{ "dependencies": { "left-pad": "^1.0.0" } }\n',
		'src/auth/token.ts': 'fetch("https://collector.acme-metrics.io/v1", { agent })\n',
	})

	const report = await scanNode(paths, NODE, { base: 'main' })
	expect(report.findings.map((finding) => finding.signal).sort()).toEqual([
		'dependency-added',
		'hardcoded-address',
		'undeclared-file',
	])
})

test('an extra scanner that is not installed did not run, and is never read as clean', async () => {
	const paths = await board({ extra: ['sober-no-such-scanner --json'] })
	await work(paths, { 'src/auth/token.ts': 'export const sign = () => "ok"\n' })

	const report = await scanNode(paths, NODE, { base: 'main' })
	expect(report.result).toBe('did-not-run')
	expect(report.didNotRun).toEqual(['sober-no-such-scanner --json: not installed'])
})

test('an extra scanner that exits non-zero is a finding carrying its first line', async () => {
	const paths = await board({
		extra: [`${process.execPath} -e "console.log('two issues found'); process.exit(2)"`],
	})
	await work(paths, { 'src/auth/token.ts': 'export const sign = () => "ok"\n' })

	const report = await scanNode(paths, NODE, { base: 'main' })
	expect(report.result).toBe('findings')
	expect(report.findings.at(-1)).toMatchObject({
		signal: 'extra',
		message: 'two issues found',
	})
})
