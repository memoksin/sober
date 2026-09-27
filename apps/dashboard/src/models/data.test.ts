import type { ListedModel, ModelList } from '@besober/core'
import { expect, test } from 'vitest'
import { byHost, rangeOf } from './data.js'

const listed = (name: string, host: string | null, complexity: [number, number]): ListedModel => ({
	name,
	run: `${host} --model ${name}`,
	complexity,
	about: '',
	host,
	id: name,
	pinned: false,
})

const list: ModelList = {
	models: [
		listed('opus', 'claude', [6, 10]),
		listed('haiku', 'claude', [1, 3]),
		listed('local', 'opencode', [1, 2]),
	],
	dropped: [],
	sources: { claude: { complexity: [1, 10] } },
	catalogues: {
		claude: [
			{
				name: 'opus',
				run: 'claude --model opus',
				about: '',
				host: 'claude',
				id: 'opus',
				free: false,
			},
			{
				name: 'fable',
				run: 'claude --model fable',
				about: '',
				host: 'claude',
				id: 'fable',
				free: false,
			},
		],
		codex: null,
		openrouter: [],
	},
}

test('each host shows its models, the scores they cover, and what is left to add', () => {
	const [claude, codex, openrouter, other] = byHost(list)

	expect(claude).toMatchObject({ host: 'claude', covers: [1, 10], sourced: true, reachable: true })
	expect(claude?.addable.map((c) => c.id)).toEqual(['fable'])
	expect(codex).toMatchObject({ covers: null, reachable: false, sourced: false })
	expect(openrouter).toMatchObject({ covers: null, reachable: true })
	expect(other?.models.map((m) => m.name)).toEqual(['local'])
})

test('no pin on another adapter means no fourth group', () => {
	expect(byHost({ ...list, models: [] }).map((g) => g.host)).toEqual([
		'claude',
		'codex',
		'openrouter',
	])
})

test('a range is both blank, or a checked pair', () => {
	expect(rangeOf('', '')).toEqual({ range: undefined })
	expect(rangeOf('2', '5')).toEqual({ range: [2, 5] })
	expect(rangeOf('5', '2')).toHaveProperty('error')
	expect(rangeOf('0', '3')).toHaveProperty('error')
	expect(rangeOf('3', '')).toHaveProperty('error')
})
