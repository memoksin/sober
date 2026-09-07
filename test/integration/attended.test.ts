import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	answerRun,
	dispatch,
	initBoard,
	type Paths,
	readRunOutput,
	readRuns,
	setSetting,
	tail,
	writeBrief,
	writeNode,
	writeRun,
} from '@besober/core'
import { afterEach, expect, test } from 'vitest'
// From the source, not the barrel: what the host is launched with is `core`'s
// own business, and its published surface is kept to what consumers need
// (ADR 0028). This test is the reviewer of that argument, not a consumer of it.
import { ATTENDED_ARGS, HOST_ARGS, NO_HUMAN } from '../../packages/core/src/host.js'
import { createTempRepo, type TempRepo } from './fixture.js'

/**
 * Attended dispatch (ADR 0046): a run a human is watching and can talk to.
 *
 * The reason this is a second mode rather than a change to the one that exists
 * is the M2 gate's finding 1. Two of five dispatches finished with an empty
 * branch because the agent stopped to ask a permission nobody was there to
 * give, and `NO_HUMAN` is the sentence that fixed it. It has to keep being true
 * for every run nobody is watching, which is nearly all of them.
 */
const FAKE_HOST = `${process.execPath} ${fileURLToPath(new URL('./fake-host.mjs', import.meta.url))}`

const aNode = (title: string) => ({
	title,
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
	dismissal: null,
	createdAt: '2026-09-04T00:00:00.000Z',
})

let repo: TempRepo | undefined

afterEach(() => {
	repo?.cleanup()
	repo = undefined
})

const aBoard = async (): Promise<{ paths: Paths; node: string }> => {
	const created = createTempRepo()
	repo = created
	writeFileSync(join(created.dir, 'README.md'), '# fixture\n')
	created.git('add', 'README.md')
	created.git('commit', '-m', 'chore: first')

	const { paths } = await initBoard(created.dir, { title: 'Acme', intent: 'ship', constraints: [] })
	writeFileSync(
		paths.config,
		setSetting(readFileSync(paths.config, 'utf8'), ['dispatch', 'host'], FAKE_HOST),
	)

	await writeNode(paths, 'auth-api-k7f2', aNode('Auth API'))
	await writeBrief(paths, 'auth-api-k7f2', {
		approach: 'Add the endpoints, then the middleware.',
		acceptance: [{ run: 'npm test', proves: 'They answer.' }],
	})

	// Settings are read from the base ref, never the branch under review
	// (ADR 0019), so the base has to carry them.
	created.git('add', '.gitignore', '.sober/config.jsonc')
	created.git('commit', '-m', 'chore: sober')
	return { paths, node: 'auth-api-k7f2' }
}

/** Waits for the run record a dispatch writes before its host says anything. */
const runOf = async (paths: Paths, node: string, running?: Promise<unknown>): Promise<string> => {
	// A dispatch that refused says why. Without this the failure is a timeout
	// with the real reason swallowed in an unobserved rejection.
	let refused: unknown
	void running?.catch((error: unknown) => {
		refused = error
	})

	for (let tries = 0; tries < 200; tries++) {
		const { records } = await readRuns(paths)
		const found = [...records].find(([, run]) => run.node === node)
		if (found !== undefined) return found[0]
		if (refused !== undefined) throw refused
		await new Promise((resolve) => setTimeout(resolve, 25))
	}
	throw new Error(`${node} never started a run`)
}

test('a headless dispatch still tells the agent nobody is there to ask', () => {
	// The M2 gate's finding 1, pinned. Attended mode exists so this sentence can
	// stay true for every run that is not being watched, which is nearly all of
	// them — a queue and a wave never set `attended`.
	expect(HOST_ARGS).toContain(NO_HUMAN)
	expect(HOST_ARGS).toContain('bypassPermissions')
	expect(HOST_ARGS).not.toContain('--input-format')
})

test('an attended dispatch says a human is there, and keeps the permission fix', () => {
	expect(ATTENDED_ARGS).not.toContain(NO_HUMAN)
	expect(ATTENDED_ARGS).toContain('--input-format')
	// Answering a *tool permission* prompt is a second protocol and a different
	// feature. What moved is who the agent is told is reading, not whether it
	// has to ask before acting — the M2 gate's fix stands in both modes.
	expect(ATTENDED_ARGS).toContain('bypassPermissions')
})

test('a person watching a run can answer it, and both halves land in the log', async () => {
	const { paths, node } = await aBoard()

	const running = dispatch(paths, node, { base: 'main', attended: true })
	const id = await runOf(paths, node, running)

	await answerRun(paths, node, 'yes, use the second option')
	// `done` closes the session's input, which is what lets an attended run end
	// on its own rather than waiting for the dispatch timeout.
	await answerRun(paths, node, 'that is everything', { done: true })
	await running

	const said = tail(await readRunOutput(paths, id)).map((line) => line.text)

	expect(said).toContain('yes, use the second option')
	expect(said).toContain('you said: yes, use the second option')
	expect(said).toContain('that is everything')
})

test('what the human said is marked as theirs, not as the agent talking', async () => {
	const { paths, node } = await aBoard()

	const running = dispatch(paths, node, { base: 'main', attended: true })
	await runOf(paths, node, running)
	await answerRun(paths, node, 'go ahead', { done: true })
	await running

	const id = await runOf(paths, node)
	const lines = tail(await readRunOutput(paths, id))

	// A transcript where you cannot tell who is speaking is a transcript nobody
	// can audit later.
	expect(lines.find((line) => line.text === 'go ahead')?.kind).toBe('answer')
	expect(lines.find((line) => line.text === 'you said: go ahead')?.kind).toBe('text')
})

test('a run record says whether anyone was watching it', async () => {
	const { paths, node } = await aBoard()

	const running = dispatch(paths, node, { base: 'main', attended: true })
	const id = await runOf(paths, node, running)
	await answerRun(paths, node, 'done', { done: true })
	await running

	const { records } = await readRuns(paths)

	// Not decoration: `answerRun` refuses a headless run, and it needs the
	// record to know which kind it is looking at.
	expect(records.get(id)?.attended).toBe(true)
})

test('answering a node that is not running is refused, and says so', async () => {
	const { paths, node } = await aBoard()

	await expect(answerRun(paths, node, 'anyone there?')).rejects.toThrow(/has not run yet/i)
})

test('a run that has already ended cannot be answered', async () => {
	const { paths, node } = await aBoard()

	const running = dispatch(paths, node, { base: 'main' })
	await runOf(paths, node, running)
	await running

	// Checked before whether it was attended, and in that order on purpose: a
	// finished session cannot be answered whichever way it was started, and that
	// is the more useful thing to be told.
	await expect(answerRun(paths, node, 'hello?')).rejects.toThrow(/is not running/i)
})

test('a headless run in flight cannot be talked to, because nothing is listening', async () => {
	const { paths, node } = await aBoard()

	// A live run record, headless. `stdio: ['ignore', …]` is what a headless
	// dispatch gives the host, so an answer would go nowhere — and accepting the
	// words and dropping them is the failure this refusal exists to prevent.
	await writeRun(paths, 'run-headless-k7f2', {
		node,
		host: 'claude-code',
		branch: `sober/${node}`,
		worktree: '/tmp/whatever',
		startedAt: new Date().toISOString(),
		endedAt: null,
		exit: null,
		error: null,
		verify: null,
		acceptance: [],
		attended: false,
	})

	await expect(answerRun(paths, node, 'hello?')).rejects.toThrow(/nothing is listening/i)
})
