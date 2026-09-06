import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { paths } from '@besober/core'
import { type Served, serve } from '@besober/server'
import { afterEach, beforeAll, expect, test } from 'vitest'
import { createTempRepo, type TempRepo } from './fixture.js'

/**
 * One board, two surfaces, and the thing `PR-09-08` actually promises: what
 * you do on one is what the other sees. The contract test proves the
 * operations exist everywhere; this proves they mean the same thing.
 */
const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const SOBER = join(repoRoot, 'packages/cli/dist/sober.js')

beforeAll(() => {
	execFileSync(process.execPath, ['build.mjs'], { cwd: join(repoRoot, 'packages/cli') })
}, 180_000)

let repo: TempRepo | undefined
let server: Served | undefined

afterEach(async () => {
	await server?.close()
	server = undefined
	repo?.cleanup()
	repo = undefined
})

const sober = (cwd: string, ...args: string[]): string =>
	execFileSync(process.execPath, [SOBER, ...args], {
		cwd,
		encoding: 'utf8',
		env: { ...process.env, NO_COLOR: '1' },
	})

const board = (): TempRepo => {
	const made = createTempRepo()
	writeFileSync(join(made.dir, 'package.json'), '{ "name": "under-test" }\n')
	made.git('add', '-A')
	made.git('commit', '-m', 'first')
	sober(made.dir, 'init')
	return made
}

const post = async (operation: string, body: unknown): Promise<Response> =>
	fetch(new URL(`/op/${operation}`, server?.url), {
		method: 'POST',
		headers: {
			authorization: `Bearer ${server?.token}`,
			'content-type': 'application/json',
		},
		body: JSON.stringify(body),
	})

const get = async (read: string, query = ''): Promise<Response> =>
	fetch(new URL(`/read/${read}${query}`, server?.url), {
		headers: { authorization: `Bearer ${server?.token}` },
	})

test('an operation performed on the wire is one the command line sees', async () => {
	repo = board()
	server = await serve({ paths: paths(repo.dir) })

	const added = await post('contributors_add', {
		contributor: { handle: 'Ada', name: 'Ada Lovelace', role: '', focus: '' },
	})

	expect(added.status).toBe(200)
	expect(sober(repo.dir, 'contributors')).toContain('Ada')
})

test('an operation performed on the command line is one the wire sees', async () => {
	repo = board()
	server = await serve({ paths: paths(repo.dir) })

	sober(repo.dir, 'contributors', 'add', 'Grace')
	const removed = await post('contributors_remove', { handle: 'Grace' })

	expect(removed.status).toBe(200)
	expect(await removed.json()).toEqual({ removed: true })
	expect(sober(repo.dir, 'contributors')).not.toContain('Grace')
})

test('removing somebody who is not there is a false, not a failure', async () => {
	repo = board()
	server = await serve({ paths: paths(repo.dir) })

	const removed = await post('contributors_remove', { handle: 'Nobody' })

	expect(removed.status).toBe(200)
	expect(await removed.json()).toEqual({ removed: false })
})

/**
 * A valid body naming a node that is not there. The parse succeeds, so the
 * handler runs and `core` is the thing that refuses — which is what separates
 * "this route reaches core" from "this route dies in its own wrapper". A wrong
 * argument order inside a handler is the one mistake typechecking cannot catch
 * on calls whose parameters share a type.
 */
const missing = 'not-on-this-board-aaaa'
const reachesCore: readonly (readonly [string, unknown])[] = [
	['bind', { node: missing, dependsOn: [] }],
	['approve', { node: missing }],
	['run', { node: missing }],
	['accept', { node: missing }],
	['reject', { node: missing, text: 'no' }],
	['archive', { node: missing }],
	['assign', { node: missing, handle: 'Ada' }],
	['claim', { node: missing }],
	['release', { node: missing }],
	['decide', { decision: missing, option: 'one' }],
]

test.each(reachesCore)('%s reaches core, and core is what refuses it', async (operation, body) => {
	repo = board()
	server = await serve({ paths: paths(repo.dir) })

	const response = await post(operation, body)

	// Not 400: the body was the right shape. Not 500: nothing broke.
	expect(response.status, await response.text()).toBe(409)
})

test('stopping a node that was never running is a false, not a refusal', async () => {
	repo = board()
	server = await serve({ paths: paths(repo.dir) })

	const response = await post('stop', { node: missing })

	// `stopRun` answers whether it stopped something, and "there was nothing"
	// is a true answer rather than an error. The wire keeps it that way.
	expect(response.status).toBe(200)
	expect(await response.json()).toEqual({ stopped: false })
})

test('the canvas is served a projection and never a record', async () => {
	repo = board()
	server = await serve({ paths: paths(repo.dir) })

	const response = await get('projection')

	expect(response.status).toBe(200)
	expect(await response.json()).toEqual({ nodes: [] })
})

test('a read the board cannot answer says so rather than answering nothing', async () => {
	repo = board()
	server = await serve({ paths: paths(repo.dir) })

	const response = await get('review', '?node=not-on-this-board-aaaa')

	// `reviewNode` answers `null` for a node that is not there, and null is a
	// real answer: the surface renders "not on this board" rather than an
	// empty review that reads like a clean one.
	expect(response.status).toBe(200)
	expect(await response.json()).toBeNull()
})
