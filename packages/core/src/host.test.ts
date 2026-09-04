import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, test } from 'vitest'
import { checkHost, hostCommand, startAgent } from './host.js'

const scripts = mkdtempSync(join(tmpdir(), 'sober-host-'))
afterAll(() => rmSync(scripts, { recursive: true, force: true }))

/**
 * A host built out of node itself, so these run anywhere the suite does. It has
 * to be a file rather than `node -e "..."`: `dispatch.host` is split on
 * whitespace, which is the documented ceiling in host.ts.
 */
let written = 0
const node = (script: string): string => {
	const file = join(scripts, `host-${written++}.mjs`)
	writeFileSync(file, script)
	return `${process.execPath} ${file}`
}

test('a host command may carry arguments, so `npx claude` needs no second setting', () => {
	expect(hostCommand('claude')).toEqual(['claude', []])
	expect(hostCommand('  npx  claude --model opus ')).toEqual(['npx', ['claude', '--model', 'opus']])
})

test('a host that is not installed is named, and not confused with a logged-out one', async () => {
	expect(await checkHost('sober-no-such-host')).toEqual({
		ok: false,
		reason: 'sober-no-such-host is not installed, or is not on this PATH',
	})
})

test('a host that is logged out says which command signs in', async () => {
	const host = node('console.log(JSON.stringify({ loggedIn: false }))')
	const { ok, reason } = await checkHost(host)
	expect(ok).toBe(false)
	expect(reason).toContain('auth login')
})

test('a host that cannot report its status is a refusal, never a silent pass', async () => {
	expect(await checkHost(node('process.exit(2)'))).toMatchObject({
		ok: false,
		reason: expect.stringContaining('could not report'),
	})
	expect(await checkHost(node('console.log("not json")'))).toMatchObject({
		ok: false,
		reason: expect.stringContaining('cannot read'),
	})
})

test('a logged-in host is ready, and says nothing else', async () => {
	expect(await checkHost(node('console.log(JSON.stringify({ loggedIn: true }))'))).toEqual({
		ok: true,
		reason: null,
	})
})

test('a host that cannot be started fails the run instead of hanging it', async () => {
	const exit = await startAgent({
		host: 'sober-no-such-host',
		cwd: process.cwd(),
		prompt: 'do the thing',
		onLine: () => {},
	})
	expect(exit).toEqual({ kind: 'failed', reason: expect.stringContaining('not installed') })
})

test('a last line with no newline still reaches the log', async () => {
	// The host is killed, or writes its final byte without a newline. Dropping
	// that line loses exactly the output a failing run is read for.
	const lines: string[] = []
	await startAgent({
		host: node('process.stdout.write("first\\nno trailing newline")'),
		cwd: process.cwd(),
		prompt: 'ignored',
		onLine: (line) => lines.push(line),
	})
	expect(lines).toEqual(['first', 'no trailing newline'])
})

test('a host that exits non-zero reports its own last words', async () => {
	const exit = await startAgent({
		host: node('console.error("the host gave up"); process.exit(7)'),
		cwd: process.cwd(),
		prompt: 'ignored',
		onLine: () => {},
	})
	expect(exit).toEqual({
		kind: 'failed',
		reason: expect.stringContaining('the host gave up'),
	})
})
