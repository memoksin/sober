#!/usr/bin/env node
/**
 * Phase 4, session 2 — the merge with a human in it, for you to drive.
 *
 * One bare remote, two clones, and four merges already set up so that each one
 * shows a different thing: one that asks nothing, one that asks about a field,
 * one that asks about three, one that asks whether a record stays archived, and
 * one that merges cleanly into a board that does not hold together.
 *
 * Nothing is faked: real git, a real remote, the built CLI.
 *
 *   pnpm demo:conflict
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

const node = (fields) =>
	`${JSON.stringify(
		{
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
		},
		null,
		'\t',
	)}\n`

const write = (dir, id, fields) =>
	writeFileSync(join(dir, '.sober/nodes', `${id}.json`), node(fields))

execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main', remote])
execFileSync('git', ['init', '-q', '--initial-branch=main', alice])
identify(alice, 'Alice')
run(alice, 'remote', 'add', 'origin', remote)
writeFileSync(join(alice, 'README.md'), '# acme\n')
run(alice, 'add', '-A')
run(alice, 'commit', '-q', '-m', 'chore: first')
sober(alice, 'init', '--title', 'Acme', '--intent', 'Ship sign-in')

// Five records, one per thing the merge has to be able to do.
write(alice, 'quiet-node-k7f2', { title: 'Two people, two fields' })
write(alice, 'one-field-p3x9', { title: 'The old title' })
write(alice, 'three-fields-m4q8', { title: 'Old', notes: 'old notes', files: ['old/**'] })
write(alice, 'archived-node-r2v6', { title: 'On its way out' })
write(alice, 'doomed-node-z9k1', { title: 'About to be deleted' })

run(alice, 'add', '-A')
run(alice, 'commit', '-q', '-m', 'chore: sober')
run(alice, 'push', '-q', '-u', 'origin', 'main')
sober(alice, 'sync')

execFileSync('git', ['clone', '-q', remote, bob])
identify(bob, 'Bob')
sober(bob, 'init')

// Bob moves first, and pushes. Everything below is what Alice will walk into.
write(bob, 'quiet-node-k7f2', { title: 'Two people, two fields', notes: 'Bob wrote this' })
write(bob, 'one-field-p3x9', { title: 'Bob’s title' })
write(bob, 'three-fields-m4q8', {
	title: 'Bob’s',
	notes: 'Bob’s notes',
	files: ['bob/**'],
	description: 'only Bob touched this one',
})
sober(bob, 'archive', 'archived-node-r2v6')
rmSync(join(bob, '.sober/nodes/doomed-node-z9k1.json'))
sober(bob, 'sync')

// Alice's side, unsynced.
write(alice, 'quiet-node-k7f2', { title: 'Two people, two fields', files: ['alice/**'] })
write(alice, 'one-field-p3x9', { title: 'Alice’s title' })
write(alice, 'three-fields-m4q8', { title: 'Alice’s', notes: 'Alice’s notes', files: ['alice/**'] })
write(alice, 'archived-node-r2v6', { title: 'On its way out', notes: 'still working on it' })
write(alice, 'needs-doomed-w8n3', {
	title: 'Depends on the deleted one',
	dependsOn: ['doomed-node-z9k1'],
})

console.log(`
${bold('One remote, two people, and a merge waiting for you:')}

  ${dim('alice')}  ${alice}
  ${dim('bob  ')}  ${bob}

  cd ${alice}
  alias sober='node ${SOBER}'

${bold('1. What the merge asks — and what it does not')}

  sober sync                     ${dim('three records; the other two were merged silently')}
  sober resolve                  ${dim('every question, with both versions')}

  ${dim('Note what is NOT in that list:')}
  ${dim('quiet-node-k7f2 — Bob wrote notes, you wrote files. Nothing to ask.')}
  ${dim('three-fields-m4q8 — description moved on Bob’s side only, so it is merged,')}
  ${dim('and only the three fields you both changed are questions.')}

${bold('2. One field')}

  sober resolve one-field-p3x9
  sober resolve one-field-p3x9 title=theirs
  sober resolve                  ${dim('two left — the merge lands on the last one')}

${bold('3. Three fields at once')}

  sober resolve three-fields-m4q8
  sober resolve three-fields-m4q8 title=ours notes=theirs files=ours

${bold('4. Archived on one side, edited on the other')}

  sober resolve archived-node-r2v6      ${dim('a different question: keep, or restore')}
  sober resolve archived-node-r2v6 restore
  ${dim('that was the last one, so the merge lands here')}

  cat .sober/nodes/quiet-node-k7f2.json  ${dim('both edits survived, and nobody was asked')}
  cat .sober/nodes/three-fields-m4q8.json

${bold('5. A clean merge that broke the board')}

  ${dim('Bob deleted doomed-node-z9k1; you added a node that depends on it. Two')}
  ${dim('different files, so git merged them without a word.')}

  ${dim('the merge you just landed already reported it — read the last lines again,')}
  ${dim('or:')}
  sober sync                     ${dim('refuses to push, and names what is wrong')}
  sober status

  ${dim('Fix it and the board goes out:')}
  sober archive needs-doomed-w8n3
  sober sync

${bold('Also worth trying:')}

  sober resolve one-field-p3x9 title=maybe    ${dim('refused, with the shape it wanted')}
  sober resolve no-such-node                  ${dim('refused, and says where the list is')}
  git log --oneline --graph sober-graph       ${dim('one merge commit, both parents')}

${bold('In a session, instead of the terminal:')}

  ${dim('claude mcp add sober -- node')} ${dim(SOBER)} ${dim('mcp')}
  ${dim('then ask it to sync. The same questions arrive as one form per record,')}
  ${dim('one enum per conflicted field, and the choice is yours, not the agent’s.')}
`)
