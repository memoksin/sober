import { expect, test } from 'vitest'

test('schema exports nothing new without a reviewer seeing it', async () => {
	const surface = await import('./index.js')

	expect(Object.keys(surface).sort()).toMatchSnapshot()
})
