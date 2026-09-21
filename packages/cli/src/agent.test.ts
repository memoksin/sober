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
