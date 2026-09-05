import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { type Paths, SoberError } from '@besober/core'
import { z } from 'zod'
import { OPS, READS, type Route } from './routes.js'

/**
 * Loopback only, and never a name that resolves anywhere else. ADR 0008 sets
 * the rule; this is the whole of the surface it applies to.
 */
const HOST = '127.0.0.1'

/** The names a browser may legitimately have used to reach a loopback server. */
const LOOPBACK = new Set([HOST, 'localhost', '[::1]', '::1'])

/**
 * Large enough for any board record and small enough that a request cannot be
 * used to fill memory. A board is JSON written by this machine's own tools; if
 * one ever needs more than this, the record shape is the thing to look at.
 */
const MAX_BODY = 1_000_000

export interface Served {
	readonly url: string
	readonly port: number
	readonly token: string
	readonly close: () => Promise<void>
}

export interface ServeOptions {
	readonly paths: Paths
	/** Fixed port, for a caller that wants one. The default is whatever is free. */
	readonly port?: number
}

const json = (response: ServerResponse, status: number, body: unknown): void => {
	const text = JSON.stringify(body)
	response.writeHead(status, {
		'content-type': 'application/json',
		'content-length': Buffer.byteLength(text),
		// Nothing here is for a browser to reuse, and a stale board is worse
		// than a second request.
		'cache-control': 'no-store',
	})
	response.end(text)
}

const fail = (response: ServerResponse, status: number, error: string): void =>
	json(response, status, { error })

/**
 * Constant-time, and length-safe. `timingSafeEqual` throws on a length
 * mismatch, so the lengths are compared first — which leaks the token's length
 * and nothing else, and the length is in every response header anyway.
 */
const isToken = (given: string, expected: string): boolean => {
	const a = Buffer.from(given)
	const b = Buffer.from(expected)
	return a.length === b.length && timingSafeEqual(a, b)
}

const bearer = (request: IncomingMessage): string | null => {
	const header = request.headers.authorization
	if (header === undefined) return null
	const [scheme, value] = header.split(' ')
	return scheme?.toLowerCase() === 'bearer' && value !== undefined ? value : null
}

/**
 * The DNS-rebinding guard. A token stops a page that cannot read the response;
 * it does not stop a page that has tricked a browser into believing
 * `evil.example.com` is `127.0.0.1`, because the browser will then attach
 * nothing and the request still arrives. What that request cannot forge is the
 * `Host` header, so that is what is checked.
 */
const isLoopbackHost = (request: IncomingMessage): boolean => {
	const host = request.headers.host
	if (host === undefined) return false
	const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]
	return name !== undefined && LOOPBACK.has(name)
}

const read = async (request: IncomingMessage): Promise<unknown> => {
	let size = 0
	const chunks: Buffer[] = []
	for await (const chunk of request) {
		size += chunk.length
		if (size > MAX_BODY) throw new TooLargeError()
		chunks.push(chunk as Buffer)
	}
	if (chunks.length === 0) return {}
	return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

class TooLargeError extends Error {}

/**
 * What a failure becomes on the wire. `SoberError` is a refusal the product
 * meant — "it is not ready", "someone holds the lock" — so it is a 409 rather
 * than a 500: the request was understood and the state said no. A parse failure
 * is a 400. Anything else is ours, and says so with a 500 rather than dressing
 * a defect up as the user's mistake.
 */
const status = (error: unknown): number => {
	if (error instanceof TooLargeError) return 413
	if (error instanceof z.ZodError || error instanceof SyntaxError) return 400
	if (error instanceof SoberError) return 409
	return 500
}

const message = (error: unknown): string => {
	if (error instanceof TooLargeError) return `the request body is over ${MAX_BODY} bytes`
	if (error instanceof z.ZodError) return z.prettifyError(error)
	return error instanceof Error ? error.message : String(error)
}

/** `/op/<name>` or `/read/<name>` — the path is the operation (ADR 0036). */
const routed = (
	pathname: string,
): { readonly kind: 'op' | 'read'; readonly route: Route | undefined } | null => {
	const [, kind, name, ...rest] = pathname.split('/')
	if (rest.length > 0 || name === undefined || name === '') return null
	if (kind === 'op') return { kind: 'op', route: OPS[name as keyof typeof OPS] }
	if (kind === 'read') return { kind: 'read', route: READS[name] }
	return null
}

export const serve = async ({ paths, port = 0 }: ServeOptions): Promise<Served> => {
	const token = randomBytes(32).toString('hex')

	const server: Server = createServer((request, response) => {
		void handle(request, response).catch((error: unknown) =>
			fail(response, status(error), message(error)),
		)
	})

	const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
		if (!isLoopbackHost(request)) return fail(response, 403, 'this server answers on loopback only')

		const given = bearer(request)
		if (given === null || !isToken(given, token))
			return fail(response, 401, 'the dashboard token is missing or wrong')

		const url = new URL(request.url ?? '/', `http://${HOST}`)
		const match = routed(url.pathname)
		if (match === null || match.route === undefined)
			return fail(response, 404, `nothing is routed at ${url.pathname}`)

		const method = request.method ?? 'GET'
		const wanted = match.kind === 'op' ? 'POST' : 'GET'
		if (method !== wanted)
			return fail(response, 405, `${url.pathname} is a ${wanted}, and this was a ${method}`)

		const input = match.kind === 'op' ? await read(request) : Object.fromEntries(url.searchParams)
		json(response, 200, (await match.route.run(paths, input)) ?? null)
	}

	await new Promise<void>((resolve) => server.listen(port, HOST, resolve))
	const address = server.address() as AddressInfo

	return {
		url: `http://${HOST}:${address.port}/`,
		port: address.port,
		token,
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.closeAllConnections()
				server.close((error) => (error ? reject(error) : resolve()))
			}),
	}
}
