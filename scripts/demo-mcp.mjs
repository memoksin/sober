#!/usr/bin/env node
/**
 * Phase 3, session 4 — SOBER's tools, in your own session.
 *
 * This builds the CLI, makes a temporary project with a board in it, points
 * the host at the fake one so nothing costs money, and prints the one command
 * that adds the server to Claude Code. Then you drive it by talking.
 *
 *   pnpm demo:mcp
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../', import.meta.url))
const SOBER = join(repoRoot, 'packages/cli/dist/sober.js')
const FAKE_HOST = `${process.execPath} ${join(repoRoot, 'test/integration/fake-host.mjs')}`

const dir = join(mkdtempSync(join(tmpdir(), 'sober-mcp-')), 'acme')
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

const config = join(dir, '.sober/config.jsonc')
writeFileSync(
	config,
	readFileSync(config, 'utf8')
		.replace('"host": "claude"', `"host": ${JSON.stringify(FAKE_HOST)}`)
		.replace('"setup": null', '"setup": "node -e \\"console.log(\'installed\')\\""'),
)
git('add', '-A')
git('commit', '-q', '-m', 'chore: the board')

console.log(`
${bold('An empty board, and the tools to fill it — from your own session:')}

  cd ${dir}
  claude mcp add sober -- node ${SOBER} mcp
  claude

${dim('The host SOBER dispatches is faked, so nothing costs money.')}
${dim('Everything else — the records, git, the worktrees, the scan — is real.')}

${bold('Then say, in that session:')}

  1.  ${dim('"read the sober board"')}
      ${dim('empty, and it says so')}

  2.  ${dim('"we are building sign-in. Propose the nodes, the edges between them,')}
      ${dim(' and the decisions they bind — then show me the board."')}
      ${dim('one propose call writes the whole graph; every bound node is held')}

  3.  ${dim('"put the first decision to me"')}
      ${bold('SOBER asks you directly')} ${dim('— the agent cannot pick, and cannot pick for you')}

  4.  ${dim('"write the brief for the auth node, then ask me to approve it"')}
      ${dim('you see the approach and the acceptance list, and you say yes or no')}

  5.  ${dim('"run it"')} ${dim('· then')} ${dim('"review it"')} ${dim('· then')} ${dim('"ask me to accept it"')}
      ${dim('the scan first, the criteria next, the diff only when asked')}

${bold('Worth trying, because the refusal is the point:')}

  ${dim('"answer the second decision for me, pick whichever is best"')}
  ${dim('→ it still asks you. There is no tool that takes an answer.')}

  ${dim('"approve every brief"')}
  ${dim('→ one node per call, one question per node.')}

  ${dim('Compare with the same board on the command line:')}  node ${SOBER} status

${dim(`Delete it when you are done:  rm -rf ${dir}  ·  claude mcp remove sober`)}
`)
