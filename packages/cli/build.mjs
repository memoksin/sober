import { chmodSync } from 'node:fs'
import { build } from 'esbuild'

// ADR 0007: every workspace dependency is inlined, so the published package
// declares no @besober/* dependency. secretlint resolves its rule packages by
// name at runtime and is the one thing that cannot be bundled (ADR 0011).
await build({
	entryPoints: ['src/index.ts'],
	outfile: 'dist/sober.js',
	bundle: true,
	platform: 'node',
	target: 'node22',
	format: 'esm',
	sourcemap: true,
	packages: 'bundle',
	external: ['secretlint'],
	banner: {
		js: [
			'#!/usr/bin/env node',
			// A bundled CJS dependency still calls require(); ESM has none.
			"import { createRequire as __sober_cr } from 'node:module'",
			'const require = __sober_cr(import.meta.url)',
		].join('\n'),
	},
})

chmodSync('dist/sober.js', 0o755)
