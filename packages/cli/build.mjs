import { chmodSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { extname, join, posix, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const DASHBOARD = fileURLToPath(new URL('../../apps/dashboard/dist', import.meta.url))

/** Text only, because every asset here is text. A font or an image needs more. */
const TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.json': 'application/json; charset=utf-8',
}

/**
 * The built dashboard, as a value the server can serve without a filesystem.
 * STRUCTURE.md has always said it ships as built assets; this is where it
 * stops being a directory and becomes part of the binary.
 *
 * Missing is not an error. `pnpm build --filter @besober/cli` on its own is a
 * legitimate thing to do, and the server explains an empty `/` in plain words.
 */
const client = (dir = DASHBOARD) => {
	if (!existsSync(dir)) return {}

	const walk = (at) =>
		readdirSync(at, { withFileTypes: true }).flatMap((entry) => {
			const full = join(at, entry.name)
			if (entry.isDirectory()) return walk(full)
			const type = TYPES[extname(entry.name)]
			if (type === undefined) return []
			return [
				[
					`/${posix.join(...relative(dir, full).split(/[\\/]/))}`,
					{ type, body: readFileSync(full, 'utf8') },
				],
			]
		})

	return Object.fromEntries(walk(dir))
}

const assets = client()
const size = Object.values(assets).reduce((all, { body }) => all + body.length, 0)
console.log(`dashboard: ${Object.keys(assets).length} assets, ${(size / 1024).toFixed(0)} kB`)

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
	// jsonc-parser's `main` is a UMD file whose inner require() calls go through
	// the factory argument, so a bundler cannot follow them and the published
	// binary dies on its first config read. Its ESM build has plain imports —
	// preferring `module` is what makes the bundle whole (ADR 0007's warning
	// about a plausible wrong bundle, met in practice).
	mainFields: ['module', 'main'],
	external: ['secretlint'],
	define: { __SOBER_CLIENT__: JSON.stringify(assets) },
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
