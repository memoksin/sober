#!/usr/bin/env node
// changesets runs the publish command on every push to main that leaves nothing
// pending, on the assumption that publishing a version twice is a no-op. `npm
// stage publish` does not hold that assumption — it refuses a version already on
// the registry — so the check that makes it one lives here (ADR 0053).
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync('packages/cli/package.json', 'utf8'))
const spec = `${pkg.name}@${pkg.version}`

let onRegistry = true
try {
	execFileSync('npm', ['view', spec, 'version'], { stdio: 'pipe' })
} catch {
	onRegistry = false
}

const run = (command, args) => execFileSync(command, args, { stdio: 'inherit' })

if (onRegistry) {
	console.log(`${spec} is on the registry already — nothing to stage.`)
} else {
	run('npm', ['stage', 'publish', './packages/cli', '--access', 'public'])
	console.log(`${spec} is staged. Approve it with 2FA: npm stage list ${pkg.name}`)
}

// Tagging runs either way. `changeset tag` skips a tag that exists, and a
// version published before this script did has none yet.
run('pnpm', ['exec', 'changeset', 'tag'])
run('git', ['push', '--tags'])
