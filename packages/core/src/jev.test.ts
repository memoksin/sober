import { afterEach, expect, test, vi } from 'vitest'
import { askJev, JevError, jevDecision, jevQuestions } from './jev.js'

const env = { ...process.env }
afterEach(() => {
	vi.unstubAllGlobals()
	process.env = { ...env }
})

const answers = (score: number, skills: Record<string, number> = {}) => ({
	answers: {
		complexity: { type: 'score', score },
		...Object.fromEntries(
			Object.entries(skills).map(([name, probability]) => [
				`skill:${name}`,
				{ type: 'boolean', probability },
			]),
		),
	},
})

test('no skills is one question, and it is the ten-rung score', () => {
	const questions = jevQuestions([])
	expect(Object.keys(questions)).toEqual(['complexity'])
	expect(questions.complexity).toMatchObject({ type: 'score' })
	expect(questions.complexity).toHaveProperty('criteria.9')
})

test('each skill is its own boolean question, named by its prefix', () => {
	const questions = jevQuestions(['ponytail', 'engineering:testing-strategy'])
	expect(Object.keys(questions)).toEqual([
		'complexity',
		'skill:ponytail',
		'skill:engineering:testing-strategy',
	])
	expect(questions['skill:ponytail']).toMatchObject({ type: 'boolean' })
})

test('the rung maps onto the brief 1-10 scale', () => {
	expect(jevDecision(answers(0), []).complexity).toBe(1)
	expect(jevDecision(answers(9), []).complexity).toBe(10)
})

test('a rung off the scale is a failure, not a clamp', () => {
	expect(() => jevDecision(answers(10), [])).toThrow(JevError)
	expect(() => jevDecision({ answers: {} }, [])).toThrow(JevError)
	expect(() => jevDecision('nope', [])).toThrow(JevError)
})

test('an undecided skill is not chosen', () => {
	const decision = jevDecision(answers(4, { a: 0.9, b: 0.5, c: 0.1 }), ['a', 'b', 'c'])
	expect(decision.skills).toEqual(['a'])
})

test('a missing skill answer is a failure', () => {
	expect(() => jevDecision(answers(4), ['a'])).toThrow(JevError)
})

test('the request names the router, the model and the key', async () => {
	process.env.JEV_API_KEY = 'sk-test'
	process.env.JEV_BASE_URL = 'https://openrouter.ai/api/v1/'
	process.env.JEV_MODEL = 'typesafe/jev-latest'
	const fetch = vi.fn(async () => new Response(JSON.stringify(answers(7, { ponytail: 0.8 }))))
	vi.stubGlobal('fetch', fetch)

	const decision = await askJev('the brief', ['ponytail'])

	expect(decision).toEqual({ complexity: 8, skills: ['ponytail'] })
	const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
	expect(url).toBe('https://openrouter.ai/api/v1/systemone')
	expect(init.headers).toMatchObject({ authorization: 'Bearer sk-test' })
	expect(JSON.parse(init.body as string).model).toBe('typesafe/jev-latest')
})

test('no key is a sentence, not a call', async () => {
	process.env.JEV_API_KEY = ''
	const fetch = vi.fn()
	vi.stubGlobal('fetch', fetch)
	await expect(askJev('the brief', [])).rejects.toThrow(/JEV_API_KEY/)
	expect(fetch).not.toHaveBeenCalled()
})

test('a router that refuses is reported with its status', async () => {
	process.env.JEV_API_KEY = 'sk-test'
	delete process.env.JEV_BASE_URL
	vi.stubGlobal('fetch', async () => new Response('no credit', { status: 402 }))
	await expect(askJev('the brief', [])).rejects.toThrow(/402/)
})

test('a router that cannot be reached names the router', async () => {
	process.env.JEV_API_KEY = 'sk-test'
	delete process.env.JEV_BASE_URL
	vi.stubGlobal('fetch', async () => {
		throw new Error('ECONNREFUSED')
	})
	await expect(askJev('the brief', [])).rejects.toThrow(
		/https:\/\/api\.typesafe\.ai\/v1 could not be reached: ECONNREFUSED/,
	)
})

test('an answer that is not an object is a failure, not a read through it', () => {
	expect(() => jevDecision({ answers: { complexity: 'seven' } }, [])).toThrow(JevError)
})

test('a body with no answers, and a skill answer with no probability, both fail', () => {
	expect(() => jevDecision({ usage: {} }, [])).toThrow(/no `answers`/)
	expect(() =>
		jevDecision({ answers: { complexity: { score: 1 }, 'skill:a': { type: 'boolean' } } }, ['a']),
	).toThrow(/probability/)
})
