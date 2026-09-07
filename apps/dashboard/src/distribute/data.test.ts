import type { Distribution, ProjectedNode } from '@besober/schema'
import { expect, test } from 'vitest'
import { passedOver, readPlan, rows, waiting } from './data.js'

const plan = (overrides: Partial<Distribution> = {}): Distribution => ({
	by: 'alice',
	at: '2026-09-08T09:00:00.000Z',
	matches: [
		{ node: 'auth-api-k7f2', handle: 'alice', because: 'core, and she wrote the schema' },
		{ node: 'auth-ui-9x1p', handle: 'bob', because: 'the dashboard is his' },
	],
	skipped: [],
	...overrides,
})

const projected = (id: string, title: string): ProjectedNode => ({
	id,
	title,
	status: 'ready',
	dependsOn: [],
	flagged: false,
})

test('a row carries the title from the board, not from the plan', () => {
	const nodes = [projected('auth-api-k7f2', 'The auth API'), projected('auth-ui-9x1p', 'The panel')]

	expect(rows(plan(), nodes)).toEqual([
		{
			node: 'auth-api-k7f2',
			title: 'The auth API',
			handle: 'alice',
			because: 'core, and she wrote the schema',
		},
		{
			node: 'auth-ui-9x1p',
			title: 'The panel',
			handle: 'bob',
			because: 'the dashboard is his',
		},
	])
})

test('a node the canvas has not drawn yet still gets a row — its id is what it is', () => {
	expect(rows(plan(), [])[0]?.title).toBe('')
})

test('the bar counts the plan and names who wrote it', () => {
	expect(waiting(plan())).toBe('2 nodes proposed by alice')
	expect(waiting(plan({ matches: [plan().matches[0] as never] }))).toBe('1 node proposed by alice')
})

test('a plan that took nothing says so rather than showing an empty list', () => {
	expect(waiting(plan({ matches: [] }))).toBe('nothing proposed by alice')
})

test('what was passed over is one sentence, and nothing at all when nothing was', () => {
	expect(passedOver(plan())).toBeNull()
	expect(passedOver(plan({ skipped: ['db-setup-4t7w'] }))).toBe(
		'1 node passed over — somebody is already on it, or it is done',
	)
	expect(passedOver(plan({ skipped: ['db-setup-4t7w', 'billing-api-7h4d'] }))).toBe(
		'2 nodes passed over — somebody is already on them, or they are done',
	)
})

/**
 * §8.4 at the one place this feature could break it: the plan's read goes out
 * beside the projection's, and both are awaited together.
 */
test('a plan that cannot be read comes back as a sentence, never as a throw', async () => {
	const surface = {
		read: () => Promise.reject(new Error('distribution.json cannot be read: { not json')),
	} as never

	expect(await readPlan(surface)).toEqual({
		plan: null,
		failure: 'distribution.json cannot be read: { not json',
	})
})

test('a board with no plan on it reads as no plan, and no failure', async () => {
	const surface = { read: () => Promise.resolve(null) } as never

	expect(await readPlan(surface)).toEqual({ plan: null, failure: null })
})

test('a plan that reads comes back whole', async () => {
	const surface = { read: () => Promise.resolve(plan()) } as never

	expect((await readPlan(surface)).plan?.matches).toHaveLength(2)
})
