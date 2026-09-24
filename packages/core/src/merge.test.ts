import { afterEach, expect, test, vi } from 'vitest'
import { git, hasUncommitted, isAncestor, refExists } from './git.js'
import { deleteBranch, MergeRefusedError, mergeNode, unmergeNode } from './merge.js'
import type { Paths } from './paths.js'

// Every git call goes through `git.js`, mocked here so `merge.ts`'s decisions —
// which include the conflict-abort path from 5cd3827, unreachable through a
// real git repository without racing a second process onto a half-merged
// checkout — are testable as pure branches on canned answers.
vi.mock('./git.js', () => ({
	git: vi.fn(),
	hasUncommitted: vi.fn(),
	isAncestor: vi.fn(),
	refExists: vi.fn(),
}))

const paths = { root: '/repo' } as Paths

afterEach(() => {
	vi.mocked(git).mockReset()
	vi.mocked(hasUncommitted).mockReset()
	vi.mocked(isAncestor).mockReset()
	vi.mocked(refExists).mockReset()
})

test('a dirty checkout refuses the merge before touching git', async () => {
	vi.mocked(hasUncommitted).mockResolvedValue(true)
	await expect(mergeNode(paths, 'id', 'main')).rejects.toThrow(/uncommitted changes/)
})

test('a checkout on the wrong branch refuses the merge', async () => {
	vi.mocked(hasUncommitted).mockResolvedValue(false)
	vi.mocked(git).mockImplementation(async (_root, ...args) => {
		if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'feature'
		throw new Error(`unexpected git ${args.join(' ')}`)
	})
	await expect(mergeNode(paths, 'id', 'main')).rejects.toThrow(/is not on main/)
})

test('a clean merge lands and reports the new head', async () => {
	vi.mocked(hasUncommitted).mockResolvedValue(false)
	let head = 'before-sha'
	vi.mocked(git).mockImplementation(async (_root, ...args) => {
		if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'main'
		if (args[0] === 'rev-parse' && args[1] === 'HEAD') return head
		if (args[0] === 'merge' && args[1] === '--no-ff') {
			head = 'merged-sha'
			return ''
		}
		throw new Error(`unexpected git ${args.join(' ')}`)
	})
	const merged = await mergeNode(paths, 'id', 'main')
	expect(merged).toEqual({ branch: 'sober/id', base: 'main', commit: 'merged-sha' })
})

test('a conflicting merge is aborted, and the base is reported as left as it was', async () => {
	let mergeHeadExists = true
	vi.mocked(hasUncommitted).mockResolvedValue(false)
	vi.mocked(refExists).mockImplementation(
		async (_root, ref) => ref === 'MERGE_HEAD' && mergeHeadExists,
	)
	vi.mocked(git).mockImplementation(async (_root, ...args) => {
		if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'main'
		if (args[0] === 'rev-parse' && args[1] === 'HEAD') return 'before-sha'
		if (args[0] === 'merge' && args[1] === '--no-ff') throw new Error('conflict')
		if (args[0] === 'merge' && args[1] === '--abort') {
			mergeHeadExists = false
			return ''
		}
		throw new Error(`unexpected git ${args.join(' ')}`)
	})
	await expect(mergeNode(paths, 'id', 'main')).rejects.toThrow(MergeRefusedError)
	await expect(mergeNode(paths, 'id', 'main')).rejects.toThrow(
		/does not merge into main cleanly — main is left as it was/,
	)
})

test('a conflicted merge that cannot be put back says so, and does not guess', async () => {
	vi.mocked(hasUncommitted).mockResolvedValue(false)
	// The abort itself fails, or leaves MERGE_HEAD in place either way —
	// `restored` reads that as "still mid-merge" and refuses to pretend.
	vi.mocked(refExists).mockResolvedValue(true)
	vi.mocked(git).mockImplementation(async (_root, ...args) => {
		if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'main'
		if (args[0] === 'rev-parse' && args[1] === 'HEAD') return 'before-sha'
		if (args[0] === 'merge' && args[1] === '--no-ff') throw new Error('conflict')
		if (args[0] === 'merge' && args[1] === '--abort') throw new Error('nothing to abort')
		throw new Error(`unexpected git ${args.join(' ')}`)
	})
	await expect(mergeNode(paths, 'id', 'main')).rejects.toThrow(
		/could not be put back at before-sha.*mid-merge/s,
	)
})

test('unmergeNode resets when the checkout still stands exactly on the merge', async () => {
	vi.mocked(hasUncommitted).mockResolvedValue(false)
	vi.mocked(git).mockImplementation(async (_root, ...args) => {
		if (args[0] === 'rev-parse' && args[1] === 'HEAD') return 'merged-sha'
		if (args[0] === 'reset') return ''
		throw new Error(`unexpected git ${args.join(' ')}`)
	})
	const ok = await unmergeNode(paths, { branch: 'sober/id', base: 'main', commit: 'merged-sha' })
	expect(ok).toBe(true)
})

test('unmergeNode refuses when something else already moved the head on', async () => {
	vi.mocked(git).mockImplementation(async (_root, ...args) => {
		if (args[0] === 'rev-parse' && args[1] === 'HEAD') return 'someone-elses-sha'
		throw new Error(`unexpected git ${args.join(' ')}`)
	})
	const ok = await unmergeNode(paths, { branch: 'sober/id', base: 'main', commit: 'merged-sha' })
	expect(ok).toBe(false)
})

test('unmergeNode refuses when the checkout has changes on top of the merge', async () => {
	vi.mocked(hasUncommitted).mockResolvedValue(true)
	vi.mocked(git).mockImplementation(async (_root, ...args) => {
		if (args[0] === 'rev-parse' && args[1] === 'HEAD') return 'merged-sha'
		throw new Error(`unexpected git ${args.join(' ')}`)
	})
	const ok = await unmergeNode(paths, { branch: 'sober/id', base: 'main', commit: 'merged-sha' })
	expect(ok).toBe(false)
})

test('deleteBranch refuses a branch holding commits the base does not have', async () => {
	vi.mocked(isAncestor).mockResolvedValue(false)
	await expect(deleteBranch(paths, 'id')).rejects.toThrow(/holds commits the base does not have/)
})

test('deleteBranch with force deletes without checking ancestry, for a host-side merge', async () => {
	vi.mocked(isAncestor).mockResolvedValue(false)
	vi.mocked(git).mockImplementation(async (_root, ...args) => {
		if (args[0] === 'branch' && args[1] === '-D') return ''
		throw new Error(`unexpected git ${args.join(' ')}`)
	})
	await expect(deleteBranch(paths, 'id', { force: true })).resolves.toBeUndefined()
	expect(isAncestor).not.toHaveBeenCalled()
})
