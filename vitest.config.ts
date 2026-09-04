import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		projects: [
			// 'apps/*' returns in phase 5, with the dashboard.
			'packages/*',
			{
				// The integration project imports core's source, not its build:
				// coverage from the git tests has to count, or the ratchet points
				// away from the riskiest code in the repository (STRUCTURE.md).
				resolve: {
					alias: {
						'@besober/core': fileURLToPath(new URL('packages/core/src/index.ts', import.meta.url)),
						'@besober/mcp': fileURLToPath(new URL('packages/mcp/src/index.ts', import.meta.url)),
					},
				},
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
			exclude: ['packages/schema/**', 'packages/tsconfig/**', '**/*.fixture.ts'],
		},
	},
})
