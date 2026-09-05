#!/usr/bin/env node
/**
 * M2's gate is M1's script with a teammate (BUILD-PLAN §3).
 *
 * It prepares four things and then gets out of the way: the CLI installed
 * globally from its own tarball, a **real private repository on your GitHub
 * account** with a real workflow so CI actually runs, Alice's clone with a real
 * project in it, and Bob's clone of the same repository.
 *
 * Nothing here is faked. M1's gate did not fake the host because a fake host
 * cannot tell you whether the product exists; M2's does not fake `gh` for the
 * same reason. Everything about the git host has been proven against a
 * stand-in already (`test/integration/pr.test.ts`, `pnpm demo:pr`), and a
 * stand-in answers the way the documentation says rather than the way GitHub
 * does.
 *
 * It costs: a few real `claude -p` runs, and a handful of Actions minutes.
 * It creates one repository on your account and never deletes it — the last
 * line of the output is the command that does.
 *
 *   pnpm gate:m2
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const bold = (text) => `\x1b[1m${text}\x1b[0m`
const dim = (text) => `\x1b[2m${text}\x1b[0m`
const step = (n, what) => `  ${bold(`${n}.`)}  ${what}`

const run = (command, args, cwd) =>
	execFileSync(command, args, {
		cwd,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'inherit'],
	}).trim()

const stop = (why) => {
	console.error(`${why}\n`)
	process.exit(1)
}

// `gh` logged out is one sentence, not a stack trace three minutes in — the
// same rule SOBER holds itself to (§8.7).
try {
	run('gh', ['auth', 'status'], repoRoot)
} catch {
	stop(
		'gh is not logged in. Run `gh auth login`, then this again — the gate needs a real repository.',
	)
}

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

// A real repository: something to install, something to test, and a workflow,
// because CI that nobody runs is the one thing a stand-in could not answer for.
const root = mkdtempSync(join(tmpdir(), 'sober-m2-'))
const alice = join(root, 'alice')
const bob = join(root, 'bob')
const name = `sober-m2-gate-${Date.now().toString(36)}`

mkdirSync(join(alice, 'src'), { recursive: true })
mkdirSync(join(alice, '.github/workflows'), { recursive: true })
writeFileSync(
	join(alice, 'package.json'),
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
	join(alice, 'src/money.js'),
	`/** Amounts are integer minor units. Nothing here rounds. */
export const add = (left, right) => left + right
`,
)
writeFileSync(
	join(alice, 'src/money.test.js'),
	`import assert from 'node:assert/strict'
import { test } from 'node:test'
import { add } from './money.js'

test('adds minor units', () => {
	assert.equal(add(1250, 99), 1349)
})
`,
)
writeFileSync(
	join(alice, 'README.md'),
	'# ledger\n\nA small ledger service. Amounts are minor units.\n',
)
// The workflow lives on the base branch, because that is the copy a pull
// request's checks are read from.
writeFileSync(
	join(alice, '.github/workflows/ci.yml'),
	`name: ci

on:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: '24'
      - run: npm ci
      - run: npm test
`,
)

// A real project has a lockfile, and the lockfile is what `sober init` reads to
// write `dispatch.setup` concretely (`PR-00-06`).
run('npm', ['install', '--package-lock-only'], alice)

const git =
	(dir) =>
	(...args) =>
		run('git', args, dir)
run('git', ['init', '-q', '--initial-branch=main', alice], repoRoot)
const asAlice = git(alice)
asAlice('config', 'user.name', 'Alice')
asAlice('config', 'user.email', 'alice@example.com')
asAlice('config', 'commit.gpgsign', 'false')
asAlice('add', '-A')
asAlice('commit', '-q', '-m', 'chore: first')

console.log(dim(`creating github.com/<you>/${name} (private)…`))
run(
	'gh',
	['repo', 'create', name, '--private', '--source', alice, '--remote', 'origin', '--push'],
	alice,
)
const url = run('gh', ['repo', 'view', name, '--json', 'url', '--jq', '.url'], alice)
// Printed here and again at the end: a run interrupted between the two still
// leaves the one command that undoes it on the screen.
console.log(dim(`  it exists now — ${bold(`gh repo delete ${name} --yes`)} removes it`))

console.log(dim('cloning it as Bob…'))
run('gh', ['repo', 'clone', name, bob], root)
const asBob = git(bob)
asBob('config', 'user.name', 'Bob')
asBob('config', 'user.email', 'bob@example.com')
asBob('config', 'commit.gpgsign', 'false')

console.log(`
${bold('M2 — the nine steps, with a teammate.')} ${dim('The host is real. So is the git host.')}

  ${bold('Alice')}  cd ${alice}
  ${bold('Bob')}    cd ${bob}
  ${dim(url)}

${bold('Part 1 — the loop, once, on a real repository')} ${dim('(M1’s nine steps)')}

${step(1, `${bold('sober init')}  ${dim('as Alice — dispatch.setup should read npm ci')}`)}

${step(2, `${bold('claude')}  ${dim('then')}  ${bold(`/plugin marketplace add ${repoRoot}`)}`)}
      ${dim('then /plugin install sober@sober, and restart the session.')}
      ${bold('/sober:plan')} ${dim('a currencies module, and an invoice total that uses it')}

${step(3, dim('read the proposed nodes and edges; accept them as a batch'))}

${step(4, `${bold('/sober:decide')}  ${dim('— options are produced, you pick through elicitation')}`)}

${step(5, dim('ask for a node’s brief, read the approach, approve it'))}

${step(6, `${bold('sober run <node>')}  ${dim('— a real agent, and then a real draft pull request')}`)}
      ${dim('the last line is the draft. Open it. Actions should be running on it.')}

${step(7, `${bold('sober review <node>')}  ${dim('— the scan, the criteria, and CI, read live')}`)}

${step(8, `${bold('sober accept <node>')}  ${dim('— it lands; the worktree goes away')}`)}

${step(9, `${bold('sober status')}  ${dim('— the downstream node has moved off blocked')}`)}

${bold('Part 2 — the second person, which is what M2 is')}

${step(10, `${bold('sober sync')}  ${dim('as Alice — the board goes to the sober-graph branch')}`)}
      ${dim('git ls-remote --heads origin   ·   nothing about it is on main')}

${step(11, `${bold('sober init')}  ${dim('as Bob — it takes the team’s board, it does not make a second')}`)}
      ${bold('sober status')} ${dim('as Bob: the same graph, from the same records')}
      ${dim('any other command in a clone with no board says which one takes it')}

${step(12, `${bold('sober contributors add Bob')}  ${dim('· then')} ${bold('sober assign <node> Bob')}`)}
      ${dim('the handle is the git user.name a claim will report — here, Bob')}
      ${dim('assignment is a plan; claim is a fact. Both travel with the board.')}

${step(13, `${bold('sober claim <node>')}  ${dim('as Bob, on a node whose files meet Alice’s')}`)}
      ${dim('it warns and refuses nothing — a claim is a signal, not a lock')}
      ${bold('sober run <that node>')} ${dim('— refused, with the overlap named, until --anyway')}

${step(14, `${bold('sober run <node>')}  ${dim('as Bob — his own draft, on the same repository')}`)}
      ${dim('one draft per node, never one per attempt: reject it and run it again')}

${step(15, `${dim('both edit the same node, both')} ${bold('sober sync')}`)}
      ${dim('the second one is asked, field by field, and answers on the command line')}
      ${dim('try the archive question too: one archives it, the other edits it')}

${step(16, `${bold('sober approve <node> --queue')}  ${dim('on something still blocked')}`)}
      ${dim('then accept what it depends on — it starts on its own, and says so')}

${step(17, `${bold('sober accept --green')}  ${dim('— verification, criteria, scan and CI, together')}`)}
      ${dim('nothing lands while a check is red; the reason names the check')}

${bold('And the one that only happens once:')}

  ${dim('an older board, brought forward. In Alice’s clone:')}
  node -e "const f='.sober/project.json',fs=require('fs');const p=JSON.parse(fs.readFileSync(f));p.schemaVersion=1;fs.writeFileSync(f,JSON.stringify(p,null,'\\t'))"
  ${dim('drop "assignee" and "claim" from one node file, then')} ${bold('sober status')}
  ${dim('one line says what it rewrote. The records are on sober-graph, not main,')}
  ${dim('so `git diff` here shows nothing — read the file, or `sober sync` and diff that')}

${bold('Green means the product travels.')} ${dim('What happened goes in docs/M2-GATE.md.')}

${dim(`Afterwards:  npm rm -g @besober/cli  ·  gh repo delete ${name} --yes  ·  rm -rf ${root}`)}
`)
