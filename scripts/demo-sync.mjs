#!/usr/bin/env node
/**
 * Phase 4, session 1 — the board travels, for you to drive.
 *
 * One bare remote and two clones of it on this machine, which is M2's gate in
 * miniature. Alice has a board with two nodes on it and has never pushed. Bob
 * has a clone of the same repository and no board at all.
 *
 * Nothing here is faked: real git, a real remote, the built CLI.
 *
 *   pnpm demo:sync
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

const run = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const sober = (cwd, ...args) =>
	execFileSync(process.execPath, [SOBER, ...args], { cwd, stdio: 'ignore' })

const identify = (dir, name) => {
	run(dir, 'config', 'user.name', name)
	run(dir, 'config', 'user.email', `${name.toLowerCase()}@example.com`)
	run(dir, 'config', 'commit.gpgsign', 'false')
}

execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main', remote])
execFileSync('git', ['init', '-q', '--initial-branch=main', alice])
identify(alice, 'Alice')
run(alice, 'remote', 'add', 'origin', remote)
writeFileSync(join(alice, 'README.md'), '# acme\n')
run(alice, 'add', '-A')
run(alice, 'commit', '-q', '-m', 'chore: first')

sober(alice, 'init', '--title', 'Acme', '--intent', 'Ship sign-in')

const node = (title, description, files) =>
	JSON.stringify(
		{
			title,
			description,
			notes: '',
			dependsOn: [],
			decisions: [],
			files,
			brief: null,
			outcome: null,
			assignee: null,
			claim: null,
			accepted: null,
			createdAt: AT,
		},
		null,
		'\t',
	)

writeFileSync(
	join(alice, '.sober/nodes/auth-api-k7f2.json'),
	node('The auth API', 'Sign in, sign out, and the session middleware.', ['src/auth/**']),
)
writeFileSync(
	join(alice, '.sober/nodes/billing-ui-p3x9.json'),
	node('The billing screen', 'Shows the plan and the next invoice.', ['src/billing/**']),
)

// The code branch carries the gitignore, the attributes and config.jsonc — the
// board itself does not travel here, it travels on its own branch.
run(alice, 'add', '-A')
run(alice, 'commit', '-q', '-m', 'chore: sober')
run(alice, 'push', '-q', '-u', 'origin', 'main')

execFileSync('git', ['clone', '-q', remote, bob])
identify(bob, 'Bob')

console.log(`
${bold('One remote, two people, on this machine:')}

  ${dim('remote')}  ${remote}
  ${dim('alice ')}  ${alice}   ${dim('a board with two nodes, never pushed')}
  ${dim('bob   ')}  ${bob}   ${dim('a clone with no board')}

  alias sober='node ${SOBER}'

${bold('1. Alice sends her board')}

  cd ${alice}
  sober sync                     ${dim('two nodes go out on sober-graph')}
  git log --oneline sober-graph  ${dim('the board’s own history — no code in it')}
  git status                     ${dim('your branch and your files are untouched')}

${bold('2. Bob joins')}

  cd ${bob}
  ls .sober                      ${dim('config.jsonc only — the board is on a branch')}
  sober init                     ${dim('it takes the team’s board instead of making one')}
  sober status                   ${dim('Alice’s two nodes')}

${bold('3. They both work, on different nodes')}

  ${dim('Bob adds a node:')}
  cp .sober/nodes/auth-api-k7f2.json .sober/nodes/search-api-m4q8.json
  sober sync

  ${dim('Alice adds one too, and syncs second:')}
  cd ${alice}
  cp .sober/nodes/auth-api-k7f2.json .sober/nodes/emails-r2v6.json
  sober sync                     ${dim('Bob’s node comes in, hers goes out, nothing is asked')}
  sober status                   ${dim('four nodes')}

${bold('4. They both edit the same node')}

  ${dim('Bob:')}      cd ${bob} && sober sync
              sed -i '' 's/"The auth API"/"Auth"/' .sober/nodes/auth-api-k7f2.json && sober sync
  ${dim('Alice:')}    cd ${alice}
              sed -i '' 's/"The auth API"/"Sign-in"/' .sober/nodes/auth-api-k7f2.json
              sober sync         ${dim('named, and nothing is touched — that question is S2')}

${bold('Also worth trying:')}

  sober sync --no-push           ${dim('take theirs, hold yours back')}
  cat .gitattributes             ${dim('why no conflict marker ever lands in a record')}
  git ls-tree -r sober-graph --name-only         ${dim('what the board branch carries, and what it does not')}
  git show sober-graph:.sober/nodes/auth-api-k7f2.json   ${dim('readable by hand, when the tool is broken')}
`)
