/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
	forbidden: [
		{
			name: 'no-circular',
			severity: 'error',
			comment: 'A cycle is a module boundary that was never decided.',
			from: {},
			to: { circular: true },
		},
		{
			name: 'dashboard-is-browser-only',
			severity: 'error',
			comment: 'The dashboard runs in a browser; it reaches core through server (ADR 0008).',
			from: { path: '^apps/dashboard/' },
			to: { path: '^packages/(core|server)/' },
		},
		{
			name: 'only-core-touches-the-machine',
			severity: 'error',
			comment: 'Filesystem, subprocesses and git belong to core (ADR 0008).',
			// dependency-cruiser strips the `node:` prefix before matching, so the
			// original `^node:(fs|child_process)` could never match anything and the
			// rule did not fire once between phase 0 and phase 5. A probe module in
			// `test/integration/ratchets.test.ts` is what keeps it honest now.
			//
			// Two exemptions, both narrow on purpose. Test files reach for the
			// machine to build the world they test. And `packages/cli/src/input.ts`
			// reads a path the user typed as an argument — this rule is about
			// storage ownership, and that file is not the board.
			from: {
				pathNot: '^(packages/core|test)/|\\.test\\.ts$|^packages/cli/src/input\\.ts$',
			},
			to: {
				dependencyTypes: ['core'],
				path: '^(fs|fs/promises|child_process)$',
			},
		},
		{
			name: 'cli-does-not-import-apps',
			severity: 'error',
			comment: 'The dashboard ships as built assets, never as source (STRUCTURE.md).',
			from: { path: '^packages/cli/' },
			to: { path: '^apps/' },
		},
	],
	options: {
		doNotFollow: { path: 'node_modules' },
		// `dist/` is the bundle of source that is already cruised — ADR 0007
		// inlines every workspace dependency, so the CLI's bundle contains core
		// and reaches the machine by construction. `build.mjs` is the tool that
		// makes it. Neither is a module anyone writes rules about.
		exclude: { path: '(^|/)dist/|(^|/)build\\.mjs$' },
		tsConfig: { fileName: 'tsconfig.base.json' },
		tsPreCompilationDeps: true,
	},
}
