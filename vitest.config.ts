import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		projects: [
			'packages/*',
			'apps/*',
			{
				test: {
					name: 'integration',
					root: 'test/integration',
					include: ['**/*.test.ts'],
					// Real git, real worktrees, real subprocesses: no parallel workers.
					fileParallelism: false,
					testTimeout: 60_000,
				},
			},
		],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json-summary'],
			include: ['packages/*/src/**', 'apps/*/src/**'],
			exclude: ['packages/schema/**', 'packages/tsconfig/**'],
		},
	},
})
