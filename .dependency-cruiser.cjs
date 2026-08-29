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
			from: { pathNot: '^(packages/core|test)/' },
			to: { dependencyTypes: ['core'], path: '^node:(fs|child_process)' },
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
		tsConfig: { fileName: 'tsconfig.base.json' },
		tsPreCompilationDeps: true,
	},
}
