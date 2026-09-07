import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { paths } from '@besober/core'
import { type Client, type Served, serve } from '@besober/server'
import { afterEach, beforeAll, expect, test } from 'vitest'
import { createTempRepo, type TempRepo } from './fixture.js'

/**
 * The dashboard ships as built assets and the server hands them over
 * (STRUCTURE.md). Nothing here opens a file: the map is built into the binary,
 * which is what keeps `only-core-touches-the-machine` absolute.
 */
const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const SOBER = join(repoRoot, 'packages/cli/dist/sober.js')

beforeAll(() => {
	execFileSync(process.execPath, ['build.mjs'], { cwd: join(repoRoot, 'packages/cli') })
}, 180_000)

let repo: TempRepo | undefined
let served: Served | undefined

afterEach(async () => {
	await served?.close()
	served = undefined
	repo?.cleanup()
	repo = undefined
})

const CLIENT: Client = {
	'/index.html': { type: 'text/html; charset=utf-8', body: '<!doctype html><title>SOBER</title>' },
	'/assets/app.js': { type: 'text/javascript; charset=utf-8', body: 'console.log(1)' },
	'/assets/app.css': { type: 'text/css; charset=utf-8', body: ':root{}' },
}

const started = async (client?: Client): Promise<Served> => {
	const made = createTempRepo()
	writeFileSync(join(made.dir, 'package.json'), '{ "name": "under-test" }\n')
	made.git('add', '-A')
	made.git('commit', '-m', 'first')
	execFileSync(process.execPath, [SOBER, 'init'], { cwd: made.dir, encoding: 'utf8' })
	repo = made

	served = await serve({ paths: paths(made.dir), client })
	return served
}

test('the address a person is handed opens the dashboard', async () => {
	const { url } = await started(CLIENT)

	const response = await fetch(url)

	expect(response.status).toBe(200)
	expect(response.headers.get('content-type')).toMatch(/^text\/html/)
	expect(await response.text()).toContain('<title>SOBER</title>')
})

test('an asset is served at its own path, with its own type', async () => {
	const { url } = await started(CLIENT)

	const response = await fetch(new URL('/assets/app.css', url))

	expect(response.status).toBe(200)
	expect(response.headers.get('content-type')).toMatch(/^text\/css/)
	expect(await response.text()).toBe(':root{}')
})

test('assets need no token, because a script tag cannot send one', async () => {
	// A browser fetching `<script src>` attaches no `Authorization` header, and
	// there is nothing in these bytes to protect: they are the same for
	// everyone and carry no board.
	const { url } = await started(CLIENT)

	const response = await fetch(new URL('/assets/app.js', url))

	expect(response.status).toBe(200)
})

test('the page it serves carries no token', async () => {
	// The whole reason the token travels in the fragment. If it were in the
	// page, any process on this machine that guessed the port would have it.
	const { url, token } = await started(CLIENT)

	const body = await (await fetch(url)).text()

	expect(body).not.toContain(token)
})

test('an asset that was never built is a 404, not the page again', async () => {
	// A single-page app is tempting to serve for every path. Then a mistyped
	// script URL returns HTML with status 200 and the browser reports a syntax
	// error in a file that does not exist.
	const { url } = await started(CLIENT)

	expect((await fetch(new URL('/assets/gone.js', url))).status).toBe(404)
})

test('an asset map cannot shadow the wire', async () => {
	const { url } = await started({
		...CLIENT,
		'/read/projection': { type: 'text/javascript', body: 'not the board' },
	})

	// Still the wire's, and still guarded: the client is consulted only where
	// no route answers.
	expect((await fetch(new URL('/read/projection', url))).status).toBe(401)
})

test('without a client the address still explains itself', async () => {
	// `pnpm dev` runs the server without a built dashboard, and a person who
	// opens the printed address then deserves a sentence rather than a 404.
	const { url } = await started()

	const response = await fetch(url)

	expect(response.status).toBe(200)
	expect(response.headers.get('content-type')).toMatch(/^text\/plain/)
	expect(await response.text()).toContain('SOBER')
})
