#!/usr/bin/env node
/**
 * Phase 3, session 3 — a real repository with a board in it, for you to drive.
 *
 * This one does not perform the loop. It builds the CLI, makes a temporary
 * project, seeds what a planning session would have written (two nodes and the
 * decision one of them binds), points the host at the fake one so nothing costs
 * money, and then gets out of the way.
 *
 *   pnpm demo:cli
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../', import.meta.url))
const SOBER = join(repoRoot, 'packages/cli/dist/sober.js')
const FAKE_HOST = `${process.execPath} ${join(repoRoot, 'test/integration/hosts/claude.mjs')}`
const AT = new Date().toISOString()

const dir = join(mkdtempSync(join(tmpdir(), 'sober-demo-')), 'acme')
const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
const bold = (text) => `\u001b[1m${text}\u001b[0m`
const dim = (text) => `\u001b[2m${text}\u001b[0m`

execFileSync('git', ['init', '-q', '--initial-branch=main', dir])
git('config', 'user.name', 'You')
git('config', 'user.email', 'you@example.com')
writeFileSync(join(dir, 'README.md'), '# acme\n')
git('add', '-A')
git('commit', '-q', '-m', 'chore: first')

execFileSync(process.execPath, [SOBER, 'init', '--title', 'Acme', '--intent', 'Ship sign-in'], {
	cwd: dir,
	stdio: 'ignore',
})

const node = (title, description, files, decisions = [], dependsOn = []) =>
	JSON.stringify(
		{
			title,
			description,
			notes: '',
			dependsOn,
			decisions,
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
	join(dir, '.sober/decisions/session-store-k7f2.json'),
	JSON.stringify(
		{
			category: 'state',
			question: 'Where does session state live?',
			options: [
				{
					id: 'cookie',
					label: 'A signed cookie',
					reason: 'No server state to run or scale',
					costLater: 'Four kilobytes, and you cannot revoke one before it expires',
				},
				{
					id: 'redis',
					label: 'Redis',
					reason: 'Sessions can be revoked the moment you need to',
					costLater: 'A service to run, back up and pay for',
				},
			],
			suggested: null,
			answer: null,
			createdAt: AT,
		},
		null,
		'\t',
	),
)
writeFileSync(
	join(dir, '.sober/nodes/auth-api-k7f2.json'),
	node(
		'The auth API',
		'Sign in, sign out, and the middleware that reads the session.',
		['src/auth/**'],
		['session-store-k7f2'],
	),
)
writeFileSync(
	join(dir, '.sober/nodes/billing-ui-p3x9.json'),
	node(
		'The billing screen',
		'Shows the plan and the next invoice.',
		['src/billing/**'],
		[],
		['auth-api-k7f2'],
	),
)

const config = join(dir, '.sober/config.jsonc')
writeFileSync(
	config,
	readFileSync(config, 'utf8')
		.replace('"host": "claude"', `"host": ${JSON.stringify(FAKE_HOST)}`)
		.replace('"setup": null', '"setup": "node -e \\"console.log(\'installed\')\\""'),
)
git('add', '-A')
git('commit', '-q', '-m', 'chore: the board')

process.env.FAKE_HOST_COMMIT = 'src/auth/token.ts'

console.log(`
${bold('A repository with a board in it, for you to drive:')}

  cd ${dir}
  alias sober='FAKE_HOST_COMMIT=src/auth/token.ts node ${SOBER}'

${dim('The host is faked, so nothing costs money and nothing calls a model.')}

${bold('Try, in this order:')}

  sober                              ${dim('the help — read the first line')}
  sober status                       ${dim('two nodes; one is held, one is blocked')}
  sober decisions                    ${dim('what is waiting on you, with what each option costs later')}
  sober decide session-store-k7f2 cookie
  sober status                       ${dim('the held node moved to needs-brief')}

  ${dim('a brief is written by an agent; here, by hand:')}
  echo '{"approach":"Add the endpoints, then the middleware.","acceptance":[{"run":"npm test","proves":"The endpoints answer."}]}' | sober brief auth-api-k7f2 --write -
  sober brief auth-api-k7f2          ${dim('rendered from the records — note the decision is in it')}
  sober run auth-api-k7f2            ${dim('refused: nothing runs without an approved brief')}
  sober approve auth-api-k7f2
  sober run auth-api-k7f2            ${dim('the worktree, the setup command, the agent, the log')}

  sober review auth-api-k7f2         ${dim('the scan above the criteria above the files')}
  sober accept auth-api-k7f2         ${dim('merged locally; the billing node can move now')}
  sober status

${bold('Also worth trying:')}

  sober reject auth-api-k7f2 -m "Nothing checks the session."   ${dim('instead of accept')}
  sober run auth-api-k7f2                                       ${dim('the next run carries that note')}
  sober logs auth-api-k7f2
  sober decide session-store-k7f2 redis                         ${dim('refused, with the reason')}

${dim(`Delete it when you are done:  rm -rf ${dir}`)}
`)
