import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

// Observation only (docs/WINDOWS-CI-2026-09.md): with SOBER_FIXTURE_STATS set,
// one stderr line per repository created and per cleanup, with its duration.
// A cleanup slower than one retryDelay means rmSync's retries fired.
const RETRY_DELAY = 100
const stat = (event: string, since: number) => {
	if (process.env.SOBER_FIXTURE_STATS)
		writeSync(2, `sober-fixture ${event} ${Math.round(performance.now() - since)}ms\n`)
}

/**
 * Node binary as a POSIX-shell word, for acceptance/scanner commands that
 * run through posixShell(). Forward slashes, quoted, so `sh` doesn't read
 * the Windows path's backslashes as escapes (docs/WINDOWS-CI-2026-09.md).
 */
export const NODE_SH = JSON.stringify(process.execPath.replaceAll('\\', '/'))

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
	const started = performance.now()
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
	stat('create', started)

	return {
		dir,
		remote,
		git: (...args: string[]) => run(dir, args),
		// `maxRetries` is Node's own answer to Windows, where a file another
		// process still holds open makes the whole tree undeletable. `force`
		// covers a directory that is already gone; it does nothing for one that
		// is busy, and every fixture here has git processes that just exited.
		cleanup: () => {
			const began = performance.now()
			try {
				rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: RETRY_DELAY })
			} finally {
				stat('cleanup', began)
			}
		},
	}
}
