import { afterEach, expect, test, vi } from 'vitest'
import {
	askJev,
	backupCandidates,
	backupQuestion,
	JevError,
	jevChoice,
	jevDecision,
	jevQuestions,
	modelQuestion,
} from './jev.js'

const env = { ...process.env }
afterEach(() => {
	vi.unstubAllGlobals()
	process.env = { ...env }
})

const NOTHING = { skills: [], models: [] }

const model = (name: string, low: number, high: number, about = '') => ({
	name,
	run: `opencode --model ${name}`,
	complexity: [low, high] as [number, number],
	about,
})

const answers = (score: number, skills: Record<string, number> = {}) => ({
	answers: {
		complexity: { type: 'score', score },
		...Object.fromEntries(
			Object.entries(skills).map(([name, probability]) => [
				`skill:${name}`,
				{ type: 'noul', noul: probability },
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
	expect(questions['skill:ponytail']).toMatchObject({ type: 'noul' })
})

test('the rung maps onto the brief 1-10 scale, an expected value rounded', () => {
	expect(jevDecision(answers(0), []).complexity).toBe(1)
	expect(jevDecision(answers(9), []).complexity).toBe(10)
	expect(jevDecision(answers(6.5), []).complexity).toBe(8)
	expect(jevDecision(answers(4.28), []).complexity).toBe(5)
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

	const decision = await askJev('the brief', { skills: ['ponytail'], models: [] })

	expect(decision).toEqual({ complexity: 8, skills: ['ponytail'], model: null, backup: null })
	const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
	expect(url).toBe('https://openrouter.ai/api/v1/systemone')
	expect(init.headers).toMatchObject({ authorization: 'Bearer sk-test' })
	expect(JSON.parse(init.body as string).model).toBe('typesafe/jev-latest')
})

test('no key is a sentence, not a call', async () => {
	process.env.JEV_API_KEY = ''
	const fetch = vi.fn()
	vi.stubGlobal('fetch', fetch)
	await expect(askJev('the brief', NOTHING)).rejects.toThrow(/JEV_API_KEY/)
	expect(fetch).not.toHaveBeenCalled()
})

test('a router that refuses is reported with its status', async () => {
	process.env.JEV_API_KEY = 'sk-test'
	delete process.env.JEV_BASE_URL
	vi.stubGlobal('fetch', async () => new Response('no credit', { status: 402 }))
	await expect(askJev('the brief', NOTHING)).rejects.toThrow(/402/)
})

test('a router that cannot be reached names the router', async () => {
	process.env.JEV_API_KEY = 'sk-test'
	delete process.env.JEV_BASE_URL
	vi.stubGlobal('fetch', async () => {
		throw new Error('ECONNREFUSED')
	})
	await expect(askJev('the brief', NOTHING)).rejects.toThrow(
		/https:\/\/api\.typesafe\.ai\/v1 could not be reached: ECONNREFUSED/,
	)
})

test('an answer that is not an object is a failure, not a read through it', () => {
	expect(() => jevDecision({ answers: { complexity: 'seven' } }, [])).toThrow(JevError)
})

test('a body with no answers, and a skill answer with no probability, both fail', () => {
	expect(() => jevDecision({ usage: {} }, [])).toThrow(/no `answers`/)
	expect(() =>
		jevDecision({ answers: { complexity: { score: 1 }, 'skill:a': { type: 'noul' } } }, ['a']),
	).toThrow(/probability/)
})

test('the choice question shows only the covering entries, by their about or their line', () => {
	const question = modelQuestion([model('free', 1, 3, 'Free.'), model('codex', 3, 7)])
	expect(question.model).toMatchObject({
		type: 'choice',
		criteria: { free: 'Free.', codex: 'opencode --model codex' },
	})
})

test('a choice off the list is a failure, not a guess', () => {
	expect(jevChoice({ answers: { model: { type: 'choice', choice: 'free' } } }, ['free'])).toBe(
		'free',
	)
	expect(() => jevChoice({ answers: { model: { choice: 'gpt' } } }, ['free'])).toThrow(JevError)
	expect(() => jevChoice({ answers: {} }, ['free'])).toThrow(JevError)
	expect(() => jevChoice(null, ['free'])).toThrow(JevError)
})

test('no covering entry is one call and no model; one entry is one call and that model', async () => {
	process.env.JEV_API_KEY = 'sk-test'
	const fetch = vi.fn(async () => new Response(JSON.stringify(answers(1))))
	vi.stubGlobal('fetch', fetch)

	const none = await askJev('the brief', { skills: [], models: [model('big', 8, 10)] })
	expect(none.model).toBeNull()
	expect(fetch).toHaveBeenCalledTimes(1)

	const one = await askJev('the brief', { skills: [], models: [model('free', 1, 3)] })
	expect(one.model).toBe('free')
	expect(fetch).toHaveBeenCalledTimes(2)
})

test('two covering entries is a second call, and Jev picks among those alone', async () => {
	process.env.JEV_API_KEY = 'sk-test'
	const fetch = vi
		.fn()
		.mockResolvedValueOnce(new Response(JSON.stringify(answers(4))))
		.mockResolvedValueOnce(
			new Response(JSON.stringify({ answers: { model: { type: 'choice', choice: 'codex' } } })),
		)
	vi.stubGlobal('fetch', fetch)

	const decision = await askJev('the brief', {
		skills: [],
		models: [model('free', 1, 5, 'Free.'), model('codex', 3, 7, 'Plumbing.'), model('big', 8, 10)],
	})

	// One host only, so the backup is the one other covering entry: no third call.
	expect(decision).toEqual({ complexity: 5, skills: [], model: 'codex', backup: 'free' })
	expect(fetch).toHaveBeenCalledTimes(2)
	const second = JSON.parse(
		(fetch.mock.calls[1] as unknown as [string, RequestInit])[1].body as string,
	)
	expect(Object.keys(second.questions.model.criteria)).toEqual(['free', 'codex'])
})

const on = (run: string, name: string, low = 1, high = 10) => ({
	name,
	run,
	complexity: [low, high] as [number, number],
	about: '',
})

const OPUS = on('claude --model opus', 'opus')
const SONNET = on('claude --model sonnet', 'sonnet')
const GPT = on('codex --model gpt', 'gpt')
const FREE = on('openrouter --model a:free', 'free')
const FREE_TOO = on('openrouter --model b:free', 'free-too')

test('the backup candidates are on another host and never the primary', () => {
	const names = backupCandidates([OPUS, SONNET, GPT, FREE], OPUS.run, 5).map((m) => m.name)
	expect(names).toEqual(['gpt', 'free'])
})

test('with no other host, the backup is another entry on the same one — never the primary', () => {
	expect(backupCandidates([OPUS, SONNET], OPUS.run, 5).map((m) => m.name)).toEqual(['sonnet'])
	expect(backupCandidates([OPUS], OPUS.run, 5)).toEqual([])
})

test('an openrouter primary gets only claude or codex, never another free model', () => {
	const models = [FREE, FREE_TOO, on('opencode --model x', 'oc'), GPT, OPUS]
	expect(backupCandidates(models, FREE.run, 5).map((m) => m.name)).toEqual(['gpt', 'opus'])
	expect(backupCandidates([FREE, FREE_TOO], FREE.run, 5)).toEqual([])
})

test('covering entries go first; with none covering, the other hosts are used as they are', () => {
	const small = on('codex --model small', 'small', 1, 3)
	const big = on('openrouter --model big:free', 'big', 8, 10)
	expect(backupCandidates([OPUS, small, big], OPUS.run, 9).map((m) => m.name)).toEqual(['big'])
	expect(backupCandidates([OPUS, small, big], OPUS.run, 5).map((m) => m.name)).toEqual([
		'small',
		'big',
	])
})

test('the backup question says it is the fallback on another host, and an answer off it fails', () => {
	const question = backupQuestion([GPT, FREE])
	expect(question.backup).toMatchObject({
		type: 'choice',
		instructions: expect.stringMatching(/cannot start.*different host/),
		criteria: { gpt: GPT.run, free: FREE.run },
	})
	const names = backupCandidates([FREE, FREE_TOO, GPT, OPUS], FREE.run, 5).map((m) => m.name)
	const answer = (choice: string) => ({ answers: { backup: { type: 'choice', choice } } })
	expect(jevChoice(answer('gpt'), names, 'backup')).toBe('gpt')
	expect(() => jevChoice(answer('free'), names, 'backup')).toThrow(JevError)
	expect(() => jevChoice(answer('free-too'), names, 'backup')).toThrow(JevError)
})

test('two backup candidates is a third call, shown only those, and Jev picks among them', async () => {
	process.env.JEV_API_KEY = 'sk-test'
	const fetch = vi
		.fn()
		.mockResolvedValueOnce(new Response(JSON.stringify(answers(4))))
		.mockResolvedValueOnce(
			new Response(JSON.stringify({ answers: { model: { type: 'choice', choice: 'free' } } })),
		)
		.mockResolvedValueOnce(
			new Response(JSON.stringify({ answers: { backup: { type: 'choice', choice: 'opus' } } })),
		)
	vi.stubGlobal('fetch', fetch)

	const decision = await askJev('the brief', { skills: [], models: [FREE, FREE_TOO, GPT, OPUS] })

	expect(decision).toMatchObject({ model: 'free', backup: 'opus' })
	const third = JSON.parse(
		(fetch.mock.calls[2] as unknown as [string, RequestInit])[1].body as string,
	)
	expect(Object.keys(third.questions.backup.criteria)).toEqual(['gpt', 'opus'])
})

test('a backup Jev picks off the list is a failure', async () => {
	process.env.JEV_API_KEY = 'sk-test'
	vi.stubGlobal(
		'fetch',
		vi
			.fn()
			.mockResolvedValueOnce(new Response(JSON.stringify(answers(4))))
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ answers: { model: { type: 'choice', choice: 'free' } } })),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({ answers: { backup: { type: 'choice', choice: 'free-too' } } }),
				),
			),
	)
	await expect(
		askJev('the brief', { skills: [], models: [FREE, FREE_TOO, GPT, OPUS] }),
	).rejects.toThrow(JevError)
})

test('zero or one backup candidate costs no extra call', async () => {
	process.env.JEV_API_KEY = 'sk-test'
	const fetch = vi.fn(async () => new Response(JSON.stringify(answers(4))))
	vi.stubGlobal('fetch', fetch)

	expect(await askJev('the brief', { skills: [], models: [OPUS] })).toMatchObject({
		model: 'opus',
		backup: null,
	})
	expect(fetch).toHaveBeenCalledTimes(1)

	// `gpt` does not cover the score, and is still the backup: the one other host.
	const models = [FREE_TOO, on('codex --model gpt', 'gpt', 8, 10)]
	expect(await askJev('the brief', { skills: [], models })).toMatchObject({
		model: 'free-too',
		backup: 'gpt',
	})
	expect(fetch).toHaveBeenCalledTimes(2)
})
