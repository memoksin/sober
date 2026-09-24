#!/usr/bin/env node
/**
 * Phase 4, session 3 — the team, for you to drive.
 *
 * One bare remote and two clones, as in `demo:conflict`, plus a third
 * repository holding a board exactly as M1 wrote it — no assignee, no claim —
 * so you can watch a real migration happen in front of you.
 *
 * Nothing is faked: real git, a real remote, the built CLI.
 *
 *   pnpm demo:team
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../', import.meta.url))
const SOBER = join(repoRoot, 'packages/cli/dist/sober.js')
const AT = new Date().toISOString()

const bold = (text) => `[1m${text}[0m`
const dim = (text) => `[2m${text}[0m`

const root = mkdtempSync(join(tmpdir(), 'sober-demo-'))
const remote = join(root, 'acme.git')
const alice = join(root, 'alice')
const bob = join(root, 'bob')
const old = join(root, 'last-year')

const run = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const sober = (cwd, ...args) =>
	execFileSync(process.execPath, [SOBER, ...args], { cwd, stdio: 'ignore' })

const identify = (dir, name) => {
	run(dir, 'config', 'user.name', name)
	run(dir, 'config', 'user.email', `${name.toLowerCase()}@example.com`)
	run(dir, 'config', 'commit.gpgsign', 'false')
}

const node = (fields) => ({
	title: 'A node',
	description: '',
	notes: '',
	dependsOn: [],
	decisions: [],
	files: [],
	brief: null,
	outcome: null,
	assignee: null,
	claim: null,
	accepted: null,
	createdAt: AT,
	...fields,
})

const write = (dir, id, fields) =>
	writeFileSync(
		join(dir, '.sober/nodes', `${id}.json`),
		`${JSON.stringify(node(fields), null, '\t')}\n`,
	)

execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main', remote])
execFileSync('git', ['init', '-q', '--initial-branch=main', alice])
identify(alice, 'Alice')
run(alice, 'remote', 'add', 'origin', remote)
writeFileSync(join(alice, 'README.md'), '# acme\n')
run(alice, 'add', '-A')
run(alice, 'commit', '-q', '-m', 'chore: first')
sober(alice, 'init', '--title', 'Acme', '--intent', 'Ship sign-in')

// Two of these predict the same file. That is the whole of §3.4.
write(alice, 'auth-api-k7f2', { title: 'The auth API', files: ['src/auth/**'] })
write(alice, 'session-ui-m3q8', {
	title: 'The session panel',
	files: ['src/auth/session.ts', 'src/ui/**'],
})
write(alice, 'billing-p2x1', { title: 'Billing', files: ['src/billing/**'] })

run(alice, 'add', '-A')
run(alice, 'commit', '-q', '-m', 'chore: sober')
run(alice, 'push', '-q', '-u', 'origin', 'main')
sober(alice, 'sync')

execFileSync('git', ['clone', '-q', remote, bob])
identify(bob, 'Bob')
sober(bob, 'init')

// Bob is already on one of them, so the warning has someone to name.
sober(bob, 'contributors', 'add', 'Bob', '--role', 'maintainer', '--focus', 'ui')
sober(bob, 'claim', 'session-ui-m3q8')
sober(bob, 'sync')

// A board exactly as M1 wrote it: schema 1, and not a claim in sight.
execFileSync('git', ['init', '-q', '--initial-branch=main', old])
identify(old, 'Alice')
writeFileSync(join(old, 'README.md'), '# last year\n')
run(old, 'add', '-A')
run(old, 'commit', '-q', '-m', 'chore: first')
sober(old, 'init', '--title', 'Last year', '--intent', 'Before the team existed')
writeFileSync(
	join(old, '.sober/project.json'),
	`${JSON.stringify(
		{
			schemaVersion: 1,
			title: 'Last year',
			intent: 'Before the team existed',
			constraints: [],
		},
		null,
		'\t',
	)}\n`,
)
for (const [id, title] of [
	['old-api-k7f2', 'Written before assignee existed'],
	['old-ui-m3q8', 'And before claim did'],
]) {
	const { assignee, claim, ...v1 } = node({ title, files: ['src/**'] })
	writeFileSync(join(old, '.sober/nodes', `${id}.json`), `${JSON.stringify(v1, null, '\t')}\n`)
}

console.log(`
${bold('One remote, two people, and one board from before the team existed:')}

  ${dim('alice')}      ${alice}
  ${dim('bob')}        ${bob}
  ${dim('last year')}  ${old}

  cd ${alice}
  alias sober='node ${SOBER}'

${bold('1. Who is on the project')}

  sober sync                     ${dim('take in what Bob did')}
  sober contributors             ${dim('Bob put himself on it, and it travelled')}

  sober assign auth-api-k7f2 Alice     ${dim('refused — nobody wrote Alice down')}
  sober contributors add Alice --role maintainer --focus core
  sober assign auth-api-k7f2 Alice
  sober status                   ${dim('→ Alice: a plan')}

${bold('2. Claiming, and the same files')}

  sober claim auth-api-k7f2      ${dim('a fact — and Bob is heading for src/auth/session.ts')}
  sober status                   ${dim('@Alice replaces the arrow: the plan became a fact')}

  ${dim('Nothing was blocked. A claim is a signal, never a lock (D23).')}

  sober claim billing-p2x1       ${dim('no overlap, so nothing is said')}

${bold('3. Taking one that is already someone else’s')}

  sober claim session-ui-m3q8    ${dim('Bob’s — reported, not refused')}
  sober release session-ui-m3q8  ${dim('give it back')}

${bold('4. It belongs to the project, not to your machine')}

  sober sync
  cd ${bob}
  sober sync
  sober status                   ${dim('Bob sees who is on what')}
  sober contributors

${bold('5. A board written before any of this existed')}

  cd ${old}
  cat .sober/project.json        ${dim('schemaVersion 1, and the nodes have no claim')}
  sober status                   ${dim('brought forward on the way in, and it says so')}
  cat .sober/nodes/old-api-k7f2.json
  sober status                   ${dim('once only — nothing to say the second time')}

${bold('Also worth trying:')}

  sober contributors remove Bob             ${dim('what happens to what he was assigned')}
  sober contributors invite Bob             ${dim('refused, with the two actions there are')}
  sober assign auth-api-k7f2                ${dim('assigned to nobody again')}
  ${dim('then set schemaVersion to 99 in .sober/project.json and run sober status')}

${bold('In a session, instead of the terminal:')}

  ${dim(`claude mcp add sober -- node ${SOBER} mcp`)}
  ${dim('the same four operations are there — contributors, assign, claim, release —')}
  ${dim('and an older board is refused there, pointing at the terminal that can')}
  ${dim('rewrite it and say what it rewrote.')}
`)
