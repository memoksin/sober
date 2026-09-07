import { execFileSync } from 'node:child_process'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
	adoptBoard,
	archiveNode,
	initBoard,
	openConflicts,
	type Paths,
	readArchivedNodes,
	readNodes,
	paths as resolve,
	resolveConflict,
	sync,
	writeNode,
} from '@besober/core'
import { afterEach, expect, test } from 'vitest'
import { createTempRepo, type TempRepo } from './fixture.js'

/**
 * The half of a merge a human is in. Everything here runs `core` in this
 * process against two real clones of one real remote — the field merge is the
 * highest-risk code in the package and ADR 0014 exists for exactly this.
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

const node = (fields: Partial<Record<string, unknown>> = {}) => ({
	title: 'A node',
	description: 'what it is',
	notes: '',
	dependsOn: [] as string[],
	decisions: [] as string[],
	files: [] as string[],
	brief: null,
	outcome: null,
	assignee: null,
	claim: null,
	accepted: null,
	dismissal: null,
	createdAt: '2026-09-05T00:00:00.000Z',
	...fields,
})

const git = (cwd: string, ...args: string[]): string =>
	execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

/** Two clones of one remote, both holding the same one node. */
const pair = async (): Promise<{ ours: Paths; theirs: Paths }> => {
	const created = createTempRepo()
	repo = created
	writeFileSync(join(created.dir, 'README.md'), '# fixture\n')
	created.git('add', '-A')
	created.git('commit', '-m', 'chore: first')
	const { paths } = await initBoard(created.dir, { title: 'Acme', intent: '', constraints: [] })
	created.git('add', '-A')
	created.git('commit', '-m', 'chore: sober')
	created.git('push', '-u', 'origin', 'main')

	await writeNode(paths, 'shared-aaaa', node())
	await sync(paths, BRANCH)

	const dir = join(created.remote, '..', 'clone')
	clone = dir
	execFileSync('git', ['clone', '--quiet', created.remote, dir])
	git(dir, 'config', 'user.name', 'Bob')
	git(dir, 'config', 'user.email', 'bob@example.com')
	git(dir, 'config', 'commit.gpgsign', 'false')
	const other = resolve(dir)
	await adoptBoard(other, BRANCH)
	return { ours: paths, theirs: other }
}

test('different fields of one record merge with no question, and neither is lost', async () => {
	const { ours, theirs } = await pair()
	await writeNode(theirs, 'shared-aaaa', node({ notes: 'from Bob' }))
	await sync(theirs, BRANCH)
	await writeNode(ours, 'shared-aaaa', node({ files: ['src/**'] }))

	const result = await sync(ours, BRANCH)
	expect(result.kind).toBe('synced')
	const merged = (await readNodes(ours)).records.get('shared-aaaa')
	expect(merged?.notes).toBe('from Bob')
	expect(merged?.files).toEqual(['src/**'])
})

test('the same field on both sides is the only question, and it is asked once', async () => {
	const { ours, theirs } = await pair()
	await writeNode(theirs, 'shared-aaaa', node({ title: 'Theirs', notes: 'from Bob' }))
	await sync(theirs, BRANCH)
	await writeNode(ours, 'shared-aaaa', node({ title: 'Ours' }))

	const result = await sync(ours, BRANCH)
	expect(result.kind).toBe('conflicted')
	expect(result.conflicts).toHaveLength(1)
	const [conflict] = result.conflicts
	expect(conflict?.kind).toBe('fields')
	if (conflict?.kind !== 'fields') throw new Error('expected a field conflict')
	// `notes` moved on one side only, so it is merged and never asked about.
	expect(conflict.fields.map((field) => field.field)).toEqual(['title'])
	expect(conflict.fields[0]?.ours).toContain('Ours')
	expect(conflict.fields[0]?.theirs).toContain('Theirs')
})

test('the human’s choice lands, and the field nobody chose keeps both edits', async () => {
	const { ours, theirs } = await pair()
	await writeNode(theirs, 'shared-aaaa', node({ title: 'Theirs', notes: 'from Bob' }))
	await sync(theirs, BRANCH)
	await writeNode(ours, 'shared-aaaa', node({ title: 'Ours', files: ['src/**'] }))
	await sync(ours, BRANCH)

	const done = await resolveConflict(ours, BRANCH, 'shared-aaaa', { title: 'theirs' })
	expect(done.kind).toBe('done')
	expect(done.findings).toEqual([])

	const merged = (await readNodes(ours)).records.get('shared-aaaa')
	expect(merged?.title).toBe('Theirs')
	expect(merged?.notes).toBe('from Bob')
	expect(merged?.files).toEqual(['src/**'])

	// And the merge really is a merge: the next sync has nothing to ask.
	expect((await sync(ours, BRANCH)).kind).toBe('synced')
	expect((await sync(theirs, BRANCH)).kind).toBe('synced')
	expect((await readNodes(theirs)).records.get('shared-aaaa')?.files).toEqual(['src/**'])
})

test('two conflicted records are answered one at a time, and land on the last', async () => {
	const { ours, theirs } = await pair()
	await writeNode(theirs, 'second-bbbb', node({ title: 'Second' }))
	await sync(theirs, BRANCH)
	await sync(ours, BRANCH)

	await writeNode(theirs, 'shared-aaaa', node({ title: 'Theirs one' }))
	await writeNode(theirs, 'second-bbbb', node({ title: 'Theirs two' }))
	await sync(theirs, BRANCH)
	await writeNode(ours, 'shared-aaaa', node({ title: 'Ours one' }))
	await writeNode(ours, 'second-bbbb', node({ title: 'Ours two' }))

	const conflicted = await sync(ours, BRANCH)
	expect(conflicted.conflicts).toHaveLength(2)

	const first = await resolveConflict(ours, BRANCH, 'shared-aaaa', { title: 'ours' })
	expect(first.kind).toBe('recorded')
	expect(first.left.map((conflict) => conflict.id)).toEqual(['second-bbbb'])

	const last = await resolveConflict(ours, BRANCH, 'second-bbbb', { title: 'theirs' })
	expect(last.kind).toBe('done')
	const nodes = (await readNodes(ours)).records
	expect(nodes.get('shared-aaaa')?.title).toBe('Ours one')
	expect(nodes.get('second-bbbb')?.title).toBe('Theirs two')
})

test('archived on one side and edited on the other is its own question', async () => {
	const { ours, theirs } = await pair()
	await archiveNode(theirs, 'shared-aaaa')
	await sync(theirs, BRANCH)
	await writeNode(ours, 'shared-aaaa', node({ notes: 'still working on it' }))

	const result = await sync(ours, BRANCH)
	expect(result.kind).toBe('conflicted')
	const [conflict] = result.conflicts
	expect(conflict?.kind).toBe('archived')
	if (conflict?.kind !== 'archived') throw new Error('expected an archive conflict')
	expect(conflict.by).toBe('theirs')
})

test('keeping the archive takes the record off the board', async () => {
	const { ours, theirs } = await pair()
	await archiveNode(theirs, 'shared-aaaa')
	await sync(theirs, BRANCH)
	await writeNode(ours, 'shared-aaaa', node({ notes: 'still working on it' }))
	await sync(ours, BRANCH)

	const done = await resolveConflict(ours, BRANCH, 'shared-aaaa', { record: 'keep' })
	expect(done.kind).toBe('done')
	expect((await readNodes(ours)).records.has('shared-aaaa')).toBe(false)
	expect((await readArchivedNodes(ours)).records.has('shared-aaaa')).toBe(true)
})

test('restoring puts it back, with the edit, and takes the archive entry away', async () => {
	const { ours, theirs } = await pair()
	await archiveNode(theirs, 'shared-aaaa')
	await sync(theirs, BRANCH)
	await writeNode(ours, 'shared-aaaa', node({ notes: 'still working on it' }))
	await sync(ours, BRANCH)

	const done = await resolveConflict(ours, BRANCH, 'shared-aaaa', { record: 'restore' })
	expect(done.kind).toBe('done')
	expect((await readNodes(ours)).records.get('shared-aaaa')?.notes).toBe('still working on it')
	expect((await readArchivedNodes(ours)).records.has('shared-aaaa')).toBe(false)
	expect(existsSync(join(ours.archivedNodes, 'shared-aaaa.json'))).toBe(false)

	// And it survives the round trip to the other clone.
	await sync(ours, BRANCH)
	await sync(theirs, BRANCH)
	expect((await readNodes(theirs)).records.get('shared-aaaa')?.notes).toBe('still working on it')
})

test('a clean merge that breaks the board blocks the push and says why', async () => {
	const { ours, theirs } = await pair()
	// One side removes the node, the other adds one depending on it. Two files,
	// so git merges them without a word (§1.2.1).
	rmSync(join(theirs.nodes, 'shared-aaaa.json'))
	await sync(theirs, BRANCH)
	await writeNode(ours, 'dependent-cccc', node({ dependsOn: ['shared-aaaa'] }))

	const result = await sync(ours, BRANCH)
	expect(result.kind).toBe('invalid')
	expect(result.pushed).toBe(false)
	expect(result.findings).toEqual([
		'dependent-cccc depends on shared-aaaa, which is not on this board',
	])
	// Nothing was undone: the merge is committed here.
	expect((await readNodes(ours)).records.has('dependent-cccc')).toBe(true)
	expect(git(ours.root, 'log', '--oneline', BRANCH)).toContain('board merge')
})

test('a merge that closes a cycle is caught by the same pass', async () => {
	const { ours, theirs } = await pair()
	await writeNode(ours, 'second-bbbb', node())
	await sync(ours, BRANCH)
	await sync(theirs, BRANCH)

	await writeNode(theirs, 'shared-aaaa', node({ dependsOn: ['second-bbbb'] }))
	await sync(theirs, BRANCH)
	await writeNode(ours, 'second-bbbb', node({ dependsOn: ['shared-aaaa'] }))

	const result = await sync(ours, BRANCH)
	expect(result.kind).toBe('invalid')
	expect(result.findings[0]).toContain('depend on each other in a circle')
})

test('a record nobody is waiting on cannot be resolved', async () => {
	const { ours, theirs } = await pair()
	await writeNode(theirs, 'shared-aaaa', node({ title: 'Theirs' }))
	await sync(theirs, BRANCH)
	await writeNode(ours, 'shared-aaaa', node({ title: 'Ours' }))
	await sync(ours, BRANCH)

	await expect(resolveConflict(ours, BRANCH, 'no-such-nnnn', { title: 'ours' })).rejects.toThrow(
		'is not one of the records waiting on you',
	)
})

test('a field nobody chose is not chosen by SOBER', async () => {
	const { ours, theirs } = await pair()
	await writeNode(theirs, 'shared-aaaa', node({ title: 'Theirs' }))
	await sync(theirs, BRANCH)
	await writeNode(ours, 'shared-aaaa', node({ title: 'Ours' }))
	await sync(ours, BRANCH)

	await expect(resolveConflict(ours, BRANCH, 'shared-aaaa', {})).rejects.toThrow(
		'nobody chose a value for title',
	)
})

test('the archive question refuses a side, because it is not one', async () => {
	const { ours, theirs } = await pair()
	await archiveNode(theirs, 'shared-aaaa')
	await sync(theirs, BRANCH)
	await writeNode(ours, 'shared-aaaa', node({ notes: 'mine' }))
	await sync(ours, BRANCH)

	await expect(resolveConflict(ours, BRANCH, 'shared-aaaa', { record: 'ours' })).rejects.toThrow(
		'say `keep` or `restore`',
	)
})

test('answers to a merge that moved on are not applied to the new one', async () => {
	const { ours, theirs } = await pair()
	await writeNode(theirs, 'second-bbbb', node({ title: 'Second' }))
	await sync(theirs, BRANCH)
	await sync(ours, BRANCH)

	await writeNode(theirs, 'shared-aaaa', node({ title: 'Theirs one' }))
	await writeNode(theirs, 'second-bbbb', node({ title: 'Theirs two' }))
	await sync(theirs, BRANCH)
	await writeNode(ours, 'shared-aaaa', node({ title: 'Ours one' }))
	await writeNode(ours, 'second-bbbb', node({ title: 'Ours two' }))
	await sync(ours, BRANCH)
	await resolveConflict(ours, BRANCH, 'shared-aaaa', { title: 'ours' })

	// The other side moves again before the second answer arrives.
	await writeNode(theirs, 'shared-aaaa', node({ title: 'Theirs three' }))
	await sync(theirs, BRANCH)
	await sync(ours, BRANCH)

	const again = await resolveConflict(ours, BRANCH, 'second-bbbb', { title: 'theirs' })
	// The earlier answer was to a merge that no longer exists, so it is dropped
	// and the record is asked about again rather than answered behind their back.
	expect(again.kind).toBe('recorded')
	expect(again.left.map((conflict) => conflict.id)).toEqual(['shared-aaaa'])
})

test('a merge holding a file that is not a record says so, and merges nothing', async () => {
	const { ours, theirs } = await pair()
	writeFileSync(join(theirs.nodes, 'shared-aaaa.json'), 'not json at all\n')
	await sync(theirs, BRANCH)
	writeFileSync(join(ours.nodes, 'shared-aaaa.json'), 'also not json\n')

	await expect(sync(ours, BRANCH)).rejects.toThrow('is not a record SOBER can read')
})

test('a choice that would make an unreadable record is refused, not written', async () => {
	const { ours, theirs } = await pair()
	await writeNode(theirs, 'shared-aaaa', node({ title: 'Theirs' }))
	await sync(theirs, BRANCH)
	// A title nothing would accept, written the way a hand edit writes one.
	writeFileSync(
		join(ours.nodes, 'shared-aaaa.json'),
		`${JSON.stringify(node({ title: '' }), null, '\t')}\n`,
	)
	await sync(ours, BRANCH)

	await expect(resolveConflict(ours, BRANCH, 'shared-aaaa', { title: 'ours' })).rejects.toThrow(
		'would produce a record SOBER cannot read',
	)
	// And the other choice still works, so nobody is stuck.
	const done = await resolveConflict(ours, BRANCH, 'shared-aaaa', { title: 'theirs' })
	expect(done.kind).toBe('done')
})

test('there is nothing to resolve before a sync has found anything', async () => {
	const { ours } = await pair()
	await expect(resolveConflict(ours, BRANCH, 'shared-aaaa', {})).rejects.toThrow(
		'is not one of the records waiting on you',
	)

	git(ours.root, 'remote', 'remove', 'origin')
	await expect(resolveConflict(ours, BRANCH, 'shared-aaaa', {})).rejects.toThrow('has no remote')
	expect(await openConflicts(ours, BRANCH)).toEqual([])
})

test('the same id created on both sides has no base, and every difference is asked', async () => {
	const { ours, theirs } = await pair()
	await writeNode(theirs, 'both-made-bbbb', node({ title: 'Theirs' }))
	await sync(theirs, BRANCH)
	await writeNode(ours, 'both-made-bbbb', node({ title: 'Ours' }))

	const result = await sync(ours, BRANCH)
	const [conflict] = result.conflicts
	if (conflict?.kind !== 'fields') throw new Error('expected a field conflict')
	expect(conflict.fields.map((field) => field.field)).toEqual(['title'])
})

test('a record that parses to something that is not a record is refused', async () => {
	const { ours, theirs } = await pair()
	writeFileSync(join(theirs.nodes, 'shared-aaaa.json'), '["a list", "not a record"]\n')
	await sync(theirs, BRANCH)
	writeFileSync(join(ours.nodes, 'shared-aaaa.json'), '["a different list"]\n')

	await expect(sync(ours, BRANCH)).rejects.toThrow('is not a record SOBER can read')
})

test('one record asks and another merges itself, in the same merge', async () => {
	const { ours, theirs } = await pair()
	await writeNode(theirs, 'quiet-bbbb', node())
	await sync(theirs, BRANCH)
	await sync(ours, BRANCH)

	await writeNode(theirs, 'shared-aaaa', node({ title: 'Theirs' }))
	await writeNode(theirs, 'quiet-bbbb', node({ notes: 'from Bob' }))
	await sync(theirs, BRANCH)
	await writeNode(ours, 'shared-aaaa', node({ title: 'Ours' }))
	await writeNode(ours, 'quiet-bbbb', node({ files: ['src/**'] }))

	const conflicted = await sync(ours, BRANCH)
	expect(conflicted.conflicts.map((conflict) => conflict.id)).toEqual(['shared-aaaa'])

	const done = await resolveConflict(ours, BRANCH, 'shared-aaaa', { title: 'ours' })
	expect(done.kind).toBe('done')
	const quiet = (await readNodes(ours)).records.get('quiet-bbbb')
	expect(quiet?.notes).toBe('from Bob')
	expect(quiet?.files).toEqual(['src/**'])
})

test('the open questions are the same ones the merge found', async () => {
	const { ours, theirs } = await pair()
	await writeNode(theirs, 'shared-aaaa', node({ title: 'Theirs' }))
	await sync(theirs, BRANCH)
	await writeNode(ours, 'shared-aaaa', node({ title: 'Ours' }))

	const conflicted = await sync(ours, BRANCH)
	const open = await openConflicts(ours, BRANCH)
	expect(open.map((conflict) => conflict.id)).toEqual(
		conflicted.conflicts.map((conflict) => conflict.id),
	)
	expect(open.every((conflict) => !conflict.answered)).toBe(true)
})

test('a record you answered stays in the list, marked, so you can change it', async () => {
	const { ours, theirs } = await pair()
	await writeNode(theirs, 'second-bbbb', node({ title: 'Second' }))
	await sync(theirs, BRANCH)
	await sync(ours, BRANCH)

	await writeNode(theirs, 'shared-aaaa', node({ title: 'Theirs one' }))
	await writeNode(theirs, 'second-bbbb', node({ title: 'Theirs two' }))
	await sync(theirs, BRANCH)
	await writeNode(ours, 'shared-aaaa', node({ title: 'Ours one' }))
	await writeNode(ours, 'second-bbbb', node({ title: 'Ours two' }))
	await sync(ours, BRANCH)

	await resolveConflict(ours, BRANCH, 'shared-aaaa', { title: 'ours' })
	const open = await openConflicts(ours, BRANCH)
	expect(open.map((conflict) => [conflict.id, conflict.answered])).toEqual([
		['second-bbbb', false],
		['shared-aaaa', true],
	])

	// Said again, it is the second answer that lands.
	await resolveConflict(ours, BRANCH, 'shared-aaaa', { title: 'theirs' })
	await resolveConflict(ours, BRANCH, 'second-bbbb', { title: 'ours' })
	expect((await readNodes(ours)).records.get('shared-aaaa')?.title).toBe('Theirs one')
})

test('a clone that never fetched the board has nothing to resolve', async () => {
	const { ours } = await pair()
	git(ours.root, 'update-ref', '-d', 'refs/remotes/origin/sober-graph')
	await expect(resolveConflict(ours, BRANCH, 'shared-aaaa', {})).rejects.toThrow(
		'run `sober sync` first',
	)
	expect(await openConflicts(ours, BRANCH)).toEqual([])
})

test('nothing is waiting when the boards agree', async () => {
	const { ours } = await pair()
	expect(await openConflicts(ours, BRANCH)).toEqual([])
})
