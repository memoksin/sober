#!/usr/bin/env node
/**
 * M3's gate is the same nine steps with no terminal (BUILD-PLAN §3).
 *
 * What "no terminal" means here, precisely, because the claim is what is being
 * tested: `sober init` and `sober dashboard` are terminal commands by
 * construction — ADR 0037 keeps the server in the foreground and Ctrl-C is how
 * it stops — and planning is a host session by ADR 0009. So the shell is
 * opened three times: to install, to init, and to serve. After that,
 * **no `sober <verb>` is typed.** Accepting the proposal, answering a decision,
 * approving a brief, starting a run, reading the review, accepting it, and
 * editing an answer all happen on the screen. That is the sentence the drive
 * either keeps or breaks.
 *
 * Nothing is faked that the gate exists to prove. M1's gate did not fake the
 * host and M2's did not fake `gh`, for the same reason: a stand-in answers the
 * way the documentation says rather than the way the thing does. M3's
 * equivalent is **the browser and the person**. There is no Playwright here and
 * no replayed clicks — a script that replays clicks answers "do the selectors
 * still match", and the question is whether the loop closes for someone who
 * never opens a shell. The dashboard client is built into the CLI bundle
 * (bd3aa9d), so what the browser loads is what npm ships, not what Vite serves.
 *
 * It runs in two phases.
 *
 *   pnpm gate:m3                 prepares the CLI, the repository and the remote
 *   node scripts/m3-gate.mjs --seed <alice>   after step 9 — see below
 *
 * The second phase exists because three screens landed after M3's step list was
 * written — the digest (§7.1), the flagged-node flow (§7.2) and the impact
 * preview (§2.8) — and none of them renders against a board where no decision
 * has moved since a brief was approved. It seeds that state, and it publishes a
 * change from a second clone so the digest's delta half has a real
 * remote-tracking ref to diff against (ADR 0042). What is seeded is the board's
 * *history*; the screens compute from those records exactly as they would from
 * records a drive produced.
 *
 * It costs: a real `claude -p` at step 6, a handful of Actions minutes, and one
 * repository on your account that is never deleted for you — the command that
 * removes it is printed the moment it exists, and again at the end.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const bold = (text) => `\x1b[1m${text}\x1b[0m`
const dim = (text) => `\x1b[2m${text}\x1b[0m`
/**
 * The drive sheet is a file, not scrollback. Twelve steps of ANSI get buried by
 * the first thing the session prints, and the driver of the first run asked for
 * a file after losing them — so the steps are written once, as markdown, and
 * the terminal gets the path. `m1-gate.mjs` and `m2-gate.mjs` still print only.
 */
const sheet = (where, what) => {
	// Beside the repository, never inside it: an untracked file in the tree the
	// gate is judging is one more thing the drive has to explain away.
	const file = join(where, '..', 'DRIVE.md')
	writeFileSync(file, what)
	console.log(what.replace(/^/gm, '  '))
	console.log(`${dim('  the same thing, in a file you can keep open:')}\n  ${bold(file)}\n`)
}

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

const json = (value) => `${JSON.stringify(value, null, '\t')}\n`

// ---------------------------------------------------------------------------
// Phase two — the seed, run after step 9 against the board the drive built.
// ---------------------------------------------------------------------------

/**
 * Three records and a second clone. The two nodes are bound to one decision
 * whose answer is written *after* both briefs were approved, which is the whole
 * of the flag: §2.8's derivation compares `answer.at` against
 * `max(brief.approval.at, dismissal.at)` and looks at no status, so one
 * finished node and one unfinished node are both flagged and the impact
 * preview has two rows with different statuses to show.
 */
const seed = (alice) => {
	const sober = join(alice, '.sober')
	if (!readdirSync(alice).includes('.sober')) {
		stop(`${alice} has no board. Run step 1 — sober init — before seeding.`)
	}

	const by = run('git', ['config', 'user.name'], alice)
	const at = (minutesAgo) => new Date(Date.now() - minutesAgo * 60_000).toISOString()
	const approvedAt = at(90)
	const acceptedAt = at(75)
	const answeredAt = at(30)
	const createdAt = at(120)

	const decisionId = 'how-should-tax-be-rounded-m3gt'
	const roundedNode = 'round-tax-per-line-m3gt'
	const totalNode = 'total-an-invoice-with-tax-m3gt'

	writeFileSync(
		join(sober, 'decisions', `${decisionId}.json`),
		json({
			category: 'data-flow',
			question: 'Where is tax rounded on a multi-line invoice?',
			options: [
				{
					id: 'per-line',
					label: 'Round each line, then sum',
					reason: 'Every line is a printable amount on its own.',
					costLater: 'The total can differ from tax on the subtotal by a cent per line.',
				},
				{
					id: 'on-total',
					label: 'Sum exactly, then round once',
					reason: 'The invoice total matches tax computed on the subtotal.',
					costLater: 'A printed line does not equal the amount that was summed.',
				},
				{
					id: 'per-line-with-remainder',
					label: 'Round per line and carry the remainder',
					reason: 'Both the lines and the total are exact.',
					costLater: 'Every reader has to understand the carry to check an invoice by hand.',
				},
			],
			suggested: 'per-line',
			answer: {
				option: 'per-line',
				rationale: 'Lines are what a customer disputes.',
				by,
				at: answeredAt,
			},
			createdAt,
		}),
	)

	const node = (fields) => ({
		description: '',
		notes: '',
		dependsOn: [],
		decisions: [decisionId],
		outcome: null,
		assignee: null,
		claim: null,
		accepted: null,
		dismissal: null,
		createdAt,
		...fields,
	})

	writeFileSync(
		join(sober, 'nodes', `${roundedNode}.json`),
		json(
			node({
				title: 'Round tax per line',
				files: ['src/tax.js', 'src/tax.test.js'],
				brief: {
					approach: 'Round each line with the mode the decision names, in src/tax.js.',
					acceptance: [{ run: 'npm test', proves: 'the per-line rounding cases pass' }],
					approval: { by, at: approvedAt, queue: false },
				},
				// Finished before the answer moved: §2.8's third row, the one the
				// narrow reading of the flag used to miss.
				accepted: { by, at: acceptedAt, flagged: false, scan: 'clean' },
			}),
		),
	)

	writeFileSync(
		join(sober, 'nodes', `${totalNode}.json`),
		json(
			node({
				title: 'Total an invoice with tax',
				files: ['src/invoice.js', 'src/invoice.test.js'],
				dependsOn: [roundedNode],
				brief: {
					approach: 'Sum the rounded lines from src/tax.js and return minor units.',
					acceptance: [{ run: 'npm test', proves: 'a two-line invoice totals correctly' }],
					approval: { by, at: approvedAt, queue: false },
				},
			}),
		),
	)

	console.log(dim('publishing the seeded board…'))
	run('sober', ['sync'], alice)

	// The delta half of the digest is a diff against a remote-tracking ref, so
	// something has to move the remote. A second clone is the honest way: a
	// commit written into alice's own board branch would be a diff with nobody
	// on the other side of it.
	const root = join(alice, '..')
	const bob = join(root, 'bob')
	const name = run('gh', ['repo', 'view', '--json', 'name', '--jq', '.name'], alice)
	console.log(dim('cloning it as Bob, who will move the remote…'))
	run('gh', ['repo', 'clone', name, bob], root)
	run('git', ['config', 'user.name', 'Bob'], bob)
	run('git', ['config', 'user.email', 'bob@example.com'], bob)
	run('git', ['config', 'commit.gpgsign', 'false'], bob)
	run('sober', ['init'], bob)
	run('sober', ['open', '--title', 'Print a receipt for a paid invoice'], bob)
	run('sober', ['sync'], bob)

	sheet(
		alice,
		`# M3 — steps 10 to 12, the three screens that have never had a reader

Reopen the dashboard in Alice's clone. The board now carries:

- \`${decisionId}\` — answered **after** both briefs were approved
- \`${roundedNode}\` — done, and flagged by that answer
- \`${totalNode}\` — unfinished, and flagged by the same answer
- one node pushed by Bob that Alice has never seen

## 10. The digest — the bar under the header, on open (§7.1)

- a delta: Bob's node, found by a fetch this open did once
- a snapshot: two flagged nodes
- dismiss the bar; it stays dismissed

## 11. The flagged-node flow — on either flagged node (§7.2)

- dismiss one with a reason. The watermark is the record (ADR 0043)
- the other node is still flagged — a judgement is per node

## 12. The impact preview — the decision screen, on the seeded decision (§2.8)

- pick a different option. The fan-out renders above the button, with each
  node's status; the second click applies it (ADR 0044)
- afterwards both nodes read \`needs-brief\` — the approach is gone, on purpose
- the option that stands is marked and cannot be re-picked

This is where the three screens meet a human for the first time. What happened
goes in \`docs/M3-GATE.md\`, in \`M2-GATE.md\`'s shape.
`,
	)
}

const seedAt = process.argv.indexOf('--seed')
if (seedAt !== -1) {
	const alice = process.argv[seedAt + 1]
	if (!alice) stop('--seed needs the path to Alice’s clone.')
	seed(alice)
	process.exit(0)
}

// ---------------------------------------------------------------------------
// Phase one — the CLI, the repository, the remote, and then out of the way.
// ---------------------------------------------------------------------------

try {
	run('gh', ['auth', 'status'], repoRoot)
} catch {
	stop('gh is not logged in. Run `gh auth login`, then this again — the digest needs a remote.')
}

// The published shape, installed the way a user installs it. Both earlier gates
// found packaging defects this way, and this one carries the dashboard client
// inside the bundle: a checkout on the PATH would serve a different page.
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

const root = mkdtempSync(join(tmpdir(), 'sober-m3-'))
const alice = join(root, 'alice')
const name = `sober-m3-gate-${Date.now().toString(36)}`

mkdirSync(join(alice, 'src'), { recursive: true })
mkdirSync(join(alice, '.github/workflows'), { recursive: true })
writeFileSync(
	join(alice, 'package.json'),
	json({
		name: 'ledger',
		version: '0.0.0',
		private: true,
		type: 'module',
		scripts: { test: 'node --test' },
	}),
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

// The lockfile is what `sober init` reads to write `dispatch.setup` concretely.
run('npm', ['install', '--package-lock-only'], alice)

run('git', ['init', '-q', '--initial-branch=main', alice], repoRoot)
run('git', ['config', 'user.name', 'Alice'], alice)
run('git', ['config', 'user.email', 'alice@example.com'], alice)
run('git', ['config', 'commit.gpgsign', 'false'], alice)
run('git', ['add', '-A'], alice)
run('git', ['commit', '-q', '-m', 'chore: first'], alice)

console.log(dim(`creating github.com/<you>/${name} (private)…`))
run(
	'gh',
	['repo', 'create', name, '--private', '--source', alice, '--remote', 'origin', '--push'],
	alice,
)
// Printed here and again at the end: a run interrupted between the two still
// leaves the one command that undoes it on the screen.
console.log(dim(`  it exists now — ${bold(`gh repo delete ${name} --yes`)} removes it`))

sheet(
	alice,
	`# M3 — the nine steps, with no terminal

The browser is real, and so is the person. \`cd ${alice}\`

The shell is opened three times and never again: to install, to init, and to
serve. Planning is a session (ADR 0009); the server is in the foreground
(ADR 0037). Every other move below is a click. **If you reach for \`sober\`
anything after step 1, that is a finding** — write down what you reached for.

## 1. \`sober init\`, then \`claude\` for the plugin, then \`sober dashboard\`

- \`/plugin marketplace add ${repoRoot}\` · \`/plugin install sober@sober\` · restart
- open the printed URL, token and all. Leave that terminal alone.

## 2. \`/sober:plan\` in the session

Intent in free text — a currencies module, and an invoice total.

## 3. On the canvas: the proposed nodes and edges; accept them as a batch

## 4. Open a decision on the decision screen, and pick through it

## 5. Read a node's brief in the panel, and approve it there

The brief itself is written by the session — the command line has no model.

## 6. Start the run from the canvas

Worktree, setup command, a real agent. This is the one real \`claude -p\`, and
it spends money.

## 6b. Close the tab while it runs, then reopen it (ADR 0037)

The run is still there. The server's lifetime is the terminal's, not the tab's
— and this sentence has never been driven by a person.

## 7. The run finishes: the scan runs, the review screen shows diff and findings

## 8. Accept from the review screen — local merge, worktree removed

## 9. A downstream node moves off \`blocked\` on the canvas, with no reload

## Then, for the three screens that have never had a reader

    node ${join(repoRoot, 'scripts/m3-gate.mjs')} --seed ${alice}

It seeds a decision answered after two briefs were approved, and pushes a node
from a second clone so the digest has a real delta. It rewrites this file with
steps 10 to 12.

Nothing is fixed during the drive — a fix mid-drive invalidates every step after
it, which is why both earlier gates fixed in the commit after.

**Green means the loop closes with no terminal.**

## Teardown, and it is final

    npm rm -g @besober/cli
    gh repo delete ${name} --yes
    rm -rf ${root}

The board, the seeded records and the remote go together. A drive that stopped
early cannot be resumed after this — run \`pnpm gate:m3\` again instead.
`,
)
