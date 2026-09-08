import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

/**
 * The repository's own ratchets, measured rather than remembered
 * (`BUILD-PLAN.md` §7). They live in the integration project because they are
 * about the repository rather than about a package, and this is the only
 * project whose root is the repository.
 */
const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

const manifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
	scripts: Record<string, string>
}

/** Lines of TypeScript under a directory, counted the way §8's table counts. */
const lines = (dir: string): number => {
	if (!existsSync(join(repoRoot, dir))) return 0
	const files = execFileSync('git', ['ls-files', `${dir}/**/*.ts`, `${dir}/**/*.tsx`], {
		cwd: repoRoot,
		encoding: 'utf8',
	})
		.split('\n')
		.filter((file) => file !== '' && !file.endsWith('.test.ts') && !file.endsWith('.test.tsx'))

	return files.reduce(
		(total, file) => total + readFileSync(join(repoRoot, file), 'utf8').split('\n').length,
		0,
	)
}

/**
 * ADR 0008's four boundary rules are only rules where `depcruise` is pointed.
 * It was pointed at `packages` and `test`, so `dashboard-is-browser-only` — the
 * rule that exists to stop a browser bundle importing `core` — has never once
 * run. Nothing was wrong with the rule; it was aimed away from its subject.
 *
 * This is Law 1 applied to the gap: the day `apps/` exists, this goes red until
 * the script is pointed at it, rather than the rule staying decorative until
 * somebody notices. Fixing it now is not possible — an empty `apps/dashboard`
 * would be a source directory with no tests, and the coverage ratchet would go
 * red for a stub.
 */
test('every source directory that exists is a directory the boundaries check reads', () => {
	const script = manifest.scripts.boundaries ?? ''

	for (const dir of ['apps', 'packages', 'test']) {
		if (!existsSync(join(repoRoot, dir))) continue
		expect(script, `${dir}/ exists and \`pnpm boundaries\` does not read it`).toContain(dir)
	}
})

/** Every workspace directory that holds source, whether or not it is a package. */
const sourceDirectories = (): string[] =>
	['apps', 'packages']
		.filter((parent) => existsSync(join(repoRoot, parent)))
		.flatMap((parent) =>
			readdirSync(join(repoRoot, parent))
				.map((name) => `${parent}/${name}`)
				.filter((dir) => lines(dir) > 0),
		)

/**
 * The boundaries test above, one directory over, and the same gap. The coverage
 * ratchet groups a file by `/packages/<name>/`, so nothing under `apps/` has
 * ever matched — and `pnpm coverage:update` cannot put it back, because a
 * script that does not match a directory cannot report it missing either. The
 * whole of the canvas was written with no floor under it and every run said
 * green.
 *
 * Asserted against the baseline rather than against the script's regex: what
 * matters is that a floor exists, not how the script arrives at it.
 */
test('every source directory that exists has a coverage floor', () => {
	const baseline = JSON.parse(
		readFileSync(join(repoRoot, 'coverage-baseline.json'), 'utf8'),
	) as Record<string, number>
	// The script's own exclusions: a types-and-Zod package produces tests
	// written to reach a number (STRUCTURE.md).
	const excluded = new Set(['schema', 'tsconfig'])

	for (const dir of sourceDirectories()) {
		const name = dir.split('/')[1] ?? ''
		if (excluded.has(name)) continue
		expect(baseline, `${dir} holds source and has no coverage floor`).toHaveProperty(name)
	}
})

/**
 * §9's tenth step, as a test rather than as a pull request somebody once
 * watched: a check nobody has seen fail is not known to work.
 *
 * It is written because the rule did not work. `only-core-touches-the-machine`
 * matched `^node:(fs|child_process)`, and dependency-cruiser strips the `node:`
 * prefix before matching — both `module` and `resolved` come back as `fs`. The
 * rule that exists to keep the filesystem inside `core` has never once fired,
 * from phase 0 until now, and nothing in the repository would have said so.
 *
 * The violation is written into `packages/server/src` because that is where the
 * rule applies; `test/` is exempt by design, so a fixture kept there could
 * never break anything.
 */
test('a package outside core that reaches for the filesystem fails the boundaries check', () => {
	const violation = join(repoRoot, 'packages/server/src/boundary-violation.probe.ts')
	writeFileSync(
		violation,
		"import { readFileSync } from 'node:fs'\nexport const probe = (): Buffer => readFileSync('/etc/hosts')\n",
	)

	try {
		let output = ''
		let failed = false
		try {
			// The arguments come from the script rather than being written twice.
			// The two drifted once already — the script grew `apps` and a copy of
			// it here would have gone on checking the old set.
			const [, ...args] = (manifest.scripts.boundaries ?? '').split(' ')
			// `shell` on Windows, where `node_modules/.bin/depcruise` is a shim
			// with no extension that `execFileSync` cannot start: without it the
			// spawn fails instantly, `failed` reads true for the wrong reason, and
			// the check that would have caught a real violation never runs.
			execFileSync(join(repoRoot, 'node_modules/.bin/depcruise'), args, {
				cwd: repoRoot,
				encoding: 'utf8',
				shell: process.platform === 'win32',
			})
		} catch (error) {
			failed = true
			output = String((error as { stdout?: string }).stdout ?? '')
		}

		expect(failed, 'depcruise passed a module that reads the filesystem outside core').toBe(true)
		expect(output).toContain('only-core-touches-the-machine')
		// Named, so this cannot pass on somebody else's violation.
		expect(output).toContain('boundary-violation.probe.ts')
	} finally {
		rmSync(violation, { force: true })
	}
}, 120_000)

/**
 * The CLI inlines the built dashboard at build time (`packages/cli/build.mjs`
 * reads `apps/dashboard/dist` into `__SOBER_CLIENT__`), and turbo's `^build`
 * follows package dependencies and nothing else. `@besober/dashboard` was not
 * one, so a change to the canvas rebuilt `apps/dashboard/dist` and then replayed
 * `packages/cli` from a cache key that never mentioned it: `pnpm build` reported
 * FULL TURBO and `sober dashboard` went on serving the client from before the
 * change, with a fresh mtime on it to say otherwise.
 *
 * That cost three bug reports and two correct fixes that changed nothing a
 * person could see — the canvas was fixed and the binary still held the old one.
 * Read out of `build.mjs` rather than listed here, so the next directory the
 * bundler learns to inline arrives with its own dependency or goes red.
 */
test('every app whose build output the CLI inlines is a dependency of the CLI', () => {
	const build = readFileSync(join(repoRoot, 'packages/cli/build.mjs'), 'utf8')
	const cli = JSON.parse(readFileSync(join(repoRoot, 'packages/cli/package.json'), 'utf8')) as {
		dependencies?: Record<string, string>
		devDependencies?: Record<string, string>
	}
	const declared = { ...cli.dependencies, ...cli.devDependencies }

	const inlined = [...build.matchAll(/apps\/([\w-]+)\/dist/g)].map(([, name]) => name)
	expect(inlined, 'build.mjs inlines no app — this test is measuring nothing').not.toHaveLength(0)

	for (const app of inlined) {
		const { name } = JSON.parse(
			readFileSync(join(repoRoot, `apps/${app}/package.json`), 'utf8'),
		) as { name: string }
		expect(
			declared,
			`packages/cli/build.mjs inlines apps/${app}/dist and does not depend on ${name} — turbo will serve a stale one`,
		).toHaveProperty(name)
	}
})

/**
 * §7's second alarm. v0's ratio was 0.67 and the dashboard was still the thing
 * that ran away, because the problem was order rather than size — but this is
 * the one number that would have shown the phase running long while it was
 * running.
 *
 * An alarm warns and asks for an ADR; it does not fail the build (ADR 0023).
 * What *is* asserted is that the measurement works, because an alarm that
 * silently measures nothing is worse than no alarm.
 */
test('the dashboard has not outgrown core by half again', () => {
	const core = lines('packages/core')
	const dashboard = lines('apps/dashboard')

	expect(core, 'the line count found no core — the measurement is broken').toBeGreaterThan(1000)

	if (dashboard > core * 1.5) {
		console.warn(
			`apps/dashboard is ${dashboard} lines against core's ${core} — over 1.5x (BUILD-PLAN §7). An ADR, or a phase gate rewritten.`,
		)
	}
})
