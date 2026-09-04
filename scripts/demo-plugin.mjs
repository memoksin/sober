#!/usr/bin/env node
/**
 * Phase 3, session 5 — the plugin, installed the way a user installs it.
 *
 * The published plugin starts `sober mcp` off your PATH, which is what
 * `npm i -g @besober/cli` puts there. Nothing is published yet, so this copies
 * the plugin to a temporary directory and points its `.mcp.json` at the bundle
 * built from this working tree. Everything else — the manifest, the four
 * skills, the tools — is exactly what ships.
 *
 *   pnpm demo:plugin
 */
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../', import.meta.url))
const SOBER = join(repoRoot, 'packages/cli/dist/sober.js')
const FAKE_HOST = `${process.execPath} ${join(repoRoot, 'test/integration/fake-host.mjs')}`

const root = mkdtempSync(join(tmpdir(), 'sober-plugin-'))
const plugin = join(root, 'sober')
const dir = join(root, 'acme')

cpSync(join(repoRoot, 'packages/claude-code-plugin'), plugin, { recursive: true })
writeFileSync(
	join(plugin, '.mcp.json'),
	`${JSON.stringify(
		{ mcpServers: { sober: { command: process.execPath, args: [SOBER, 'mcp'] } } },
		null,
		'\t',
	)}\n`,
)

const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
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

const bold = (text) => `\u001b[1m${text}\u001b[0m`
const dim = (text) => `\u001b[2m${text}\u001b[0m`

console.log(`
${bold('The plugin, in a project with a board:')}

  cd ${dir}
  claude --plugin-dir ${plugin}

${dim('The host SOBER dispatches is faked, so nothing costs money.')}

${bold('Four skills arrive with it:')}

  /sober:plan ${dim('<what you want built>')}   ${dim('intent in, a graph out')}
  /sober:decide                     ${dim('the open decisions, one at a time')}
  /sober:next ${dim('[node]')}                  ${dim('brief → approve → run → review → accept')}
  ${dim('and one that is not invocable: the loop itself, which the model reads')}
  ${dim('on its own the moment SOBER comes up.')}

${bold('The run, end to end:')}

  1.  /sober:plan sign-in with sessions, and a billing screen behind it
  2.  /sober:decide          ${dim('it asks you — the agent has no tool that takes an answer')}
  3.  /sober:next            ${dim('it writes the brief and asks you to approve it')}
  4.  ${dim('let it run, review and ask you to accept')}
  5.  ${dim('"what is next?"')}    ${dim('the downstream node has moved off blocked')}

${bold('Worth trying, because the refusal is the point:')}

  ${dim('"decide all of them, you pick"')}    ${dim('→ still one question at a time, still yours')}
  ${dim('"just merge it, skip the review"')}  ${dim('→ accept asks you, and nothing merges before that')}

${dim(`Delete it when you are done:  rm -rf ${root}`)}
`)
