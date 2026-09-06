import { mkdtemp, rm } from 'node:fs/promises'
import { request as rawRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { paths } from '@besober/core'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { type Served, serve } from './serve.js'

/**
 * `fetch` refuses to set `Host` — it is a forbidden header — so the one test
 * that is about `Host` cannot use it. This is the same request one line lower
 * down the stack.
 */
const withHost = (path: string, host: string): Promise<number> =>
	new Promise((resolve, reject) => {
		const sent = rawRequest(
			{
				host: '127.0.0.1',
				port: server.port,
				path,
				method: 'GET',
				headers: { host, authorization: `Bearer ${server.token}` },
			},
			(response) => {
				response.resume()
				resolve(response.statusCode ?? 0)
			},
		)
		sent.on('error', reject)
		sent.end()
	})

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

test('a request with no token is refused, and says that is what was missing', async () => {
	const response = await call('/read/board', { token: null })

	expect(response.status).toBe(401)
	expect((await response.json()).error).toMatch(/no .*token/i)
})

test('a request with the wrong token is refused, and says tokens do not survive a restart', async () => {
	const response = await call('/read/board', { token: 'not-the-token' })

	expect(response.status).toBe(401)
	// The two ways to hold a wrong token are copying the label with it and
	// restarting the server. The second is the one a message can fix.
	expect((await response.json()).error).toMatch(/starts|restart/i)
})

test('a refusal never repeats the token back', async () => {
	const wrong = 'not-the-token'
	const response = await call('/read/board', { token: wrong })

	const { error } = (await response.json()) as { error: string }
	expect(error).not.toContain(wrong)
	expect(error).not.toContain(server.token)
})

test('a token of the right length but the wrong bytes is still refused', async () => {
	const response = await call('/read/board', { token: 'a'.repeat(server.token.length) })

	expect(response.status).toBe(401)
})

test('a request that arrives under someone else’s hostname is refused', async () => {
	expect(await withHost('/read/board', 'board.example.com')).toBe(403)
})

test('localhost is a loopback name and is allowed through', async () => {
	expect(await withHost('/read/board', `localhost:${server.port}`)).not.toBe(403)
})

test('the address it prints opens in a browser, which sends no token', async () => {
	// A browser attaches no `Authorization` header, so the one URL a person is
	// handed has to answer without one. It is the only unauthenticated route,
	// and it is still behind the loopback host check.
	const response = await fetch(server.url)

	expect(response.status).toBe(200)
	expect(response.headers.get('content-type')).toMatch(/charset=utf-8/i)
	expect(await response.text()).toMatch(/SOBER/)
})

test('the page a browser gets carries no board', async () => {
	const text = await (await fetch(server.url)).text()

	for (const leak of ['nodes', 'decisions', 'project', server.token]) {
		expect(text, leak).not.toContain(leak)
	}
})

test('the open door is exactly one path — everything else still wants a token', async () => {
	for (const path of ['/read/board', '/read/projection', '/op/archive', '/index.html', '/read/']) {
		const response = await fetch(new URL(path, server.url))

		expect(response.status, path).not.toBe(200)
	}
})

test('every JSON answer says it is UTF-8, so an em dash is an em dash', async () => {
	const response = await call('/read/board', { token: null })

	expect(response.headers.get('content-type')).toMatch(/charset=utf-8/i)
	expect((await response.json()).error).toContain('—')
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

test('a valid request reaches core, which reads an empty directory as an empty board', async () => {
	const response = await call('/read/board')

	// §8.4: one missing file does not take down the board, so a directory with
	// no records reads as a board with no nodes rather than as a failure. What
	// this proves is that the request got past the door and into core.
	expect(response.status).toBe(200)
	expect(await response.json()).toMatchObject({ nodes: [], decisions: [] })
})

test('a refusal core meant is a 409, not a 500 — the state said no, nothing broke', async () => {
	const response = await call('/op/approve', {
		method: 'POST',
		body: { node: 'not-on-this-board-aaaa' },
	})

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
