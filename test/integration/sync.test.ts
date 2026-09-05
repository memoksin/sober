import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, expect, test } from 'vitest'
import { createTempRepo, type TempRepo } from './fixture.js'

/**
 * Two clones of one bare remote, which is M2's gate in miniature (ADR 0014).
 * Everything here runs the built binary against real git: a board that travels
 * cannot be proven against a mock, because every failure it has is git's.
 */
const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const SOBER = join(repoRoot, 'packages/cli/dist/sober.js')

beforeAll(() => {
	execFileSync(process.execPath, ['build.mjs'], { cwd: join(repoRoot, 'packages/cli') })
}, 180_000)

let repo: TempRepo | undefined
let second: string | undefined

afterEach(() => {
	repo?.cleanup()
	repo = undefined
	if (second !== undefined) rmSync(second, { recursive: true, force: true })
	second = undefined
})

const sober = (cwd: string, ...args: string[]): string =>
	execFileSync(process.execPath, [SOBER, ...args], {
		cwd,
		encoding: 'utf8',
		env: { ...process.env, NO_COLOR: '1' },
	})

/** A sync that did not put the board out exits non-zero, and still explains itself. */
const refused = (cwd: string, ...args: string[]): string => {
	try {
		sober(cwd, ...args)
		throw new Error(`sober ${args.join(' ')} was expected to exit non-zero`)
	} catch (error) {
		const failure = error as { stdout?: string; stderr?: string; status?: number }
		expect(failure.status).toBe(1)
		return `${failure.stdout ?? ''}${failure.stderr ?? ''}`
	}
}

const git = (cwd: string, ...args: string[]): string =>
	execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

/** Alice: a repository with a board and one node on it. */
const alice = (): TempRepo => {
	const created = createTempRepo()
	repo = created
	writeFileSync(join(created.dir, 'README.md'), '# acme\n')
	created.git('add', '-A')
	created.git('commit', '-m', 'chore: first')
	sober(created.dir, 'init', '--title', 'acme')
	created.git('add', '-A')
	created.git('commit', '-m', 'chore: sober')
	created.git('push', '-u', 'origin', 'main')
	return created
}

/** Changes one line of a record, the way a person editing the file would. */
const edit = (dir: string, id: string, line: string): void => {
	const file = join(dir, '.sober/nodes', `${id}.json`)
	writeFileSync(file, readFileSync(file, 'utf8').replace(/"title": "[^"]*"/, line))
}

const node = (dir: string, id: string, title: string, dependsOn: string[] = []): void => {
	writeFileSync(
		join(dir, '.sober/nodes', `${id}.json`),
		`${JSON.stringify(
			{
				title,
				description: title,
				notes: '',
				dependsOn,
				decisions: [],
				files: [],
				brief: null,
				outcome: null,
				assignee: null,
				claim: null,
				accepted: null,
				createdAt: '2026-09-05T00:00:00.000Z',
			},
			null,
			'\t',
		)}\n`,
	)
}

/** Bob: a clone of the same remote, with no board in the working tree. */
const bob = (remote: string): string => {
	const dir = join(remote, '..', 'bob')
	second = dir
	execFileSync('git', ['clone', '--quiet', remote, dir], { encoding: 'utf8' })
	git(dir, 'config', 'user.name', 'Bob')
	git(dir, 'config', 'user.email', 'bob@example.com')
	git(dir, 'config', 'commit.gpgsign', 'false')
	return dir
}

test('a board pushed by one person is the board the next one gets', () => {
	const a = alice()
	node(a.dir, 'ship-the-thing-aaaa', 'Ship the thing')
	expect(sober(a.dir, 'sync')).toContain('your board went out')

	const b = bob(a.remote)
	expect(existsSync(join(b, '.sober/nodes'))).toBe(false)
	const joined = sober(b, 'init')
	expect(joined).toContain('the team’s board is here')
	expect(sober(b, 'status')).toContain('Ship the thing')

	// Byte for byte: a record that came back changed would make every later
	// sync see an edit nobody made.
	expect(readFileSync(join(b, '.sober/nodes/ship-the-thing-aaaa.json'), 'utf8')).toBe(
		readFileSync(join(a.dir, '.sober/nodes/ship-the-thing-aaaa.json'), 'utf8'),
	)
})

test('a node added on one side reaches the other, and nothing else moves', () => {
	const a = alice()
	node(a.dir, 'first-node-aaaa', 'First')
	sober(a.dir, 'sync')
	const b = bob(a.remote)
	sober(b, 'init')

	node(b, 'second-node-bbbb', 'Second')
	expect(sober(b, 'sync')).toContain('your board went out')

	const head = a.git('rev-parse', 'HEAD')
	const pulled = sober(a.dir, 'sync')
	expect(pulled).toContain('1 record came in')
	expect(pulled).toContain('second-node-bbbb')
	expect(sober(a.dir, 'status')).toContain('Second')
	// The code branch is exactly where it was: the board never checks out.
	expect(a.git('rev-parse', 'HEAD')).toBe(head)
	expect(a.git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('main')
})

test('--no-push takes the team’s board without publishing yours', () => {
	const a = alice()
	sober(a.dir, 'sync')
	const b = bob(a.remote)
	sober(b, 'init')
	node(b, 'bobs-node-bbbb', 'Bob’s')
	sober(b, 'sync')

	node(a.dir, 'unsent-node-aaaa', 'Unsent')
	const out = sober(a.dir, 'sync', '--no-push')
	expect(out).toContain('bobs-node-bbbb')
	expect(out).toContain('not pushed')
	expect(existsSync(join(a.dir, '.sober/nodes/bobs-node-bbbb.json'))).toBe(true)

	// Bob syncing again must not see a node that was never sent.
	sober(b, 'sync')
	expect(existsSync(join(b, '.sober/nodes/unsent-node-aaaa.json'))).toBe(false)
	// And Alice still has it — a pull never overwrites work that never left.
	expect(existsSync(join(a.dir, '.sober/nodes/unsent-node-aaaa.json'))).toBe(true)
})

test('a node archived by one person disappears for the other', () => {
	const a = alice()
	node(a.dir, 'doomed-node-aaaa', 'Doomed')
	sober(a.dir, 'sync')
	const b = bob(a.remote)
	sober(b, 'init')
	expect(existsSync(join(b, '.sober/nodes/doomed-node-aaaa.json'))).toBe(true)

	sober(a.dir, 'archive', 'doomed-node-aaaa')
	sober(a.dir, 'sync')
	const pulled = sober(b, 'sync')
	expect(pulled).toContain('removed')
	expect(pulled).toContain('(archived)')
	expect(existsSync(join(b, '.sober/nodes/doomed-node-aaaa.json'))).toBe(false)
	expect(existsSync(join(b, '.sober/archive/nodes/doomed-node-aaaa.json'))).toBe(true)
})

test('a node that comes back from the archive does not read as a removal', () => {
	const a = alice()
	node(a.dir, 'doomed-node-aaaa', 'Doomed')
	sober(a.dir, 'sync')
	const b = bob(a.remote)
	sober(b, 'init')

	// One archives it while the other edits it — the archive question.
	edit(b, 'doomed-node-aaaa', '"title": "Bob is still on this"')
	sober(a.dir, 'archive', 'doomed-node-aaaa')
	sober(a.dir, 'sync')
	expect(refused(b, 'sync')).toContain('only you can say which')
	sober(b, 'resolve', 'doomed-node-aaaa', 'restore')
	sober(b, 'sync')

	// M2 gate finding 8: the archive entry going away was announced as
	// `removed … (archive)`, which reads as removed from the board — the
	// opposite of what happened.
	const back = sober(a.dir, 'sync')
	expect(back).toContain('(back on the board)')
	expect(existsSync(join(a.dir, '.sober/nodes/doomed-node-aaaa.json'))).toBe(true)
})

test('two people who touched different records merge with no question', () => {
	const a = alice()
	node(a.dir, 'shared-node-aaaa', 'Shared')
	sober(a.dir, 'sync')
	const b = bob(a.remote)
	sober(b, 'init')

	node(b, 'bob-only-bbbb', 'Bob only')
	sober(b, 'sync')
	node(a.dir, 'alice-only-aaaa', 'Alice only')

	expect(sober(a.dir, 'sync')).toContain('bob-only-bbbb')
	expect(existsSync(join(a.dir, '.sober/nodes/bob-only-bbbb.json'))).toBe(true)
	expect(existsSync(join(a.dir, '.sober/nodes/alice-only-aaaa.json'))).toBe(true)

	// And what Alice merged is what Bob gets back, with nothing left to say.
	expect(sober(b, 'sync')).toContain('alice-only-aaaa')
	expect(sober(b, 'sync')).toContain('nothing came in')
})

test('the same record changed on both sides is named, and nothing is touched', () => {
	const a = alice()
	node(a.dir, 'shared-node-aaaa', 'Shared')
	sober(a.dir, 'sync')
	const b = bob(a.remote)
	sober(b, 'init')

	node(b, 'shared-node-aaaa', 'Bob’s title')
	sober(b, 'sync')
	node(a.dir, 'shared-node-aaaa', 'Alice’s title')

	const out = refused(a.dir, 'sync')
	expect(out).toContain('changed on both sides')
	expect(out).toContain('shared-node-aaaa')
	// A refusal that names no way out is a support request (§8.7).
	expect(out).toContain('sober resolve')
	// Alice's own edit is still hers — the merge did not run.
	expect(readFileSync(join(a.dir, '.sober/nodes/shared-node-aaaa.json'), 'utf8')).toContain(
		'Alice’s title',
	)
})

test('resolve shows both versions, takes the answer, and lands the merge', () => {
	const a = alice()
	node(a.dir, 'shared-node-aaaa', 'Shared')
	sober(a.dir, 'sync')
	const b = bob(a.remote)
	sober(b, 'init')

	edit(b, 'shared-node-aaaa', '"title": "Bob’s title"')
	sober(b, 'sync')
	edit(a.dir, 'shared-node-aaaa', '"title": "Alice’s title"')
	expect(refused(a.dir, 'sync')).toContain('only you can say which')

	// The two versions, side by side, before anything is chosen.
	const shown = sober(a.dir, 'resolve')
	expect(shown).toContain('shared-node-aaaa')
	expect(shown).toContain('Alice’s title')
	expect(shown).toContain('Bob’s title')

	expect(sober(a.dir, 'resolve', 'shared-node-aaaa', 'title=theirs')).toContain('merge landed')
	expect(readFileSync(join(a.dir, '.sober/nodes/shared-node-aaaa.json'), 'utf8')).toContain(
		'Bob’s title',
	)
	expect(sober(a.dir, 'sync')).toContain('your board went out')
})

test('an answer that is not a side is refused before anything is written', () => {
	const a = alice()
	node(a.dir, 'shared-node-aaaa', 'Shared')
	sober(a.dir, 'sync')
	const b = bob(a.remote)
	sober(b, 'init')
	edit(b, 'shared-node-aaaa', '"title": "Bob’s"')
	sober(b, 'sync')
	edit(a.dir, 'shared-node-aaaa', '"title": "Alice’s"')
	refused(a.dir, 'sync')

	expect(refused(a.dir, 'resolve', 'shared-node-aaaa', 'title=mine')).toContain('is not an answer')
	expect(refused(a.dir, 'resolve', 'no-such-node-zzzz')).toContain('is not waiting on you')
})

test('a merge that breaks the board blocks the push and names the finding', () => {
	const a = alice()
	node(a.dir, 'shared-node-aaaa', 'Shared')
	sober(a.dir, 'sync')
	const b = bob(a.remote)
	sober(b, 'init')

	rmSync(join(b, '.sober/nodes/shared-node-aaaa.json'))
	sober(b, 'sync')
	node(a.dir, 'dependent-node-cccc', 'Dependent', ['shared-node-aaaa'])

	const out = refused(a.dir, 'sync')
	expect(out).toContain('does not hold together, so nothing went out')
	expect(out).toContain('depends on shared-node-aaaa')
	// And it stays blocked: the next sync does not wave the same board through.
	expect(refused(a.dir, 'sync')).toContain('does not hold together')
})

test('a repository with no remote commits the board and says where it went', () => {
	const created = createTempRepo()
	repo = created
	writeFileSync(join(created.dir, 'README.md'), '# solo\n')
	created.git('add', '-A')
	created.git('commit', '-m', 'chore: first')
	created.git('remote', 'remove', 'origin')
	sober(created.dir, 'init')
	node(created.dir, 'solo-node-aaaa', 'Solo')

	const out = sober(created.dir, 'sync')
	expect(out).toContain('no remote')
	expect(git(created.dir, 'ls-tree', '-r', '--name-only', 'sober-graph')).toContain(
		'.sober/nodes/solo-node-aaaa.json',
	)
})

test('init writes the attributes that keep markers out of records', () => {
	const a = alice()
	const attributes = readFileSync(join(a.dir, '.gitattributes'), 'utf8')
	expect(attributes).toContain('.sober/nodes/*.json merge=binary -text')
	expect(attributes).toContain('.sober/decisions/*.json merge=binary -text')
})

test('the board branch carries no config and no local state', () => {
	const a = alice()
	mkdirSync(join(a.dir, '.sober/local/runs'), { recursive: true })
	writeFileSync(join(a.dir, '.sober/local/runs/r.json'), '{}\n')
	node(a.dir, 'a-node-aaaa', 'A')
	sober(a.dir, 'sync')

	const listing = git(a.dir, 'ls-tree', '-r', '--name-only', 'sober-graph').split('\n')
	expect(listing).toContain('.sober/project.json')
	expect(listing).toContain('.sober/nodes/a-node-aaaa.json')
	expect(listing.some((path) => path.includes('local/'))).toBe(false)
	expect(listing).not.toContain('.sober/config.jsonc')
})
