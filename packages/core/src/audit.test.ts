import { expect, test } from 'vitest'
import { judge, posixShell } from './audit.js'
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
