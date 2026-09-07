import { execFileSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
	adoptBoard,
	digest,
	initBoard,
	type Paths,
	paths as resolve,
	sync,
	writeDecision,
	writeNode,
} from '@besober/core'
import type { Accepted, Answer } from '@besober/schema'
import { afterEach, expect, test } from 'vitest'
import { createTempRepo, type TempRepo } from './fixture.js'

/**
 * DESIGN §7.1's delta half, against real git. Nothing here is stored: the
 * answer is a `git fetch` and a diff between the local board branch and its
 * remote-tracking ref, which is why the test has to have two clones and a real
 * remote rather than a fixture that pretends to.
 */
const BRANCH = 'sober-graph'

let repo: TempRepo | undefined
let clone: string | undefined

afterEach(() => {
	repo?.cleanup()
	repo = undefined
	if (clone !== undefined) rmSync(clone, { recursive: true, force: true })
	clone = undefined
})

const AT = '2026-09-05T00:00:00.000Z'

const node = (title: string, accepted: Accepted | null = null) => ({
	title,
	description: title,
	notes: '',
	dependsOn: [],
	decisions: [],
	files: [],
	brief: null,
	outcome: null,
	assignee: null,
	claim: null,
	accepted,
	dismissal: null,
	createdAt: AT,
})

const decision = (answer: Answer | null = null) => ({
	category: 'state' as const,
	question: 'Where does session state live?',
	options: [
		{ id: 'cookie', label: 'Cookie', reason: 'No server state', costLater: 'Size limits' },
		{ id: 'redis', label: 'Redis', reason: 'Revocable', costLater: 'A service to run' },
	],
	suggested: null,
	answer,
	createdAt: AT,
})

const ANSWER: Answer = { option: 'cookie', rationale: 'Simplest', by: 'alice', at: AT }
const ACCEPTED: Accepted = { by: 'alice', at: AT, flagged: false, scan: 'clean', audit: 'passed' }

const git = (cwd: string, ...args: string[]): string =>
	execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

/** Alice: a repository with a board on a real remote. */
const alice = async (): Promise<{ created: TempRepo; paths: Paths }> => {
	const created = createTempRepo()
	repo = created
	writeFileSync(join(created.dir, 'README.md'), '# acme\n')
	created.git('add', '-A')
	created.git('commit', '-m', 'chore: first')
	const { paths } = await initBoard(created.dir, { title: 'Acme', intent: '', constraints: [] })
	created.git('add', '-A')
	created.git('commit', '-m', 'chore: sober')
	created.git('push', '-u', 'origin', 'main')
	return { created, paths }
}

/** Bob: a clone that has taken the board in, and is now level with it. */
const bob = async (remote: string): Promise<Paths> => {
	const dir = join(remote, '..', 'bob')
	clone = dir
	execFileSync('git', ['clone', '--quiet', remote, dir])
	git(dir, 'config', 'user.name', 'Bob')
	git(dir, 'config', 'user.email', 'bob@example.com')
	git(dir, 'config', 'commit.gpgsign', 'false')
	const paths = resolve(dir)
	await adoptBoard(paths, BRANCH)
	return paths
}

test('a node added on the other side is a new node in the delta', async () => {
	const { created, paths } = await alice()
	await writeNode(paths, 'first-node-aaaa', node('First'))
	await sync(paths, BRANCH)

	const theirs = await bob(created.remote)
	await writeNode(paths, 'second-node-bbbb', node('Second'))
	await sync(paths, BRANCH)

	const seen = await digest(theirs, { fetch: true })
	expect(seen.unreachable).toBeNull()
	expect(seen.delta).toEqual({ nodes: ['second-node-bbbb'], answered: [], finished: [] })
})

test('an answer that went from null to a record is a decision answered', async () => {
	const { created, paths } = await alice()
	await writeDecision(paths, 'auth-model-k7f2', decision())
	await sync(paths, BRANCH)

	const theirs = await bob(created.remote)
	await writeDecision(paths, 'auth-model-k7f2', decision(ANSWER))
	await sync(paths, BRANCH)

	expect((await digest(theirs, { fetch: true })).delta).toEqual({
		nodes: [],
		answered: ['auth-model-k7f2'],
		finished: [],
	})
})

test('an accepted record that arrived is work finished, and an edit is neither', async () => {
	const { created, paths } = await alice()
	await writeNode(paths, 'first-node-aaaa', node('First'))
	await writeNode(paths, 'other-node-cccc', node('Other'))
	await sync(paths, BRANCH)

	const theirs = await bob(created.remote)
	await writeNode(paths, 'first-node-aaaa', node('First', ACCEPTED))
	// A retitled node changed too, and is not news: §7.1 lists five things and
	// "somebody edited a description" is not one of them.
	await writeNode(paths, 'other-node-cccc', node('Renamed'))
	await sync(paths, BRANCH)

	expect((await digest(theirs, { fetch: true })).delta).toEqual({
		nodes: [],
		answered: [],
		finished: ['first-node-aaaa'],
	})
})

test('without the fetch the delta is whatever the last one left', async () => {
	const { created, paths } = await alice()
	await writeNode(paths, 'first-node-aaaa', node('First'))
	await sync(paths, BRANCH)

	const theirs = await bob(created.remote)
	await writeNode(paths, 'second-node-bbbb', node('Second'))
	await sync(paths, BRANCH)

	// §1.2: a fetch may be automatic, and this is the caller saying not now.
	// The remote moved and the remote-tracking ref did not, so there is nothing
	// to report — and nothing that could report it was a network call.
	const stale = await digest(theirs, { fetch: false })
	expect(stale.unreachable).toBeNull()
	expect(stale.delta).toEqual({ nodes: [], answered: [], finished: [] })

	expect((await digest(theirs, { fetch: true })).delta?.nodes).toEqual(['second-node-bbbb'])
})

test('with no remote the delta half is empty and says so, and the snapshot half works', async () => {
	const created = createTempRepo()
	repo = created
	writeFileSync(join(created.dir, 'README.md'), '# solo\n')
	created.git('add', '-A')
	created.git('commit', '-m', 'chore: first')
	created.git('remote', 'remove', 'origin')
	const { paths } = await initBoard(created.dir, { title: 'Solo', intent: '', constraints: [] })
	await writeNode(paths, 'first-node-aaaa', node('First'))

	const seen = await digest(paths, { fetch: true })
	expect(seen.delta).toBeNull()
	// §8.7: what failed, and what to do about it.
	expect(seen.unreachable).toContain('no remote')
	// The half a single user actually needs is unaffected by the other's absence.
	expect(seen.inReview).toEqual([])
	expect(seen.flagged).toEqual([])
})

test('a remote that cannot be reached is said out loud, not thrown', async () => {
	const { created, paths } = await alice()
	await writeNode(paths, 'first-node-aaaa', node('First'))
	await sync(paths, BRANCH)
	rmSync(created.remote, { recursive: true, force: true })

	const seen = await digest(paths, { fetch: true })
	expect(seen.delta).toBeNull()
	expect(seen.unreachable).toContain('could not be reached')
})

test('a board that has never been synced has nothing to compare, and says which', async () => {
	const { paths } = await alice()
	await writeNode(paths, 'first-node-aaaa', node('First'))

	const seen = await digest(paths, { fetch: true })
	expect(seen.delta).toBeNull()
	expect(seen.unreachable).toContain('sober sync')
})

/**
 * Both refs resolve and git still refuses — a tree the object store no longer
 * has. It is the one way the delta half fails that has no nice message, and it
 * is the one that proves the halves are separate: the snapshot is read off the
 * working tree, so a broken object store has no say in it.
 */
test('a board branch git cannot read loses the delta half and keeps the other', async () => {
	const { created, paths } = await alice()
	await writeNode(paths, 'first-node-aaaa', node('First'))
	await sync(paths, BRANCH)

	const tree = git(created.dir, 'rev-parse', `${BRANCH}^{tree}`)
	rmSync(join(created.dir, '.git/objects', tree.slice(0, 2), tree.slice(2)), { force: true })
	// The commit is still there, so nothing upstream of the diff notices.
	expect(git(created.dir, 'rev-parse', '--verify', '--quiet', `${BRANCH}^{commit}`)).toHaveLength(
		40,
	)

	const seen = await digest(paths, { fetch: false })
	expect(seen.delta).toBeNull()
	// Our sentence, not git's: git's is localised and this one has to be read.
	expect(seen.unreachable).toContain('the board branch could not be read')
	expect(seen.inReview).toEqual([])
})
