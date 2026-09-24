import { join } from 'node:path'
import { expect, test } from 'vitest'
import { judge, posixShell, posixShellFor } from './audit.js'
import { tmpRoot } from './tmp.fixture.js'

test('a single-quoted command with < and spaces survives the shell', async () => {
	const cwd = await tmpRoot('sober-audit-')
	const judged = await judge(
		cwd,
		`node -e 'process.exit(process.argv[1] === "a <b c" ? 0 : 3)' 'a <b c'`,
	)
	expect(judged.result).toEqual({ exit: 0 })
})

test('the shell has the tools an npm sh shim calls', async () => {
	// Git's `usr/bin/sh.exe` started directly has neither, and `pnpm install`
	// through it died in the shim before pnpm ran.
	const cwd = await tmpRoot('sober-audit-')
	expect((await judge(cwd, 'command -v sed && command -v dirname')).result).toEqual({ exit: 0 })
})

test('a non-zero exit is kept', async () => {
	const cwd = await tmpRoot('sober-audit-')
	const judged = await judge(cwd, 'node -e "process.exit(7)"')
	expect(judged.result).toEqual({ exit: 7 })
})

test('a missing tool reads as did-not-run', async () => {
	const cwd = await tmpRoot('sober-audit-')
	const judged = await judge(cwd, 'sober-this-tool-does-not-exist')
	expect(judged.result).toBeNull()
})

test.runIf(process.platform === 'win32')('posixShell finds Git for Windows sh.exe', () => {
	const shell = posixShell()
	expect(typeof shell).toBe('string')
	expect(shell).toMatch(/sh\.exe$/)
})

test('a shell that never runs the audit reports as did-not-run, never a pass', async () => {
	const judged = await judge('.', 'node -e "process.exit(0)"', null)
	expect(judged).toEqual({ result: null, output: 'no POSIX shell found: install Git for Windows' })
})

test('off win32, posixShellFor never touches git and keeps Node’s default shell', () => {
	expect(
		posixShellFor(
			'linux',
			() => 'unused',
			() => true,
		),
	).toBe(true)
	expect(
		posixShellFor(
			'darwin',
			() => 'unused',
			() => true,
		),
	).toBe(true)
})

test('on win32, `bin/sh.exe` wins when both candidates exist', () => {
	const root = join('C:', 'Git')
	const shell = posixShellFor(
		'win32',
		() => join(root, 'libexec', 'git-core', 'git.exe'),
		(path) => path === join(root, 'bin', 'sh.exe') || path === join(root, 'usr', 'bin', 'sh.exe'),
	)
	expect(shell).toBe(join(root, 'bin', 'sh.exe'))
})

test('on win32, `usr/bin/sh.exe` is the fallback when `bin/sh.exe` is missing', () => {
	const root = join('C:', 'Git')
	const shell = posixShellFor(
		'win32',
		() => join(root, 'libexec', 'git-core', 'git.exe'),
		(path) => path === join(root, 'usr', 'bin', 'sh.exe'),
	)
	expect(shell).toBe(join(root, 'usr', 'bin', 'sh.exe'))
})

test('on win32, neither candidate existing is null, never a guess', () => {
	expect(
		posixShellFor(
			'win32',
			() => join('C:', 'Git', 'git.exe'),
			() => false,
		),
	).toBeNull()
})

test('on win32, `git --exec-path` throwing is null, never a crash', () => {
	const shell = posixShellFor(
		'win32',
		() => {
			throw new Error('git not found')
		},
		() => true,
	)
	expect(shell).toBeNull()
})
