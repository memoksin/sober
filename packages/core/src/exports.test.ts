import { expect, test } from 'vitest'

// The second line beside the snapshot (BUILD-PLAN §10): a snapshot can be
// updated without being read, so a count over the ceiling says so out loud.
// The number moves with the number of consumers, by ADR (ADR 0028, 0029). What
// shaves it is the weekly deletion pass, not the ceiling.
const CEILING = 107

// The dynamic import pulls in the whole module graph; under load that has hit
// vitest's 5000 ms default at 5026 ms, so this needs headroom.
test('core exports nothing new without a reviewer seeing it', async () => {
	const names = Object.keys(await import('./index.js')).sort()

	if (names.length > CEILING) {
		console.warn(`core exports ${names.length} names, over the ceiling of ${CEILING}.`)
	}

	expect(names).toMatchSnapshot()
}, 30_000)
