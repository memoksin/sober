#!/usr/bin/env node
// Fast feedback for a node. The combined tree still gets `pnpm verify` once
// before a wave is accepted.
import { spawnSync } from 'node:child_process'

const run = (command, args) => {
	console.log(`$ ${[command, ...args].join(' ')}`)
	if (process.argv.includes('--dry-run')) return
	// All pnpm arguments below are constants or validated repository paths.
	const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' })
	if (result.error) throw result.error
	if (result.status !== 0) process.exit(result.status ?? 1)
}

const git = (...args) => {
	const result = spawnSync('git', args, { encoding: 'utf8' })
	if (result.status !== 0) throw new Error(result.stderr.trim())
	return result.stdout.trim()
}

const base = process.env.SOBER_VERIFY_BASE ?? process.env.GITHUB_BASE_REF ?? 'development'
const fork =
	process.env.GITHUB_EVENT_NAME === 'pull_request'
		? git('rev-parse', 'HEAD^1')
		: git('merge-base', 'HEAD', base)
const changed = spawnSync('git', ['diff', '--name-only', '-z', fork, 'HEAD'], { encoding: 'utf8' })
if (changed.status !== 0) throw new Error(changed.stderr.trim())
const files = changed.stdout.split('\0').filter(Boolean)
if (files.length === 0) {
	console.log('No committed changes to verify')
	process.exit(0)
}

const packageDirs = new Set()
const integration = []
for (const file of files) {
	if (
		/^(package\.json|pnpm-lock\.yaml|vitest\.config\.ts|turbo\.json|scripts\/|\.github\/|packages\/tsconfig\/)|\/src\/index\.ts$|\/package\.json$|\/vitest\.config\.ts$/.test(
			file,
		)
	) {
		console.log(`${file} affects shared checks; running full verification`)
		run('pnpm', ['verify'])
		process.exit(0)
	}
	const match = file.match(/^(packages\/(?:core|cli|mcp|schema|server)|apps\/dashboard)\//)
	if (match) packageDirs.add(match[1])
	else if (/^test\/integration\/[a-z0-9-]+\.test\.ts$/.test(file)) integration.push(file)
	else if (/^(plugins\/|packages\/(claude-code|codex|cursor|opencode)-plugin\/)/.test(file))
		integration.push('test/integration/plugin.test.ts')
	else if (!/^(docs\/|README\.md$|CLAUDE\.md$|\.agents\/)/.test(file)) {
		console.log(`${file} has no focused check; running full verification`)
		run('pnpm', ['verify'])
		process.exit(0)
	}
}

run('pnpm', ['lint'])
if (packageDirs.size > 0 || integration.length > 0) {
	run('pnpm', ['typecheck'])
	for (const dir of [...packageDirs].sort()) run('pnpm', ['exec', 'vitest', 'run', dir])
	if (integration.length > 0) run('pnpm', ['exec', 'vitest', 'run', ...integration])
}
