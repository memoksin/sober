import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterAll, expect, test } from 'vitest'
import { checkHost, HOST_ARGS, hostCommand, NO_HUMAN, npmShimTarget, startAgent } from './host.js'

const scripts = mkdtempSync(join(tmpdir(), 'sober-host-'))
afterAll(() => rmSync(scripts, { recursive: true, force: true }))

/**
 * A host built out of node itself, so these run anywhere the suite does. It has
 * to be a file rather than `node -e "..."`: `dispatch.host` is split on
 * whitespace, which is the documented ceiling in host.ts.
 *
 * It is called `claude.mjs`, one per directory, because that is how SOBER knows
 * which host it is talking to (`hosts.ts`). A fake that impersonates a host now
 * has to say which one, which is the same rule a real wrapper script follows.
 */
let written = 0
const node = (script: string, host = 'claude'): string => {
	const dir = join(scripts, `host-${written++}`)
	mkdirSync(dir)
	const file = join(dir, `${host}.mjs`)
	writeFileSync(file, script)
	return `${process.execPath} ${file}`
}

test('the dispatched agent is told there is nobody to ask', () => {
	// M2 gate finding 1: the host discovers the operator's own CLAUDE.md, and a
	// rule there ("never commit without asking") stopped two of five dispatches
	// dead. `bypassPermissions` does not answer an instruction.
	const flag = HOST_ARGS.indexOf('--append-system-prompt')
	expect(flag).toBeGreaterThan(-1)
	expect(HOST_ARGS[flag + 1]).toBe(NO_HUMAN)
	expect(NO_HUMAN).toMatch(/no question you ask can be answered/)
	expect(NO_HUMAN).toMatch(/CLAUDE\.md/)
})

test('a host command may carry arguments, so `npx claude` needs no second setting', () => {
	expect(hostCommand('claude')).toEqual(['claude', []])
	expect(hostCommand('  npx  claude --model opus ')).toEqual(['npx', ['claude', '--model', 'opus']])
})

test('a host that is not installed is named, and not confused with a logged-out one', async () => {
	expect(await checkHost('/nonexistent/bin/claude')).toEqual({
		ok: false,
		reason: '/nonexistent/bin/claude is not installed, or is not on this PATH',
	})
})

test('the probe never carries the model flag the run line names', async () => {
	// `opencode --model x providers list` rejects the flag and prints its help,
	// which used to read as a host that could not report its status.
	const host = node(
		'if (process.argv.includes("--model")) { process.exit(1) } console.log(JSON.stringify({ loggedIn: true }))',
	)
	expect(await checkHost(`${host} --model some/model`)).toEqual({ ok: true, reason: null })
	expect(await checkHost(`${host} -m some/model`)).toEqual({ ok: true, reason: null })
})

test.skipIf(process.platform === 'win32')(
	'the openrouter probe spawns `sober`, never a program called openrouter',
	async () => {
		// ADR 0062: the run line names the host, the adapter names the binary. A
		// `sober` on the PATH here is this fake, and it sees the probe with the
		// model flag stripped, like every other host.
		const dir = join(scripts, 'openrouter-path')
		mkdirSync(dir)
		writeFileSync(
			join(dir, 'sober'),
			`#!/bin/sh\ncase "$*" in *--model*) exit 1;; "agent --check") echo ok;; *) echo "no key";; esac\n`,
			{ mode: 0o755 },
		)
		const path = process.env.PATH
		process.env.PATH = `${dir}:${path ?? ''}`
		try {
			expect(await checkHost('openrouter --model some/model')).toEqual({ ok: true, reason: null })
		} finally {
			process.env.PATH = path
		}
	},
)

test('a sober process runs its own entry for openrouter, never the PATH shim', async () => {
	// On Windows the PATH `sober` is a `.cmd` shim a shell-less spawn cannot
	// start. Nothing called sober is on this PATH, so only the self path passes.
	const dir = join(scripts, 'openrouter-self')
	mkdirSync(dir)
	const self = join(dir, 'sober.js')
	writeFileSync(
		self,
		`const a = process.argv.slice(2).join(' '); console.log(a === 'agent --check' ? 'ok' : 'no key')\n`,
	)
	const [argv1, path] = [process.argv[1], process.env.PATH]
	process.argv[1] = self
	process.env.PATH = dir
	try {
		expect(await checkHost('openrouter --model some/model')).toEqual({ ok: true, reason: null })
	} finally {
		process.argv[1] = argv1 as string
		process.env.PATH = path
	}
})

test('an npm .cmd shim resolves to the script it runs, and a native .exe wins', () => {
	// The tail of the shim `npm i -g @openai/codex` wrote on Windows, verbatim.
	const shim = `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n`
	const [first, second] = [join(scripts, 'shim-a'), join(scripts, 'shim-b')]
	mkdirSync(first)
	mkdirSync(second)
	writeFileSync(join(second, 'codex.cmd'), shim)
	const path = [first, second].join(delimiter)
	expect(npmShimTarget('codex', path)).toBe(
		join(second, 'node_modules\\@openai\\codex\\bin\\codex.js'),
	)
	expect(npmShimTarget('claude', path)).toBeNull()
	expect(npmShimTarget('/usr/bin/codex', path)).toBeNull()
	writeFileSync(join(first, 'codex.exe'), '')
	expect(npmShimTarget('codex', path)).toBeNull()
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

test('a host that answers its status on stderr is read there', async () => {
	// `codex login status` prints this to stderr and nothing to stdout.
	const host = node('console.error("Logged in using ChatGPT")', 'codex')
	expect(await checkHost(host)).toEqual({ ok: true, reason: null })
})

test('a logged-in host is ready, and says nothing else', async () => {
	expect(await checkHost(node('console.log(JSON.stringify({ loggedIn: true }))'))).toEqual({
		ok: true,
		reason: null,
	})
})

test('a host that cannot be started fails the run instead of hanging it', async () => {
	const exit = await startAgent({
		host: '/nonexistent/bin/claude',
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
