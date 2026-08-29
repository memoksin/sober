import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { createTempRepo, type TempRepo } from './fixture.js'

let repo: TempRepo | undefined

afterEach(() => {
	repo?.cleanup()
	repo = undefined
})

test('commits in the working repository reach the bare remote', () => {
	repo = createTempRepo()

	writeFileSync(join(repo.dir, 'README.md'), '# fixture\n')
	repo.git('add', 'README.md')
	repo.git('commit', '-m', 'chore: first')
	repo.git('push', '-u', 'origin', 'main')

	const local = repo.git('rev-parse', 'HEAD')
	const pushed = repo.git('ls-remote', 'origin', 'refs/heads/main').split('\t')[0]

	expect(pushed).toBe(local)
})
