import { expect, test } from 'vitest'
import { isRepo } from './git.js'
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
