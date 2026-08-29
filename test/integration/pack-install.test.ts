import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, expect, test } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const cliDir = join(repoRoot, 'packages/cli')
const isWindows = process.platform === 'win32'

const run = (command: string, args: string[], cwd: string) =>
	execFileSync(command, args, { cwd, encoding: 'utf8', shell: isWindows })

let prefix: string

beforeAll(() => {
	prefix = mkdtempSync(join(tmpdir(), 'sober-pack-'))
	run(process.execPath, ['build.mjs'], cliDir)
}, 120_000)

afterAll(() => {
	rmSync(prefix, { recursive: true, force: true })
})

// The only check that exercises PR-00-01: a fresh install of the published
// tarball runs. Catches a missing file, an unbundled dependency, a broken
// shebang and a runtime resolution failure at once (ADR 0007).
test('the packed tarball installs and runs', () => {
	run('npm', ['pack', '--pack-destination', prefix], cliDir)
	const tarball = readdirSync(prefix).find((f) => f.endsWith('.tgz'))
	expect(tarball).toBeDefined()

	const args = [
		'install',
		'--prefix',
		prefix,
		'--no-audit',
		'--no-fund',
		join(prefix, tarball as string),
	]
	run('npm', args, prefix)

	const bin = join(prefix, 'node_modules', '.bin', isWindows ? 'sober.cmd' : 'sober')
	expect(run(bin, ['--help'], prefix)).toContain('usage: sober')
}, 180_000)
