#!/usr/bin/env node
/**
 * M1's gate is a script, not a sentence (BUILD-PLAN §3).
 *
 * This prepares the two things the nine steps need and then gets out of the
 * way: the CLI installed globally from its own tarball — the published shape,
 * not a checkout — and a real repository with a real test command, so
 * `dispatch.setup` and the acceptance criteria mean something.
 *
 * The host is NOT faked here. Step 6 spends real money on one `claude -p`.
 * That is the point of the gate: everything else has been proven against a
 * fake, and a fake cannot tell you whether the product exists.
 *
 *   pnpm gate:m1
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const bold = (text) => `[1m${text}[0m`
const dim = (text) => `[2m${text}[0m`
const step = (n, what) => `  ${bold(`${n}.`)}  ${what}`

const run = (command, args, cwd) =>
	execFileSync(command, args, {
		cwd,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'inherit'],
	}).trim()

// Step 1's first half: the published shape, installed the way a user installs
// it. A checkout on the PATH would prove nothing about what npm ships.
console.log(dim('packing @besober/cli…'))
const packDir = mkdtempSync(join(tmpdir(), 'sober-pack-'))
run(
	'pnpm',
	['--filter', '@besober/cli', 'exec', 'npm', 'pack', '--pack-destination', packDir],
	repoRoot,
)
const tarball = join(packDir, readdirSync(packDir)[0])
console.log(dim(`installing ${tarball} globally…`))
run('npm', ['install', '--global', tarball], repoRoot)
console.log(`${bold('sober')} ${run('sober', ['--version'], repoRoot)} is on your PATH.\n`)

// A real repository: something to install, something to test, something to read.
const dir = join(mkdtempSync(join(tmpdir(), 'sober-gate-')), 'ledger')
mkdirSync(join(dir, 'src'), { recursive: true })
writeFileSync(
	join(dir, 'package.json'),
	`${JSON.stringify(
		{
			name: 'ledger',
			version: '0.0.0',
			private: true,
			type: 'module',
			scripts: { test: 'node --test' },
		},
		null,
		'\t',
	)}\n`,
)
writeFileSync(
	join(dir, 'src/money.js'),
	`/** Amounts are integer minor units. Nothing here rounds. */
export const add = (left, right) => left + right
`,
)
writeFileSync(
	join(dir, 'src/money.test.js'),
	`import assert from 'node:assert/strict'
import { test } from 'node:test'
import { add } from './money.js'

test('adds minor units', () => {
	assert.equal(add(1250, 99), 1349)
})
`,
)
writeFileSync(
	join(dir, 'README.md'),
	'# ledger\n\nA small ledger service. Amounts are minor units.\n',
)

// A real project has a lockfile, and the lockfile is what `sober init` reads to
// write `dispatch.setup` concretely (`PR-00-06`). Without one it correctly
// declines to guess, and step 1 of the gate would read as a miss it is not.
run('npm', ['install', '--package-lock-only'], dir)

const git = (...args) => run('git', args, dir)
run('git', ['init', '-q', '--initial-branch=main', dir], repoRoot)
git('config', 'user.name', 'You')
git('config', 'user.email', 'you@example.com')
git('add', '-A')
git('commit', '-q', '-m', 'chore: first')

console.log(`
${bold('M1 — the nine steps, on a real repository.')} ${dim('The host is real. Step 6 costs money.')}

  cd ${dir}

${step(1, `${bold('sober init')}  ${dim('— the install above was its first half')}`)}
      ${dim('dispatch.setup should be detected as npm install. Read what it wrote.')}

${step(2, `${bold('claude')}  ${dim('then')}  ${bold(`/plugin marketplace add ${repoRoot}`)}`)}
      ${dim('then /plugin install sober@sober, and restart the session.')}
      ${dim('A plugin update does not restart its MCP server: quit claude and')}
      ${dim('start it again, or the session keeps talking to the old process.')}
      ${bold('/sober:plan')} ${dim('a currencies module, and an invoice total that uses it')}

${step(3, dim('read the proposed nodes and edges; accept them as a batch'))}

${step(4, `${bold('/sober:decide')}  ${dim('— options are produced, you pick in the host’s question')}`)}

${step(5, dim('ask for a node’s brief, read the approach, approve it'))}

${step(6, `${bold('sober run <node>')}  ${dim('— worktree, setup command, and a real agent')}`)}
      ${dim('This is the one real `claude -p`. Watch the tail.')}

${step(7, `${bold('sober review <node>')}  ${dim('— the scan, the criteria, then the files')}`)}

${step(8, `${bold('sober accept <node>')}  ${dim('— local merge, worktree removed')}`)}

${step(9, `${bold('sober status')}  ${dim('— the downstream node has moved off blocked')}`)}

${bold('Green means the product exists.')} ${dim('What happened goes in docs/M1-GATE.md.')}

${dim(`Afterwards:  npm rm -g @besober/cli  ·  rm -rf ${dir}`)}
`)
