import type { Contributor } from '@besober/schema'
import { Contributors } from '@besober/schema'
import { SoberError } from './errors.js'
import { withLock } from './lock.js'
import type { Paths } from './paths.js'
import { readRecord } from './read.js'
import { writeRecord } from './write.js'

/**
 * Who is on the project (DESIGN §3.3). A board with nobody on it yet is not an
 * error — a file that will not parse is, because the next write would replace
 * whatever it holds.
 */
export const readContributors = async (paths: Paths): Promise<readonly Contributor[]> => {
	const record = await readRecord(paths.contributors, Contributors)
	if (record.kind === 'missing') return []
	if (record.kind === 'broken')
		throw new SoberError('schema', `${record.file} cannot be read: ${record.reason}`)
	return record.value.contributors
}

/**
 * A handle names a person, and `Bob` is not a second person from `bob`. Found
 * in the M2 gate: `contributors add bob` was accepted, the claim that followed
 * still said "you are not on this project yet" — `whoami` reads git's
 * `user.name` — and running what it suggested left one human on the board
 * twice, with no warning.
 */
export const sameHandle = (left: string, right: string): boolean =>
	left.toLowerCase() === right.toLowerCase()

/**
 * Adding someone already there replaces them, so the same command corrects a
 * role — and corrects the spelling of their handle with it.
 */
export const addContributor = (paths: Paths, contributor: Contributor): Promise<void> =>
	withLock(paths, 'contributors', async () => {
		const team = (await readContributors(paths)).filter(
			(person) => !sameHandle(person.handle, contributor.handle),
		)
		await write(paths, [...team, contributor])
	})

export const removeContributor = (paths: Paths, handle: string): Promise<boolean> =>
	withLock(paths, 'contributors', async () => {
		const team = await readContributors(paths)
		const left = team.filter((person) => !sameHandle(person.handle, handle))
		if (left.length === team.length) return false
		await write(paths, left)
		return true
	})

const write = (paths: Paths, contributors: readonly Contributor[]): Promise<void> =>
	writeRecord(paths.contributors, {
		contributors: [...contributors].sort((left, right) => left.handle.localeCompare(right.handle)),
	})
