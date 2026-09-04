import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { SoberError } from './errors.js'

const run = promisify(execFile)

export class GitError extends SoberError {
	constructor(
		readonly args: readonly string[],
		readonly stderr: string,
	) {
		super('git', `git ${args.join(' ')} failed: ${stderr.trim().split('\n')[0] ?? 'no output'}`)
	}
}

/**
 * Every git call in SOBER goes through here: `execFile`, never a shell, so a
 * branch name or a path carrying a space or a semicolon is an argument and
 * never a second command.
 */
export const git = (cwd: string, ...args: string[]): Promise<string> => gitWithEnv(cwd, {}, args)

/**
 * The same call with extra environment. Only `GIT_INDEX_FILE` needs it today —
 * writing a tree with no working copy — and an env-based variant beats a second
 * `execFile` site that forgets the no-shell rule.
 */
export const gitWithEnv = async (
	cwd: string,
	env: Readonly<Record<string, string>>,
	args: readonly string[],
): Promise<string> => {
	try {
		const { stdout } = await run('git', [...args], {
			cwd,
			encoding: 'utf8',
			maxBuffer: 32 * 1024 * 1024,
			env: { ...process.env, ...env },
		})
		return stdout.trimEnd()
	} catch (error) {
		throw new GitError(args, (error as { stderr?: string }).stderr ?? String(error))
	}
}

/**
 * Whoever git says is committing here. SOBER never asks for a second identity,
 * and every surface attributes with the same name — which is why this lives
 * beside the other git calls rather than in whichever surface asked first.
 */
export const whoami = async (root: string): Promise<string> => {
	const name = await git(root, 'config', 'user.name').catch(() => '')
	return name.trim() === '' ? 'unknown' : name.trim()
}

export const isRepo = async (dir: string): Promise<boolean> => {
	try {
		return (await git(dir, 'rev-parse', '--is-inside-work-tree')) === 'true'
	} catch {
		return false
	}
}

export const currentBranch = (dir: string): Promise<string> =>
	git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')

export const hasRemote = async (dir: string): Promise<boolean> =>
	(await git(dir, 'remote')).length > 0

export const refExists = async (dir: string, ref: string): Promise<boolean> => {
	try {
		await git(dir, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`)
		return true
	} catch {
		return false
	}
}

/** Uncommitted or untracked: the one question every removal and merge asks first. */
export const isDirty = async (dir: string): Promise<boolean> =>
	(await git(dir, 'status', '--porcelain')).length > 0

/**
 * Configuration that governs a run or a review is read from the base ref, never
 * from the branch under review (ADR 0019). An agent that relaxes the scan or
 * rewrites `dispatch.setup` in its own branch does not change what is applied to
 * its own branch — the edit is a diff line a human reads first.
 *
 * A base that carries no such file returns null, and the caller falls back to
 * the bundled default.
 */
export const showFromRef = async (
	dir: string,
	ref: string,
	path: string,
): Promise<string | null> => {
	try {
		return await git(dir, 'show', `${ref}:${path}`)
	} catch {
		return null
	}
}

/** The repository root, so every other call can be given one place to stand. */
export const repoRoot = async (dir: string): Promise<string> => {
	const top = await git(dir, 'rev-parse', '--show-toplevel')
	return join(top)
}
