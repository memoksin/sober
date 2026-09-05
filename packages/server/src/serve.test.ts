import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { paths } from '@besober/core'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { serve, type Served } from './serve.js'

let root = ''
let server: Served

/** Every request the tests make, with the pieces each one wants to vary. */
const call = async (
	path: string,
	options: { token?: string | null; host?: string; method?: string; body?: unknown } = {},
): Promise<Response> => {
	const { token = server.token, host, method = 'GET', body } = options
	return fetch(new URL(path, server.url), {
		method,
		headers: {
			...(token === null ? {} : { authorization: `Bearer ${token}` }),
			...(host === undefined ? {} : { host }),
			...(body === undefined ? {} : { 'content-type': 'application/json' }),
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	})
}

beforeAll(async () => {
	// Not a repository and not a board: everything below is either refused
	// before a handler runs, or refused by core for the honest reason.
	root = await mkdtemp(join(tmpdir(), 'sober-serve-'))
	server = await serve({ paths: paths(root) })
})

afterAll(async () => {
	await server.close()
	await rm(root, { recursive: true, force: true })
})

test('it listens on loopback and nowhere else', () => {
	expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)
	expect(server.port).toBeGreaterThan(0)
})

test('the token is long enough that guessing it is not a plan', () => {
	expect(server.token.length).toBeGreaterThanOrEqual(32)
})

test('two servers never share a token', async () => {
	const second = await serve({ paths: paths(root) })
	try {
		expect(second.token).not.toBe(server.token)
	} finally {
		await second.close()
	}
})

test('a request with no token is refused', async () => {
	const response = await call('/read/board', { token: null })

	expect(response.status).toBe(401)
	expect(await response.json()).toEqual({ error: expect.any(String) })
})

test('a request with the wrong token is refused', async () => {
	const response = await call('/read/board', { token: 'not-the-token' })

	expect(response.status).toBe(401)
})

test('a token of the right length but the wrong bytes is still refused', async () => {
	const response = await call('/read/board', { token: 'a'.repeat(server.token.length) })

	expect(response.status).toBe(401)
})

test('a request that arrives under someone else’s hostname is refused', async () => {
	const response = await call('/read/board', { host: 'board.example.com' })

	expect(response.status).toBe(403)
})

test('localhost is a loopback name and is allowed through', async () => {
	const response = await call('/read/board', { host: `localhost:${server.port}` })

	expect(response.status).not.toBe(403)
})

test('an operation nobody routes is not found', async () => {
	const response = await call('/op/delete_everything', { method: 'POST', body: {} })

	expect(response.status).toBe(404)
})

test('a read nobody routes is not found', async () => {
	expect((await call('/read/digest')).status).toBe(404)
})

test('an operation is a POST — reading one does not perform it', async () => {
	const response = await call('/op/archive')

	expect(response.status).toBe(405)
})

test('a read is a GET, and posting to it is not a way in', async () => {
	const response = await call('/read/board', { method: 'POST', body: {} })

	expect(response.status).toBe(405)
})

test('a body the route cannot parse is refused before core sees it', async () => {
	const response = await call('/op/archive', { method: 'POST', body: { wrong: true } })

	expect(response.status).toBe(400)
	expect((await response.json()).error).toEqual(expect.any(String))
})

test('a body that is not JSON at all is refused the same way', async () => {
	const response = await fetch(new URL('/op/archive', server.url), {
		method: 'POST',
		headers: { authorization: `Bearer ${server.token}`, 'content-type': 'application/json' },
		body: '{ not json',
	})

	expect(response.status).toBe(400)
})

test('a valid request reaches the route, and core refuses it for its own reason', async () => {
	const response = await call('/read/board')

	// There is no board in a temp directory. What matters is that the refusal
	// came from core rather than from the door: not 401, not 403, not 404.
	expect(response.status).toBe(409)
	expect((await response.json()).error).toEqual(expect.any(String))
})

test('a body larger than the cap is refused rather than buffered', async () => {
	const response = await fetch(new URL('/op/archive', server.url), {
		method: 'POST',
		headers: { authorization: `Bearer ${server.token}`, 'content-type': 'application/json' },
		body: JSON.stringify({ node: 'x'.repeat(2_000_000) }),
	})

	expect(response.status).toBe(413)
})

test('a closed server stops answering', async () => {
	const third = await serve({ paths: paths(root) })
	const { url, token } = third
	await third.close()

	await expect(
		fetch(new URL('/read/board', url), { headers: { authorization: `Bearer ${token}` } }),
	).rejects.toThrow()
})
