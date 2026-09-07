import { expect, test } from 'vitest'
import { claimToken, wire } from './wire.js'

const store = (start: Record<string, string> = {}) => {
	const kept = new Map(Object.entries(start))
	return {
		getItem: (key: string) => kept.get(key) ?? null,
		setItem: (key: string, value: string) => void kept.set(key, value),
	}
}

const responds = (status: number, body: unknown, type = 'application/json') =>
	(async () =>
		new Response(typeof body === 'string' ? body : JSON.stringify(body), {
			status,
			headers: { 'content-type': type },
		})) as unknown as typeof fetch

test('the token comes out of the fragment, which a browser never sends to a server', () => {
	expect(claimToken('#4f3a', store())).toBe('4f3a')
})

test('a reload finds the token the first load put away', () => {
	// The fragment is stripped from the address bar once it has been read, so
	// the second load arrives with an empty hash and nothing else to go on.
	const kept = store()
	claimToken('#4f3a', kept)

	expect(claimToken('', kept)).toBe('4f3a')
})

test('a fresh fragment replaces a stale one', () => {
	// `sober dashboard` mints a token every start. An old tab pointed at a new
	// server must not go on presenting the token it was born with.
	const kept = store()
	claimToken('#old', kept)

	expect(claimToken('#new', kept)).toBe('new')
	expect(claimToken('', kept)).toBe('new')
})

test('no token anywhere is nothing, not an empty string sent as a credential', () => {
	expect(claimToken('', store())).toBeNull()
	expect(claimToken('#', store())).toBeNull()
})

test('a read carries the token as a bearer header', async () => {
	let sent: [string, RequestInit] | undefined
	const spy = (async (url: string, init: RequestInit) => {
		sent = [url, init]
		return new Response('{"nodes":[]}', { headers: { 'content-type': 'application/json' } })
	}) as unknown as typeof fetch

	await wire('4f3a', spy).read('projection')

	expect(sent?.[1]?.headers).toEqual({ authorization: 'Bearer 4f3a' })
	// Relative: the page's own origin is the server, and there is no second one.
	expect(sent?.[0]).toBe('/read/projection')
})

test('a read that takes an argument puts it in the query string', async () => {
	let sent: string | undefined
	const spy = (async (url: string) => {
		sent = url
		return new Response('{}', { headers: { 'content-type': 'application/json' } })
	}) as unknown as typeof fetch

	await wire('4f3a', spy).read('review', { node: 'auth-api-k7f2' })

	expect(sent).toBe('/read/review?node=auth-api-k7f2')
})

test('a read returns the parsed body', async () => {
	const projection = await wire('4f3a', responds(200, { nodes: [] })).read('projection')

	expect(projection).toEqual({ nodes: [] })
})

test('a refusal surfaces the server’s own words, not the status code', async () => {
	// The server writes these to be read by a person — "that is not this
	// server's token" tells you what to do; "401" does not.
	await expect(
		wire('stale', responds(401, { error: 'that is not this server’s token' })).read('projection'),
	).rejects.toThrow('that is not this server’s token')
})

test('a refusal that is not JSON still says something a person can act on', async () => {
	await expect(
		wire('4f3a', responds(502, '<html>proxy</html>', 'text/html')).read('projection'),
	).rejects.toThrow(/502/)
})

test('a server that is gone says so, rather than repeating fetch’s words', async () => {
	// `sober dashboard` runs in the foreground, so Ctrl-C is the ordinary way it
	// ends and the open tab is what finds out. "Failed to fetch" names the
	// browser's problem; the person's problem is that the command stopped.
	const dead = (async () => {
		throw new TypeError('Failed to fetch')
	}) as unknown as typeof fetch

	await expect(wire('4f3a', dead).read('projection')).rejects.toThrow(/stopped|not running/i)
})

test('an operation posts JSON to its own route, with the token', async () => {
	const seen: [string, RequestInit | undefined][] = []
	const fetcher = (async (url: string, init?: RequestInit) => {
		seen.push([url, init])
		return new Response(JSON.stringify({ answered: true }), { status: 200 })
	}) as unknown as typeof fetch

	const answered = await wire('t0ken', fetcher).op('decide', { decision: 'd1', option: 'redis' })

	expect(answered).toEqual({ answered: true })
	expect(seen[0]?.[0]).toBe('/op/decide')
	expect(seen[0]?.[1]?.method).toBe('POST')
	expect(seen[0]?.[1]?.body).toBe('{"decision":"d1","option":"redis"}')
	expect(new Headers(seen[0]?.[1]?.headers).get('authorization')).toBe('Bearer t0ken')
})

test('a refused operation throws what the server wrote, not its status code', async () => {
	// `decide` on an answered decision comes back 409 with a paragraph a person
	// can act on. A screen that renders "409" has thrown that away.
	const fetcher = (async () =>
		new Response(JSON.stringify({ error: 'already answered — every brief would be withdrawn' }), {
			status: 409,
		})) as unknown as typeof fetch

	await expect(wire('t', fetcher).op('decide', {})).rejects.toThrow(
		'every brief would be withdrawn',
	)
})

test('an operation against a server that has gone says the command stopped', async () => {
	const fetcher = (async () => {
		throw new TypeError('Failed to fetch')
	}) as unknown as typeof fetch

	await expect(wire('t', fetcher).op('decide', {})).rejects.toThrow(
		'`sober dashboard` is no longer',
	)
})

let sent: RequestInit | undefined
let url = ''

/** A streaming body, the way the watch route sends one: NDJSON, in chunks. */
const streams = (chunks: readonly string[], status = 200) =>
	(async (at: string, init?: RequestInit) => {
		sent = init
		url = at
		return new Response(
			new ReadableStream({
				start(controller) {
					for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
					controller.close()
				},
			}),
			{ status, headers: { 'content-type': 'application/x-ndjson' } },
		)
	}) as unknown as typeof fetch

test('a watch carries the token in the header, so ADR 0008 keeps its rule', async () => {
	await wire('4f3a', streams(['{"lines":[],"offset":0,"live":false}\n'])).watch(
		'logs',
		{ node: 'auth-api-k7f2' },
		() => {},
	)

	// The whole reason the channel is a streaming `fetch` and not an
	// `EventSource`: the token stays out of the URL (ADR 0046).
	expect((sent?.headers as Record<string, string> | undefined)?.authorization).toBe('Bearer 4f3a')
	expect(url).not.toContain('4f3a')
})

test('a watch hands over each window as it lands, not all of them at the end', async () => {
	const seen: number[] = []

	await wire(
		'4f3a',
		streams([
			'{"lines":[{"kind":"text","text":"one"}],"offset":10,"live":true}\n',
			'{"lines":[{"kind":"text","text":"two"}],"offset":20,"live":false}\n',
		]),
	).watch<{ lines: { kind: string; text: string }[]; offset: number; live: boolean }>(
		'logs',
		{ node: 'n' },
		(window) => seen.push(window.offset),
	)

	expect(seen).toEqual([10, 20])
})

test('a window split across two chunks is one window, never two broken ones', async () => {
	const seen: string[] = []

	await wire(
		'4f3a',
		streams(['{"lines":[{"kind":"text","text":"hal', 'f"}],"offset":9,"live":false}\n']),
	).watch<{ lines: { kind: string; text: string }[]; offset: number; live: boolean }>(
		'logs',
		{ node: 'n' },
		(window) => seen.push(...window.lines.map((line) => line.text)),
	)

	// The server writes one window per line, and TCP does not promise to deliver
	// one per chunk. A reader that assumes it does drops the first long line
	// anybody writes.
	expect(seen).toEqual(['half'])
})

test('a refused watch fails with what the server said, like every other route', async () => {
	await expect(
		wire('4f3a', streams(['{"error":"n has not run yet"}'], 409)).watch(
			'logs',
			{ node: 'n' },
			() => {},
		),
	).rejects.toThrow(/has not run yet/)
})
