import { expect, test } from 'vitest'

test('server exports nothing new without a reviewer seeing it', async () => {
	const surface = await import('./index.js')

	expect(Object.keys(surface).sort()).toMatchSnapshot()
})
