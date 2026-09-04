import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, expect, test } from 'vitest'
import { createTempRepo, type TempRepo } from './fixture.js'

/**
 * The team, driven the way a person drives it: the built binary, from a real
 * repository. Assignment, claim, the same-files warning, and a board written by
 * an older SOBER being brought forward on the way in.
 */
const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const SOBER = join(repoRoot, 'packages/cli/dist/sober.js')
const AT = '2026-09-05T00:00:00.000Z'

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

const refused = (cwd: string, ...args: string[]): string => {
	try {
		sober(cwd, ...args)
		throw new Error(`sober ${args.join(' ')} was expected to refuse`)
	} catch (error) {
		const failure = error as { stderr?: string; stdout?: string; status?: number }
		expect(failure.status).toBe(1)
		return `${failure.stdout ?? ''}${failure.stderr ?? ''}`
	}
}

/** A node exactly as M1 wrote it: no assignee, no claim. */
const v1Node = (title: string, files: string[]) => ({
	title,
	description: '',
	notes: '',
	dependsOn: [],
	decisions: [],
	files,
	brief: null,
	outcome: null,
	accepted: null,
	createdAt: AT,
})

const node = (dir: string, id: string, title: string, files: string[] = []) =>
	writeFileSync(
		join(dir, '.sober/nodes', `${id}.json`),
		`${JSON.stringify({ ...v1Node(title, files), assignee: null, claim: null }, null, '\t')}\n`,
	)

const project = (): string => {
	const created = createTempRepo()
	repo = created
	writeFileSync(join(created.dir, 'README.md'), '# acme\n')
	created.git('add', '-A')
	created.git('commit', '-m', 'chore: first')
	sober(created.dir, 'init', '--title', 'Acme', '--intent', 'Ship sign-in')
	return created.dir
}

test('a project starts with nobody on it, and says how to change that', () => {
	const dir = project()

	expect(sober(dir, 'contributors')).toContain('Nobody is on this project yet')
})

test('someone put on the project is listed, and adding them again corrects them', () => {
	const dir = project()

	sober(dir, 'contributors', 'add', 'alice', '--name', 'Alice', '--role', 'maintainer')
	sober(dir, 'contributors', 'add', 'alice', '--name', 'Alice', '--role', 'reviewer')

	const listed = sober(dir, 'contributors')
	expect(listed).toContain('alice')
	expect(listed).toContain('reviewer')
	expect(listed).not.toContain('maintainer')
})

test('taking someone off says what happens to the nodes they were assigned', () => {
	const dir = project()
	sober(dir, 'contributors', 'add', 'alice')

	expect(sober(dir, 'contributors', 'remove', 'alice')).toContain('keep the handle')
	expect(refused(dir, 'contributors', 'remove', 'alice')).toContain('is not on this project')
})

test('an unknown action is refused with the two that exist', () => {
	const dir = project()

	expect(refused(dir, 'contributors', 'invite', 'alice')).toContain('add')
})

test('assigning to somebody nobody wrote down is a typo more often than a teammate', () => {
	const dir = project()
	node(dir, 'auth-api-k7f2', 'The auth API')

	const said = refused(dir, 'assign', 'auth-api-k7f2', 'alcie')
	expect(said).toContain('is not on this project')
	expect(said).toContain('sober contributors add alcie')
})

test('an assigned node says who it is for, and can be handed back to nobody', () => {
	const dir = project()
	node(dir, 'auth-api-k7f2', 'The auth API')
	sober(dir, 'contributors', 'add', 'alice')

	sober(dir, 'assign', 'auth-api-k7f2', 'alice')
	expect(sober(dir, 'status')).toContain('→ alice')

	sober(dir, 'assign', 'auth-api-k7f2')
	expect(sober(dir, 'status')).not.toContain('→ alice')
})

test('someone else doing what was planned for a person is shown, not hidden', () => {
	const dir = project()
	node(dir, 'auth-api-k7f2', 'The auth API')
	sober(dir, 'contributors', 'add', 'alice')
	sober(dir, 'assign', 'auth-api-k7f2', 'alice')

	sober(dir, 'claim', 'auth-api-k7f2')
	expect(sober(dir, 'status')).toContain('@SOBER Test (for alice)')
})

test('a claim is a fact, and the board shows it where the assignment was', () => {
	const dir = project()
	node(dir, 'auth-api-k7f2', 'The auth API')

	expect(sober(dir, 'claim', 'auth-api-k7f2')).toContain('is yours')
	expect(sober(dir, 'status')).toContain('@SOBER Test')
})

test('claiming a node someone else has is reported, never refused', () => {
	const dir = project()
	node(dir, 'auth-api-k7f2', 'The auth API')
	sober(dir, 'claim', 'auth-api-k7f2')
	execFileSync('git', ['config', 'user.name', 'Bob'], { cwd: dir })

	const said = sober(dir, 'claim', 'auth-api-k7f2')
	expect(said).toContain('is yours')
	expect(said).toContain('SOBER Test')
	expect(said).toContain('not stopped')
})

test('a claimer nobody wrote down is told, and still gets the node', () => {
	const dir = project()
	node(dir, 'auth-api-k7f2', 'The auth API')

	expect(sober(dir, 'claim', 'auth-api-k7f2')).toContain('not on this project yet')
})

test('two claimed nodes heading for the same files are named, and neither is stopped', () => {
	const dir = project()
	node(dir, 'auth-api-k7f2', 'The auth API', ['src/auth/**'])
	node(dir, 'session-ui-m3q8', 'The session panel', ['src/auth/session.ts'])
	sober(dir, 'claim', 'session-ui-m3q8')

	const said = sober(dir, 'claim', 'auth-api-k7f2')
	expect(said).toContain('session-ui-m3q8')
	expect(said).toContain('src/auth/**')
	expect(said).toContain('Nothing is blocked')
})

test('a node nobody has claimed is in nobody’s way', () => {
	const dir = project()
	node(dir, 'auth-api-k7f2', 'The auth API', ['src/auth/**'])
	node(dir, 'session-ui-m3q8', 'The session panel', ['src/auth/session.ts'])

	expect(sober(dir, 'claim', 'auth-api-k7f2')).not.toContain('session-ui-m3q8')
})

test('releasing gives it back, and releasing twice says so', () => {
	const dir = project()
	node(dir, 'auth-api-k7f2', 'The auth API')
	sober(dir, 'claim', 'auth-api-k7f2')

	expect(sober(dir, 'release', 'auth-api-k7f2')).toContain("is nobody's again")
	expect(sober(dir, 'release', 'auth-api-k7f2')).toContain('nobody had claimed')
})

test('a board written by an older SOBER is brought forward on the way in, and says so', () => {
	const dir = project()
	writeFileSync(
		join(dir, '.sober/nodes/auth-api-k7f2.json'),
		`${JSON.stringify(v1Node('The auth API', ['src/auth/**']), null, '\t')}\n`,
	)
	writeFileSync(
		join(dir, '.sober/project.json'),
		JSON.stringify({ schemaVersion: 1, title: 'Acme', intent: '', constraints: [] }),
	)

	const said = sober(dir, 'status')
	expect(said).toContain('schema 1 to 2')
	expect(said).toContain('1 record rewritten')
	expect(said).toContain('The auth API')

	const record = JSON.parse(readFileSync(join(dir, '.sober/nodes/auth-api-k7f2.json'), 'utf8'))
	expect(record).toMatchObject({ assignee: null, claim: null, files: ['src/auth/**'] })
	// Brought forward once: the second command has nothing to say about it.
	expect(sober(dir, 'status')).not.toContain('schema 1')
})

test('a board written by a newer SOBER is refused rather than rewritten', () => {
	const dir = project()
	writeFileSync(
		join(dir, '.sober/project.json'),
		JSON.stringify({ schemaVersion: 99, title: 'Acme', intent: '', constraints: [] }),
	)

	expect(refused(dir, 'status')).toContain('upgrade SOBER')
})
