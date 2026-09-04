#!/usr/bin/env node
/**
 * A `gh` that behaves like `gh` and touches no network. It keeps its pull
 * requests in the JSON file named by `FAKE_GH_STATE`, so a test can see exactly
 * what SOBER asked the git host to do, and in what order.
 *
 * Everything between SOBER and the host stays real (ADR 0014): the branch is a
 * real branch, pushed to a real bare remote. Only the host's own API is faked,
 * because a test may not open a pull request on somebody's account.
 *
 * Knobs, all through the environment:
 *   FAKE_GH_STATE   where the pull requests and the call log live
 *   FAKE_GH_CHECKS  pass | fail | pending | none   (default: none)
 *   FAKE_GH_FAIL    set to make every call fail, as an expired login does
 */
import { readFileSync, writeFileSync } from 'node:fs'

const file = process.env.FAKE_GH_STATE
const args = process.argv.slice(2)

const load = () => {
	try {
		return JSON.parse(readFileSync(file, 'utf8'))
	} catch {
		return { prs: {}, calls: [] }
	}
}

const state = load()
state.calls.push(args)
const save = () => writeFileSync(file, `${JSON.stringify(state, null, '\t')}\n`)

const die = (message, code = 1) => {
	save()
	process.stderr.write(`${message}\n`)
	process.exit(code)
}

if (process.env.FAKE_GH_FAIL)
	die('gh: To get started with GitHub CLI, please run: gh auth login', 4)

if (args[0] === '--version') {
	save()
	process.stdout.write('gh version 2.98.0 (2026-08-20)\n')
	process.exit(0)
}

if (args[0] !== 'pr') die(`unknown command: ${args.join(' ')}`)

const flag = (name) => {
	const at = args.indexOf(`--${name}`)
	return at === -1 ? null : args[at + 1]
}

const branch = args[2]?.startsWith('--') ? null : args[2]

switch (args[1]) {
	case 'create': {
		const head = flag('head')
		const number = Object.keys(state.prs).length + 1
		state.prs[head] = {
			number,
			url: `https://github.com/acme/acme/pull/${number}`,
			isDraft: args.includes('--draft'),
			state: 'OPEN',
			title: flag('title') ?? '',
			body: flag('body') ?? '',
			headRefName: head,
			baseRefName: flag('base') ?? 'main',
		}
		save()
		process.stdout.write(`${state.prs[head].url}\n`)
		break
	}
	case 'view': {
		const pr = state.prs[branch]
		if (pr === undefined) die(`no pull requests found for branch "${branch}"`)
		save()
		process.stdout.write(`${JSON.stringify(pr)}\n`)
		break
	}
	case 'ready': {
		const pr = state.prs[branch]
		if (pr === undefined) die(`no pull requests found for branch "${branch}"`)
		pr.isDraft = false
		save()
		process.stdout.write(`✓ Pull request #${pr.number} is marked as "ready for review"\n`)
		break
	}
	case 'merge': {
		const pr = state.prs[branch]
		if (pr === undefined) die(`no pull requests found for branch "${branch}"`)
		if (pr.isDraft) die(`Pull request #${pr.number} is not mergeable: it is a draft`)
		pr.state = 'MERGED'
		save()
		process.stdout.write(`✓ Merged pull request #${pr.number}\n`)
		break
	}
	case 'checks': {
		const pr = state.prs[branch]
		if (pr === undefined) die(`no pull requests found for branch "${branch}"`)
		const which = process.env.FAKE_GH_CHECKS ?? 'none'
		if (which === 'garbage') {
			// A host that answered with something that is not JSON. Reading it as
			// "no checks" would be reading a broken answer as a passing one.
			save()
			process.stdout.write('Something went wrong\n')
			process.exit(0)
		}
		// gh's own exit codes: 8 while anything is pending, 1 when one failed.
		const table = {
			none: { checks: [], code: 0 },
			pass: { checks: [{ name: 'build', state: 'SUCCESS', bucket: 'pass' }], code: 0 },
			pending: { checks: [{ name: 'build', state: 'PENDING', bucket: 'pending' }], code: 8 },
			fail: {
				checks: [
					{ name: 'build', state: 'SUCCESS', bucket: 'pass' },
					{ name: 'test', state: 'FAILURE', bucket: 'fail' },
				],
				code: 1,
			},
		}
		const picked = table[which] ?? table.none
		save()
		if (picked.checks.length === 0) {
			process.stderr.write(`no checks reported on the '${branch}' branch\n`)
			process.exit(0)
		}
		process.stdout.write(`${JSON.stringify(picked.checks)}\n`)
		process.exit(picked.code)
		break
	}
	default:
		die(`unknown command: ${args.join(' ')}`)
}
