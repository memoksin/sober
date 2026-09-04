import { expect, test } from 'vitest'

// The second line beside the snapshot (BUILD-PLAN §10): a snapshot can be
// updated without being read, so a count over the ceiling says so out loud.
const CEILING = 60

test('core exports nothing new without a reviewer seeing it', async () => {
	const names = Object.keys(await import('./index.js')).sort()

	if (names.length > CEILING) {
		console.warn(`core exports ${names.length} names, over the ceiling of ${CEILING}.`)
	}

	expect(names).toMatchSnapshot()
})
