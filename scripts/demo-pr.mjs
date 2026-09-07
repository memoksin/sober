#!/usr/bin/env node
/**
 * Phase 4, session 4 — the pull request, for you to drive.
 *
 * A real repository with a real bare remote, and a `gh` that answers without a
 * network. It is a stand-in, not a mock of SOBER: the branch is a real branch,
 * really pushed, and every call SOBER makes to the git host is written down in
 * `gh-calls.txt` for you to read.
 *
 * The one thing this cannot prove is `gh` itself. That takes a real repository,
 * and it is the next thing to try.
 *
 *   pnpm demo:pr
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../', import.meta.url))
const SOBER = join(repoRoot, 'packages/cli/dist/sober.js')
const FAKE_GH = join(repoRoot, 'test/integration/fake-gh.mjs')
const FAKE_HOST = join(repoRoot, 'test/integration/hosts/claude.mjs')
const AT = new Date().toISOString()

const bold = (text) => `[1m${text}[0m`
const dim = (text) => `[2m${text}[0m`

const root = mkdtempSync(join(tmpdir(), 'sober-demo-'))
const remote = join(root, 'acme.git')
const work = join(root, 'acme')
const state = join(root, 'gh.json')

const run = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const sober = (cwd, ...args) =>
	execFileSync(process.execPath, [SOBER, ...args], { cwd, stdio: 'ignore' })

execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main', remote])
execFileSync('git', ['init', '-q', '--initial-branch=main', work])
run(work, 'config', 'user.name', 'Alice')
run(work, 'config', 'user.email', 'alice@example.com')
run(work, 'config', 'commit.gpgsign', 'false')
run(work, 'remote', 'add', 'origin', remote)
mkdirSync(join(work, 'src/auth'), { recursive: true })
writeFileSync(join(work, 'README.md'), '# acme\n')
writeFileSync(join(work, 'src/auth/session.ts'), 'export const signIn = () => {}\n')
run(work, 'add', '-A')
run(work, 'commit', '-q', '-m', 'chore: first')
run(work, 'push', '-q', '-u', 'origin', 'main')

sober(work, 'init', '--title', 'Acme', '--intent', 'Ship sign-in')

const node = (fields) => ({
	title: 'A node',
	description: '',
	notes: '',
	dependsOn: [],
	decisions: [],
	files: ['src/auth/**'],
	brief: {
		approach: 'Write the endpoints, then the middleware.',
		acceptance: [{ run: 'true', proves: 'it signs in' }],
		approval: { by: 'Alice', at: AT, queue: false },
	},
	outcome: null,
	assignee: null,
	claim: null,
	accepted: null,
	createdAt: AT,
	...fields,
})

for (const [id, title, files] of [
	['auth-api-k7f2', 'The auth API', ['src/auth/**']],
	['session-ui-m3q8', 'The session panel', ['src/ui/**']],
]) {
	writeFileSync(
		join(work, '.sober/nodes', `${id}.json`),
		`${JSON.stringify(node({ title, files }), null, '\t')}\n`,
	)
}

// The host is faked because it costs money and answers differently every time;
// `gh` is faked because a demo may not open a pull request on your account.
// Everything between them is real.
const config = join(work, '.sober/config.jsonc')
writeFileSync(
	config,
	readFileSync(config, 'utf8').replace(
		'"host": "claude"',
		`"host": ${JSON.stringify(`${process.execPath} ${FAKE_HOST}`)}`,
	),
)
run(work, 'add', '-A')
run(work, 'commit', '-q', '-m', 'chore: sober')
run(work, 'push', '-q', 'origin', 'main')
sober(work, 'sync')

console.log(`
${bold('One repository, one remote, and a git host that answers without a network:')}

  cd ${work}
  alias sober='node ${SOBER}'
  export SOBER_GH='${process.execPath} ${FAKE_GH}'
  export FAKE_GH_STATE='${state}'
  ${dim('the fake agent commits its work; give each node its own file, as two')}
  ${dim("real nodes would have — two agents writing one file is §3.4's warning,")}
  ${dim('and here it would be a merge conflict rather than a demonstration.')}

  ${dim('every call SOBER makes to the git host is appended to that file:')}
  alias ghcalls='node -e "for (const c of require(\\"${state}\\").calls) console.log(c.join(\\" \\"))"'

${bold('1. A run opens the draft')}

  FAKE_HOST_COMMIT=src/auth/api.ts sober run auth-api-k7f2
  ${dim('the last line is the draft it opened')}
  ghcalls                        ${dim('--version, then pr create --draft, then pr view')}
  git ls-remote --heads origin   ${dim('the branch is really on the remote — that is what CI runs on')}

${bold('2. One pull request per node, not per attempt')}

  sober reject auth-api-k7f2 -m "the middleware is missing"
  FAKE_HOST_COMMIT=src/auth/middleware.ts sober run auth-api-k7f2
  ghcalls                        ${dim('one `pr create` in the whole file, still')}

${bold('3. CI is read, not guessed')}

  sober review auth-api-k7f2                  ${dim('no checks yet')}
  FAKE_GH_CHECKS=pending sober review auth-api-k7f2
  FAKE_GH_CHECKS=fail    sober review auth-api-k7f2
  FAKE_GH_CHECKS=pass    sober review auth-api-k7f2

  ${dim('and the one that matters — a host that cannot be reached is not a pass:')}
  FAKE_GH_FAIL=1 sober review auth-api-k7f2

${bold('4. Green is every check, together')}

  FAKE_HOST_COMMIT=src/ui/panel.ts sober run session-ui-m3q8
  FAKE_GH_CHECKS=pass sober accept --green    ${dim('both land, in one command')}
  sober status

  ${dim('Then try it red. Run a node again and:')}
  FAKE_GH_CHECKS=fail    sober accept --green ${dim('nothing lands, and it names the check')}
  FAKE_GH_CHECKS=pending sober accept --green ${dim('“CI has not finished”')}
  FAKE_GH_FAIL=1         sober accept --green ${dim('“CI could not be read” — not a pass')}

${bold('5. Without a git host, nothing changes')}

  git remote remove origin
  FAKE_HOST_COMMIT=src/auth/more.ts sober run auth-api-k7f2
  ${dim('“no pull request: this repository has no remote”')}
  sober review auth-api-k7f2     ${dim('same review, minus one line')}
  git remote add origin ${remote}

${bold('Also worth trying:')}

  ${dim('set "accept" to "pull-request" in .sober/config.jsonc, then')}
  sober accept auth-api-k7f2                  ${dim('pr ready, then pr merge — read ghcalls')}
  ${dim('and with no draft open, the same command refuses and says which setting')}

${bold('What this cannot prove:')}

  ${dim('gh itself. The fake answers the way gh documents; only a real repository')}
  ${dim('proves the real one. Ask me and I will run it against a throwaway repo.')}
`)
