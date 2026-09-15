import { expect, test } from 'vitest'
import { GitError, git, isRepo } from './git.js'
import { tmpRoot } from './tmp.fixture.js'

/**
 * The one question every git call is allowed to ask before it is safe to make
 * another: is this a repository at all. `sober init` refuses on a false here,
 * and "the command exploded" and "this is not a repository" are the two answers
 * a person needs told apart — so the failure is a `false`, never a throw.
 */
test('a directory that is not a repository answers false rather than throwing', async () => {
	expect(await isRepo(await tmpRoot('sober-not-a-repo-'))).toBe(false)
})

test('git speaks English whatever the locale, so the stderr core matches stays readable', async () => {
	const bare = await tmpRoot('sober-git-bare-')
	const work = await tmpRoot('sober-git-work-')
	await git(bare, 'init', '--bare')
	await git(work, 'init')
	await git(work, 'remote', 'add', 'origin', bare)
	const saved = { LANG: process.env.LANG, LC_ALL: process.env.LC_ALL }
	process.env.LANG = 'tr_TR.UTF-8'
	process.env.LC_ALL = 'tr_TR.UTF-8'
	try {
		const error = await git(
			work,
			'fetch',
			'origin',
			'+refs/heads/sober/board:refs/remotes/origin/sober/board',
		).catch((e: unknown) => e)
		expect(error).toBeInstanceOf(GitError)
		expect((error as GitError).stderr).toContain("couldn't find remote ref")
	} finally {
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[key]
			else process.env[key] = value
		}
	}
})
