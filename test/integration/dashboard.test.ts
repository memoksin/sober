import { execFileSync, spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, expect, test } from 'vitest'
import { createTempRepo, type TempRepo } from './fixture.js'

/**
 * `sober dashboard` is the one command that does not exit, so it is the one
 * command `execFileSync` cannot test. ADR 0037 is what makes that deliberate:
 * the server's lifetime is this command's, not a browser tab's, and a run
 * started from the screen is owned by this process.
 */
const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const SOBER = join(repoRoot, 'packages/cli/dist/sober.js')

beforeAll(() => {
	execFileSync(process.execPath, ['build.mjs'], { cwd: join(repoRoot, 'packages/cli') })
}, 180_000)

let repo: TempRepo | undefined
let running: ReturnType<typeof spawn> | undefined

afterEach(() => {
	running?.kill('SIGKILL')
	running = undefined
	repo?.cleanup()
	repo = undefined
})

const board = (): TempRepo => {
	const made = createTempRepo()
	writeFileSync(join(made.dir, 'package.json'), '{ "name": "under-test" }\n')
	made.git('add', '-A')
	made.git('commit', '-m', 'first')
	execFileSync(process.execPath, [SOBER, 'init'], {
		cwd: made.dir,
		encoding: 'utf8',
		env: { ...process.env, NO_COLOR: '1' },
	})
	return made
}

/** Start it, and resolve with everything it printed up to the point it settled. */
const start = (cwd: string): Promise<{ out: string; url: string; token: string }> =>
	new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [SOBER, 'dashboard'], {
			cwd,
			env: { ...process.env, NO_COLOR: '1' },
		})
		running = child

		let out = ''
		const timer = setTimeout(() => reject(new Error(`nothing usable printed:\n${out}`)), 20_000)

		child.stdout.on('data', (chunk: Buffer) => {
			out += chunk.toString()
			const url = /http:\/\/127\.0\.0\.1:\d+\//.exec(out)?.[0]
			const token = /\b[0-9a-f]{64}\b/.exec(out)?.[0]
			if (url !== undefined && token !== undefined) {
				clearTimeout(timer)
				resolve({ out, url, token })
			}
		})
		child.stderr.on('data', (chunk: Buffer) => {
			out += chunk.toString()
		})
		child.on('error', reject)
		child.on('exit', (code) => {
			clearTimeout(timer)
			reject(new Error(`it exited with ${code} instead of staying up:\n${out}`))
		})
	})

test('it prints a loopback address and a token, and stays up', async () => {
	repo = board()

	const { out, url, token } = await start(repo.dir)

	expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)
	expect(token).toHaveLength(64)
	// ADR 0037: the thing a person has to know is what stops it.
	expect(out.toLowerCase()).toContain('ctrl-c')
	expect(running?.exitCode).toBeNull()
})

test('what it printed is what serves the board', async () => {
	repo = board()

	const { url, token } = await start(repo.dir)
	const response = await fetch(new URL('/read/projection', url), {
		headers: { authorization: `Bearer ${token}` },
	})

	expect(response.status).toBe(200)
	expect(await response.json()).toEqual({ nodes: [] })
})

test('the token it printed is the only one that works', async () => {
	repo = board()

	const { url } = await start(repo.dir)
	const response = await fetch(new URL('/read/projection', url), {
		headers: { authorization: `Bearer ${'0'.repeat(64)}` },
	})

	expect(response.status).toBe(401)
})

test('Ctrl-C is what stops it, and it stops', async () => {
	repo = board()

	const { url, token } = await start(repo.dir)
	const stopped = new Promise<number | null>((resolve) => {
		running?.on('exit', (code) => resolve(code))
	})

	running?.kill('SIGINT')
	await stopped

	await expect(
		fetch(new URL('/read/projection', url), { headers: { authorization: `Bearer ${token}` } }),
	).rejects.toThrow()
})

test('outside a board it refuses rather than serving nothing', async () => {
	repo = createTempRepo()

	await expect(start(repo.dir)).rejects.toThrow(/exited with/)
})
