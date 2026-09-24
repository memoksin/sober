import { DEFAULT_CONFIG, type Paths } from '@besober/core'
import { afterEach, expect, test, vi } from 'vitest'
import { openBoard, settingsOf } from './board.js'
import { modelsFromSources } from './models.js'

vi.mock('./board.js', () => ({
	openBoard: vi.fn(),
	settingsOf: vi.fn(),
}))

afterEach(() => {
	vi.restoreAllMocks()
})

test('sober models --sources prints what dispatch.models names when no source is configured', async () => {
	vi.mocked(openBoard).mockResolvedValue({ catalogue: '/nowhere' } as Paths)
	vi.mocked(settingsOf).mockResolvedValue({
		...DEFAULT_CONFIG,
		dispatch: {
			...DEFAULT_CONFIG.dispatch,
			models: [{ name: 'opus', run: 'claude --model opus', complexity: [8, 10], about: 'pinned' }],
			sources: {},
		},
	})
	const out: string[] = []
	vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
		out.push(String(chunk))
		return true
	})

	await modelsFromSources()

	const printed = out.join('')
	expect(printed).toContain('opus')
	expect(printed).toContain('claude --model opus')
})
