import { expect, test } from 'vitest'

// The dynamic import pulls in the whole module graph; under load that has hit
// vitest's 5000 ms default at 5026 ms, so this needs headroom.
test('schema exports nothing new without a reviewer seeing it', async () => {
	const surface = await import('./index.js')

	expect(Object.keys(surface).sort()).toMatchSnapshot()
}, 30_000)
