import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { agent } from './agent.js'

let out: string[]
let key: string | undefined

beforeEach(() => {
	out = []
	key = process.env.OPENROUTER_API_KEY
	vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
		out.push(String(chunk))
		return true
	})
})

afterEach(() => {
	vi.restoreAllMocks()
	if (key === undefined) delete process.env.OPENROUTER_API_KEY
	else process.env.OPENROUTER_API_KEY = key
})

const answering = (status: number): typeof fetch =>
	vi.fn(async () => new Response(null, { status })) as unknown as typeof fetch

test('the probe without a key says so and exits 1', async () => {
	delete process.env.OPENROUTER_API_KEY
	expect(await agent({ check: true, fetch: answering(200) })).toBe(1)
	expect(out.join('')).toMatch(/^no key/)
})

test('the probe with an accepted key prints ok, and a refused one says 401', async () => {
	process.env.OPENROUTER_API_KEY = 'sk-test'
	const ok = answering(200)
	expect(await agent({ check: true, fetch: ok })).toBe(0)
	expect(out.join('')).toBe('ok\n')
	expect(ok).toHaveBeenCalledWith(
		'https://openrouter.ai/api/v1/auth/key',
		expect.objectContaining({ headers: { authorization: 'Bearer sk-test' } }),
	)

	out = []
	expect(await agent({ check: true, fetch: answering(401) })).toBe(1)
	expect(out.join('')).toBe('401: the key was refused\n')
})

test('an endpoint without /auth/key is probed at /models instead', async () => {
	process.env.OPENROUTER_API_KEY = 'sk-test'
	const fetchFn = vi.fn(async (url: string | URL | Request) =>
		String(url).endsWith('/auth/key')
			? new Response(null, { status: 404 })
			: new Response(null, { status: 200 }),
	) as unknown as typeof fetch
	expect(await agent({ check: true, baseUrl: 'http://localhost:1234/v1/', fetch: fetchFn })).toBe(0)
	expect(fetchFn).toHaveBeenLastCalledWith('http://localhost:1234/v1/models', expect.anything())
})

const chat = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 })

test('a run writes each line as a sober event and exits 0 on finished, 1 on failed', async () => {
	process.env.OPENROUTER_API_KEY = 'sk-test'
	const finished = vi.fn(async () =>
		chat({ choices: [{ message: { role: 'assistant', content: 'done' } }] }),
	) as unknown as typeof fetch
	expect(await agent({ check: false, model: 'm', prompt: 'p', fetch: finished })).toBe(0)
	const lines = out
		.join('')
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line) as { type: string; kind: string })
	expect(lines.map((line) => `${line.type} ${line.kind}`)).toEqual(['sober text', 'sober result'])

	const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
	const refused = vi.fn(
		async () => new Response('nope', { status: 400 }),
	) as unknown as typeof fetch
	expect(await agent({ check: false, model: 'm', prompt: 'p', fetch: refused })).toBe(1)
	expect(String(err.mock.calls[0]?.[0])).toContain('400')
})
