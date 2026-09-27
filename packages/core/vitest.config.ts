import { defineProject } from 'vitest/config'

export default defineProject({
	test: {
		name: '@besober/core',
		// Many of these tests drive real git in a temp repo. On Windows one git
		// spawn costs ~100 ms idle, and under `pnpm verify`'s parallel load the
		// 5 s default failed nine of them at 5.0–5.2 s with nothing wrong; one
		// that takes 1.7 s alone took 20.3 s. The integration project's ceiling.
		testTimeout: 60_000,
	},
})
