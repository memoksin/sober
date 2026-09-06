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
