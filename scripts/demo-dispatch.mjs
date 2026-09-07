#!/usr/bin/env node
/**
 * Phase 3, session 1 — dispatch, shown rather than described.
 *
 * There is no CLI yet (that is session 3), so this walks the six things a
 * dispatch can do against a real temporary git repository and a fake host, and
 * prints what a person would see. It is scaffolding for one review: delete it
 * when `sober run` and `sober stop` exist.
 *
 *   pnpm demo:dispatch
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	dispatch,
	initBoard,
	readRuns,
	runLog,
	setSetting,
	stopRun,
	tail,
	writeNode,
} from '@besober/core'

const FAKE_HOST = `${process.execPath} ${fileURLToPath(new URL('../test/integration/hosts/claude.mjs', import.meta.url))}`
const BRIEF = `# The auth API

## How to approach this

Add sign in and sign out over the existing session store.

## What must be true when this is done

- The suite passes
  \`pnpm test\`
`

const scene = (title) =>
	console.log(`\n\n\x1b[1m── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}\x1b[0m\n`)
const note = (text) => console.log(`\x1b[2m${text}\x1b[0m`)
/** The fake host is a node invocation; the reader is here to see SOBER, not the fixture. */
const mask = (text) => text.split(FAKE_HOST).join('claude')

const root = mkdtempSync(join(tmpdir(), 'sober-demo-'))
const dir = join(root, 'acme')

const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()

const board = async (settings = {}) => {
	rmSync(dir, { recursive: true, force: true })
	execFileSync('git', ['init', '--initial-branch=main', dir], { stdio: 'ignore' })
	git('config', 'user.name', 'Demo')
	git('config', 'user.email', 'demo@besober.dev')
	writeFileSync(join(dir, 'README.md'), '# acme\n')
	git('add', 'README.md')
	git('commit', '-m', 'chore: first')

	const { paths } = await initBoard(dir, {
		title: 'Acme',
		intent: 'Ship the thing',
		constraints: [],
	})
	let config = readFileSync(paths.config, 'utf8')
	config = setSetting(config, ['dispatch', 'host'], FAKE_HOST)
	for (const [key, value] of Object.entries(settings))
		config = setSetting(config, ['dispatch', key], value)
	writeFileSync(paths.config, config)

	await writeNode(paths, 'auth-api-k7f2', {
		title: 'The auth API',
		description: 'Sign in and sign out.',
		notes: '',
		dependsOn: [],
		decisions: [],
		files: ['src/auth.ts'],
		brief: null,
		outcome: null,
		assignee: null,
		claim: null,
		accepted: null,
		createdAt: new Date().toISOString(),
	})

	git('add', '.gitignore', '.sober/config.jsonc')
	git('commit', '-m', 'chore: sober')
	return paths
}

const refusal = async (paths) => {
	try {
		await dispatch(paths, 'auth-api-k7f2', { base: 'main', prompt: BRIEF })
		console.log('nothing was refused — that is the bug')
	} catch (error) {
		console.log(`  ${mask(error.message).split('\n').join('\n  ')}`)
		note(`\n  code: ${error.code}`)
		const runs = await readRuns(paths)
		note(`  runs recorded: ${runs.records.size}  ·  the agent never started`)
	}
}

try {
	// ── 1 ────────────────────────────────────────────────────────────────────
	scene('1. What `sober init` writes — every setting, with its reason')
	const paths = await board()
	console.log(mask(readFileSync(paths.config, 'utf8')))
	note('The three settings phase 3 added: dispatch.host, board.branch, scan.extra.')

	// ── 2 ────────────────────────────────────────────────────────────────────
	scene('2. The host is checked before anything starts')
	process.env.FAKE_HOST_LOGGED_OUT = '1'
	await refusal(paths)
	delete process.env.FAKE_HOST_LOGGED_OUT
	note('  A login that expired is one sentence, not a failure three minutes in.')

	// ── 3 ────────────────────────────────────────────────────────────────────
	scene('3. A setup command that fails stops the agent from starting')
	const failing = await board({
		setup: 'node -e "console.error(\'no lockfile here\'); process.exit(1)"',
	})
	await refusal(failing)
	note('  Otherwise you pay for a session that cannot build or test what it writes.')

	// ── 4 ────────────────────────────────────────────────────────────────────
	scene('4. A run that finishes')
	const ok = await board({ setup: 'node -e "console.log(\'installed\')"' })
	console.log('  live, as the host writes it:\n')
	const finished = await dispatch(ok, 'auth-api-k7f2', {
		base: 'main',
		prompt: BRIEF,
		onLine: (line) => {
			const [rendered] = tail(line)
			if (rendered) console.log(`    ${rendered.kind.padEnd(8)} ${rendered.text}`)
		},
	})
	console.log(`\n  run record — .sober/local/runs/${finished.run}.json\n`)
	const record = (await readRuns(ok)).records.get(finished.run)
	console.log(mask(JSON.stringify(record, null, 2)).replace(/^/gm, '    '))
	console.log(
		`\n  branch:   ${execFileSync('git', ['-C', finished.worktree, 'branch', '--show-current'], { encoding: 'utf8' }).trim()}`,
	)
	console.log(`  worktree: ${finished.worktree}`)
	note(`\n  the raw log beside it is the host's own output, unedited:`)
	note(
		`${readFileSync(runLog(ok, finished.run), 'utf8').split('\n').slice(0, 2).join('\n').replace(/^/gm, '    ')}`,
	)

	// ── 5 ────────────────────────────────────────────────────────────────────
	scene('5. A running node, stopped from somewhere else')
	const stopping = await board()
	process.env.FAKE_HOST_HANG = '1'
	const running = dispatch(stopping, 'auth-api-k7f2', { base: 'main', prompt: BRIEF })
	let id
	while (!id) {
		await new Promise((resolve) => setTimeout(resolve, 50))
		;[id] = (await readRuns(stopping)).records.keys()
	}
	note(`  another process asks SOBER to stop ${id}`)
	await stopRun(stopping, id)
	const stopped = await running
	console.log(`\n  exit:      ${stopped.exit}`)
	console.log(
		`  worktree:  ${existsSync(stopped.worktree) ? 'still there, nothing deleted' : 'GONE — that is the bug'}`,
	)
	note('  A stopped run does not enter the review queue: half-finished work in a')
	note('  list called "waiting for review" trains people to ignore the list.')

	// ── 6 ────────────────────────────────────────────────────────────────────
	scene('6. A run that never ends, killed by its own limit')
	const timing = await board({ timeoutMinutes: 1 })
	note('  the limit is one minute; the demo scales it to two seconds so you can watch it')
	const real = setTimeout
	globalThis.setTimeout = (fn, ms) => real(fn, ms >= 60_000 ? 2_000 : ms)
	const killed = await dispatch(timing, 'auth-api-k7f2', { base: 'main', prompt: BRIEF })
	globalThis.setTimeout = real
	delete process.env.FAKE_HOST_HANG
	console.log(`\n  exit:     ${killed.exit}`)
	console.log(`  error:    ${killed.error}`)
	console.log(
		`  worktree: ${existsSync(killed.worktree) ? 'preserved, like any other failure' : 'GONE — that is the bug'}`,
	)

	console.log('\n')
} finally {
	rmSync(root, { recursive: true, force: true })
}
