import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type TempRepo = {
	/** Working repository with `origin` pointing at `remote`. */
	dir: string
	/** Bare repository standing in for GitHub. */
	remote: string
	git: (...args: string[]) => string
	cleanup: () => void
}

/**
 * A real git repository with a real bare remote. Every integration test that
 * touches git plumbing runs against this, never against a mock (ADR 0014).
 */
export function createTempRepo(): TempRepo {
	const root = mkdtempSync(join(tmpdir(), 'sober-it-'))
	const dir = join(root, 'work')
	const remote = join(root, 'remote.git')

	const run = (cwd: string, args: string[]) =>
		execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

	run(root, ['init', '--bare', '--initial-branch=main', remote])
	run(root, ['init', '--initial-branch=main', dir])
	run(dir, ['config', 'user.name', 'SOBER Test'])
	run(dir, ['config', 'user.email', 'test@besober.dev'])
	run(dir, ['config', 'commit.gpgsign', 'false'])
	run(dir, ['remote', 'add', 'origin', remote])

	return {
		dir,
		remote,
		git: (...args: string[]) => run(dir, args),
		// `maxRetries` is Node's own answer to Windows, where a file another
		// process still holds open makes the whole tree undeletable. `force`
		// covers a directory that is already gone; it does nothing for one that
		// is busy, and every fixture here has git processes that just exited.
		cleanup: () => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
	}
}
