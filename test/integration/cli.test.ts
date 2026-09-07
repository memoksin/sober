import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, expect, test } from 'vitest'
import { createTempRepo, type TempRepo } from './fixture.js'

/**
 * The nine-step script of BUILD-PLAN §3, minus the four steps that happen in a
 * host session (those are the MCP server's). It runs the **built binary**, not
 * the source: the CLI is the contract test for the other surfaces
 * (`PR-09-08`), and a contract test that imports the implementation proves
 * less than one that runs what a user installs.
 */
const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const SOBER = join(repoRoot, 'packages/cli/dist/sober.js')
const FAKE_HOST = `${process.execPath} ${join(repoRoot, 'test/integration/hosts/claude.mjs')}`

beforeAll(() => {
	execFileSync(process.execPath, ['build.mjs'], { cwd: join(repoRoot, 'packages/cli') })
}, 180_000)

let repo: TempRepo | undefined

afterEach(() => {
	repo?.cleanup()
	repo = undefined
	delete process.env.FAKE_HOST_WRITE
	delete process.env.FAKE_HOST_COMMIT
})

/** No colour and no TTY here, so what a test reads is what a pipe would get. */
const sober = (cwd: string, ...args: string[]): string =>
	execFileSync(process.execPath, [SOBER, ...args], {
		cwd,
		encoding: 'utf8',
		env: { ...process.env, NO_COLOR: '1' },
	})

const failed = (cwd: string, ...args: string[]): string => {
	try {
		sober(cwd, ...args)
		throw new Error(`sober ${args.join(' ')} was expected to refuse`)
	} catch (error) {
		const failure = error as { stderr?: string; stdout?: string; status?: number }
		expect(failure.status).toBe(1)
		return `${failure.stdout ?? ''}${failure.stderr ?? ''}`
	}
}

const project = (): TempRepo => {
	const created = createTempRepo()
	repo = created
	writeFileSync(join(created.dir, 'README.md'), '# acme\n')
	writeFileSync(join(created.dir, 'package-lock.json'), '{}\n')
	created.git('add', '-A')
	created.git('commit', '-m', 'chore: first')
	return created
}

/** What a session writes through the MCP server in M1; here, written directly. */
const seed = (dir: string) => {
	const at = '2026-09-04T00:00:00.000Z'
	writeFileSync(
		join(dir, '.sober/decisions/session-store-k7f2.json'),
		JSON.stringify({
			category: 'state',
			question: 'Where does session state live?',
			options: [
				{ id: 'cookie', label: 'A cookie', reason: 'No server state', costLater: 'Size limits' },
				{ id: 'redis', label: 'Redis', reason: 'Revocable', costLater: 'A service to run' },
			],
			suggested: null,
			answer: null,
			createdAt: at,
		}),
	)
	writeFileSync(
		join(dir, '.sober/nodes/auth-api-k7f2.json'),
		JSON.stringify({
			title: 'The auth API',
			description: 'Sign in and sign out.',
			notes: '',
			dependsOn: [],
			decisions: ['session-store-k7f2'],
			files: ['src/auth/**'],
			brief: null,
			outcome: null,
			assignee: null,
			claim: null,
			accepted: null,
			dismissal: null,
			createdAt: at,
		}),
	)
}

const useFakeHost = (dir: string) => {
	const file = join(dir, '.sober/config.jsonc')
	// The detected `npm ci` is real and would install for real; the loop under
	// test is not npm's.
	writeFileSync(
		file,
		readFileSync(file, 'utf8')
			.replace('"host": "claude"', `"host": ${JSON.stringify(FAKE_HOST)}`)
			.replace('"setup": "npm ci"', '"setup": null'),
	)
	execFileSync('git', ['add', '-A'], { cwd: dir })
	execFileSync('git', ['commit', '-m', 'chore: the host'], { cwd: dir })
}

const BRIEF = JSON.stringify({
	approach: 'Add the endpoints, then the middleware.',
	acceptance: [{ run: 'npm test', proves: 'The endpoints answer.' }],
})

test('init writes the board, the branch, and a setup command it detected', () => {
	const created = project()
	const output = sober(created.dir, 'init')

	expect(output).toContain('the board is ready')
	// PR-00-06: a lockfile says what the install command is, and init writes it in.
	expect(output).toContain('npm ci')
	expect(readFileSync(join(created.dir, '.sober/config.jsonc'), 'utf8')).toContain('"npm ci"')
	expect(readFileSync(join(created.dir, '.gitignore'), 'utf8')).toContain('.sober/*')
	expect(created.git('branch', '--list', 'sober-graph')).toContain('sober-graph')

	// Idempotent: a second init reports the board it found and changes nothing.
	expect(sober(created.dir, 'init')).toContain('already a board')
})

test('`sober` and `sober --help` print the same usable overview', () => {
	const created = project()
	const bare = sober(created.dir)

	expect(bare).toBe(sober(created.dir, '--help'))
	expect(bare.split('\n')[0]).toBe('SOBER plans work as a graph, then dispatches agents.')
	// PR-00-03: grouped by purpose, in the order of the loop.
	expect(bare).toContain('Start here')
	expect(bare).toContain('Review')
})

test('a command outside a board says how to make one, rather than crashing', () => {
	const created = project()
	expect(failed(created.dir, 'status')).toContain('sober init')
})

test('the loop closes: decide, brief, approve, run, review, accept', () => {
	const created = project()
	sober(created.dir, 'init')
	seed(created.dir)
	useFakeHost(created.dir)

	// Held by its decision, and the board says what it is waiting for.
	expect(sober(created.dir, 'status')).toContain('held')
	expect(sober(created.dir, 'status')).toContain('waiting on session-store-k7f2')

	// A decision offers its options with the reason and what each costs later.
	expect(sober(created.dir, 'decisions')).toContain('No server state')
	expect(failed(created.dir, 'decide', 'session-store-k7f2', 'postgres')).toContain('cookie, redis')
	expect(sober(created.dir, 'decide', 'session-store-k7f2', 'cookie')).toContain(
		'no longer waiting on it',
	)
	// Answering is once. Changing an answer is a different command, because it
	// withdraws every brief built on the answer it replaces (§2.8).
	expect(failed(created.dir, 'decide', 'session-store-k7f2', 'redis')).toContain(
		'goes through the impact preview',
	)

	// Nothing runs without an approved brief (PR-05-01, D26).
	expect(sober(created.dir, 'status')).toContain('needs-brief')
	expect(failed(created.dir, 'run', 'auth-api-k7f2')).toContain('needs-brief')

	const briefFile = join(dirname(created.dir), 'brief.json')
	writeFileSync(briefFile, BRIEF)
	sober(created.dir, 'brief', 'auth-api-k7f2', '--write', briefFile)
	const rendered = sober(created.dir, 'brief', 'auth-api-k7f2')
	// The brief renders from the records, so it cannot omit an answered decision.
	expect(rendered).toContain('A cookie')
	expect(rendered).toContain('Not approved')

	sober(created.dir, 'approve', 'auth-api-k7f2')
	expect(sober(created.dir, 'status')).toContain('ready')

	// Outside the repository: a dirty working tree is what `accept` refuses to
	// merge into. What the agent commits goes in the worktree, as a real one does.
	const saw = join(dirname(created.dir), 'agent-saw.txt')
	process.env.FAKE_HOST_WRITE = saw
	process.env.FAKE_HOST_COMMIT = 'src/auth/token.ts'
	const run = sober(created.dir, 'run', 'auth-api-k7f2')
	expect(run).toContain('finished')
	// The agent was handed the brief, not a file path to go and read.
	expect(readFileSync(saw, 'utf8')).toContain('Add the endpoints, then the middleware.')
	expect(sober(created.dir, 'logs', 'auth-api-k7f2')).toContain('wrote the file')
	expect(sober(created.dir, 'status')).toContain('in-review')

	const review = sober(created.dir, 'review', 'auth-api-k7f2')
	expect(review).toContain('The endpoints answer.')
	expect(review).toContain('rules: the bundled preset')

	sober(created.dir, 'accept', 'auth-api-k7f2')
	expect(sober(created.dir, 'status')).toContain('done')
	// Accepted work is on the base branch, and the node's branch is gone.
	expect(created.git('log', '--oneline', '-1')).toContain('sober: auth-api-k7f2')
	expect(created.git('branch', '--list', 'sober/auth-api-k7f2')).toBe('')
})

/**
 * DESIGN §2.8 on the surface with no dialog: the edit is one command that
 * refuses with the fan-out, and a second carrying `--anyway` applies it — the
 * vocabulary ADR 0032 gave `run`, against a different fan-out.
 */
test('changing an answer prints what it reaches, and the second command applies it', () => {
	const created = project()
	sober(created.dir, 'init')
	seed(created.dir)
	useFakeHost(created.dir)
	sober(created.dir, 'decide', 'session-store-k7f2', 'cookie')
	const briefFile = join(dirname(created.dir), 'brief.json')
	writeFileSync(briefFile, BRIEF)
	sober(created.dir, 'brief', 'auth-api-k7f2', '--write', briefFile)
	sober(created.dir, 'approve', 'auth-api-k7f2')
	expect(sober(created.dir, 'status')).toContain('ready')

	// Nothing was cut and nothing was written: the first command is the preview.
	const refused = failed(created.dir, 'edit', 'session-store-k7f2', 'redis')
	expect(refused).toContain('auth-api-k7f2')
	expect(refused).toContain('loses its brief')
	expect(refused).toContain('--anyway')
	expect(sober(created.dir, 'status')).toContain('ready')

	// The confirmation. §2.8's first row: the brief goes, and the node is briefed
	// again against the answer that now stands.
	expect(sober(created.dir, 'edit', 'session-store-k7f2', 'redis', '--anyway')).toContain(
		'need briefs again',
	)
	expect(sober(created.dir, 'status')).toContain('needs-brief')
	expect(sober(created.dir, 'brief', 'auth-api-k7f2')).toContain('Redis')
})

test('rejecting returns the node to the queue and carries the note into the next run', () => {
	const created = project()
	sober(created.dir, 'init')
	seed(created.dir)
	useFakeHost(created.dir)
	sober(created.dir, 'decide', 'session-store-k7f2', 'cookie')
	const briefFile = join(dirname(created.dir), 'brief.json')
	writeFileSync(briefFile, BRIEF)
	sober(created.dir, 'brief', 'auth-api-k7f2', '--write', briefFile)
	sober(created.dir, 'approve', 'auth-api-k7f2')
	sober(created.dir, 'run', 'auth-api-k7f2')

	const rejected = sober(
		created.dir,
		'reject',
		'auth-api-k7f2',
		'-m',
		'Nothing checks the session.',
	)
	expect(rejected).toContain('Nothing was deleted')
	expect(sober(created.dir, 'status')).toContain('ready')

	// Outside the repository: a dirty working tree is what `accept` refuses to
	// merge into. What the agent commits goes in the worktree, as a real one does.
	const saw = join(dirname(created.dir), 'agent-saw.txt')
	process.env.FAKE_HOST_WRITE = saw
	process.env.FAKE_HOST_COMMIT = 'src/auth/token.ts'
	sober(created.dir, 'run', 'auth-api-k7f2')
	const seen = readFileSync(saw, 'utf8')
	expect(seen).toContain('Nothing checks the session.')
	expect(seen.indexOf('Nothing checks the session.')).toBeLessThan(
		seen.indexOf('Add the endpoints'),
	)
})

/**
 * The hook's whole contract with a host is one JSON object in and one out, so
 * that is what these assert — on a real board, through the built binary. What
 * they do not assert is that the host obeys the object: that is the host's own
 * code, and nothing in this repository can reach it (ADR 0047).
 */
const hook = (cwd: string, event: string, payload: unknown): Record<string, unknown> =>
	JSON.parse(
		execFileSync(process.execPath, [SOBER, 'hook', event], {
			cwd,
			input: JSON.stringify(payload),
			encoding: 'utf8',
			env: { ...process.env, NO_COLOR: '1' },
		}),
	) as Record<string, unknown>

const spawn = (prompt: string) => ({
	hook_event_name: 'PreToolUse',
	tool_name: 'Task',
	tool_input: { description: 'build it', prompt, subagent_type: 'general-purpose' },
})

const verdict = (out: Record<string, unknown>) =>
	(out.hookSpecificOutput as Record<string, unknown> | undefined) ?? {}

test('a spawn aimed at a held node is denied, and the denial says how to answer it', () => {
	const created = project()
	sober(created.dir, 'init')
	seed(created.dir)

	const out = hook(created.dir, 'spawn', spawn('Write the endpoints for auth-api-k7f2.'))

	expect(verdict(out).permissionDecision).toBe('deny')
	const reason = String(verdict(out).permissionDecisionReason)
	// Which node, which decision, and what the decision actually asks.
	expect(reason).toContain('auth-api-k7f2')
	expect(reason).toContain('session-store-k7f2')
	expect(reason).toContain('Where does session state live?')
	// The one way through is answering it — on either surface.
	expect(reason).toContain('/sober-decide')
	expect(reason).toContain('sober decide session-store-k7f2')
})

test('the guard lets through everything the board does not hold', () => {
	const created = project()
	sober(created.dir, 'init')
	seed(created.dir)

	// Names no node at all.
	expect(verdict(hook(created.dir, 'spawn', spawn('Rename a variable.')))).toEqual({})
	// Names a node the board has never heard of.
	expect(verdict(hook(created.dir, 'spawn', spawn('Do billing-api-0000.')))).toEqual({})
	// A held id with something stuck to it is not the held id.
	expect(verdict(hook(created.dir, 'spawn', spawn('Do auth-api-k7f2x.')))).toEqual({})

	// Answering the decision is what lifts the hold, here as everywhere else.
	sober(created.dir, 'decide', 'session-store-k7f2', 'cookie')
	expect(verdict(hook(created.dir, 'spawn', spawn('Write auth-api-k7f2.')))).toEqual({})
})

test('a board the guard cannot read is not silently a pass', () => {
	const created = project()
	sober(created.dir, 'init')
	seed(created.dir)
	writeFileSync(join(created.dir, '.sober/nodes/auth-api-k7f2.json'), 'not json')

	const out = hook(created.dir, 'spawn', spawn('Write the endpoints for auth-api-k7f2.'))

	// The node fell off the board, so nothing is held and nothing is denied —
	// which is exactly the case that must say so rather than read as clean.
	expect(verdict(out)).toEqual({})
	expect(String(out.systemMessage)).toContain('auth-api-k7f2.json')
	expect(String(out.systemMessage)).toContain('did not run')
})

test('outside a board the guard says nothing at all', () => {
	const created = project()
	expect(hook(created.dir, 'spawn', spawn('Write auth-api-k7f2.'))).toEqual({})
})

test('a session is told at the start whether the guard is live', () => {
	const created = project()
	sober(created.dir, 'init')
	seed(created.dir)

	const out = hook(created.dir, 'session', { hook_event_name: 'SessionStart', source: 'startup' })
	const context = String(verdict(out).additionalContext)

	// A guard that is not there is silent, so the one that is there says so.
	expect(context).toContain('hook enforcement is live')
	expect(context).toContain('auth-api-k7f2')
})

test('a node heading for a claimed node’s files is refused, and the second command is the confirmation', () => {
	const created = project()
	sober(created.dir, 'init')
	seed(created.dir)
	useFakeHost(created.dir)
	sober(created.dir, 'decide', 'session-store-k7f2', 'cookie')
	const briefFile = join(dirname(created.dir), 'brief.json')
	writeFileSync(briefFile, BRIEF)
	sober(created.dir, 'brief', 'auth-api-k7f2', '--write', briefFile)
	sober(created.dir, 'approve', 'auth-api-k7f2')

	// A second node someone is already on, heading for one of the same files.
	writeFileSync(
		join(created.dir, '.sober/nodes/session-ui-m3q8.json'),
		JSON.stringify({
			title: 'The session panel',
			description: '',
			notes: '',
			dependsOn: [],
			decisions: [],
			files: ['src/auth/session.ts'],
			brief: null,
			outcome: null,
			assignee: null,
			claim: { by: 'Bob', at: '2026-09-05T00:00:00.000Z' },
			accepted: null,
			dismissal: null,
			createdAt: '2026-09-05T00:00:00.000Z',
		}),
	)

	const refused = failed(created.dir, 'run', 'auth-api-k7f2')
	expect(refused).toContain('session-ui-m3q8')
	expect(refused).toContain('Bob')
	expect(refused).toContain('--anyway')
	// Nothing was cut: the refusal happens before the worktree.
	expect(created.git('branch', '--list', 'sober/auth-api-k7f2')).toBe('')

	expect(sober(created.dir, 'run', 'auth-api-k7f2', '--anyway')).toContain('finished')
})

test('accepting starts what was approved and queued behind it', () => {
	const created = project()
	sober(created.dir, 'init')
	seed(created.dir)
	useFakeHost(created.dir)
	sober(created.dir, 'decide', 'session-store-k7f2', 'cookie')

	// A downstream node, approved ahead of time, with its own files.
	writeFileSync(
		join(created.dir, '.sober/nodes/session-ui-m3q8.json'),
		JSON.stringify({
			title: 'The session panel',
			description: '',
			notes: '',
			dependsOn: ['auth-api-k7f2'],
			decisions: [],
			files: ['src/ui/**'],
			brief: null,
			outcome: null,
			assignee: null,
			claim: null,
			accepted: null,
			dismissal: null,
			createdAt: '2026-09-05T00:00:00.000Z',
		}),
	)
	const briefFile = join(dirname(created.dir), 'brief.json')
	writeFileSync(briefFile, BRIEF)
	for (const node of ['auth-api-k7f2', 'session-ui-m3q8'])
		sober(created.dir, 'brief', node, '--write', briefFile)
	sober(created.dir, 'approve', 'auth-api-k7f2')
	sober(created.dir, 'approve', 'session-ui-m3q8', '--queue')

	process.env.FAKE_HOST_COMMIT = 'src/auth/token.ts'
	sober(created.dir, 'run', 'auth-api-k7f2')

	const accepted = sober(created.dir, 'accept', 'auth-api-k7f2')
	expect(accepted).toContain('auth-api-k7f2 is done')
	expect(accepted).toContain('1 queued node starting')
	expect(accepted).toContain('session-ui-m3q8 finished')
})

test('a review of a node already accepted says so, and offers no second accept', () => {
	const created = project()
	sober(created.dir, 'init')
	seed(created.dir)
	useFakeHost(created.dir)
	sober(created.dir, 'decide', 'session-store-k7f2', 'cookie')
	const briefFile = join(dirname(created.dir), 'brief.json')
	writeFileSync(briefFile, BRIEF)
	sober(created.dir, 'brief', 'auth-api-k7f2', '--write', briefFile)
	sober(created.dir, 'approve', 'auth-api-k7f2')
	process.env.FAKE_HOST_COMMIT = 'src/auth/token.ts'
	sober(created.dir, 'run', 'auth-api-k7f2')
	sober(created.dir, 'accept', 'auth-api-k7f2')

	const read = sober(created.dir, 'review', 'auth-api-k7f2')
	expect(read).toContain('done')
	expect(read).not.toContain('sober accept auth-api-k7f2   ·')
	// The branch went with the accept: no diff, and never "the diff is 1 lines".
	expect(read).not.toContain('the diff is')
})

test('a clone that has no board yet is told which command takes the team’s', () => {
	const created = project()
	sober(created.dir, 'init')
	seed(created.dir)
	created.git('add', '-A')
	created.git('commit', '-m', 'chore: sober')
	created.git('push', '-q', '-u', 'origin', 'main')
	sober(created.dir, 'sync')

	const bob = join(dirname(created.dir), 'bob')
	execFileSync('git', ['clone', '-q', created.remote, bob])

	const said = failed(bob, 'status')
	expect(said).toContain('sober init')
	expect(said).toContain('sober-graph')
	expect(said).not.toContain('run `sober init` at the root of your repository')
})

test('a prefix names a node, and an ambiguous one lists what it could have meant', () => {
	const created = project()
	sober(created.dir, 'init')
	seed(created.dir)
	sober(created.dir, 'decide', 'session-store-k7f2', 'cookie')

	// M2 gate finding 7: nobody types `auth-api-k7f2` from memory.
	expect(sober(created.dir, 'status', 'auth-api')).toContain('auth-api-k7f2')
	expect(failed(created.dir, 'run', 'auth-api')).toContain('needs-brief')

	// A second node sharing the prefix turns the guess back into a question.
	writeFileSync(
		join(created.dir, '.sober/nodes/auth-api-m3q8.json'),
		readFileSync(join(created.dir, '.sober/nodes/auth-api-k7f2.json'), 'utf8'),
	)
	const said = failed(created.dir, 'run', 'auth-api')
	expect(said).toContain('auth-api-k7f2')
	expect(said).toContain('auth-api-m3q8')
	expect(said).toContain('names only one')
})

test('a node that is done cannot be approved a second time', () => {
	const created = project()
	sober(created.dir, 'init')
	seed(created.dir)
	useFakeHost(created.dir)
	sober(created.dir, 'decide', 'session-store-k7f2', 'cookie')
	const briefFile = join(dirname(created.dir), 'brief.json')
	writeFileSync(briefFile, BRIEF)
	sober(created.dir, 'brief', 'auth-api-k7f2', '--write', briefFile)

	// Written but not approved is its own wait now, not "needs-brief" again.
	expect(sober(created.dir, 'status')).toContain('needs-approval')

	sober(created.dir, 'approve', 'auth-api-k7f2')
	process.env.FAKE_HOST_COMMIT = 'src/auth/token.ts'
	sober(created.dir, 'run', 'auth-api-k7f2')
	sober(created.dir, 'accept', 'auth-api-k7f2')

	// M2 gate finding 3 and 4: this used to succeed and then tell you to run it.
	const said = failed(created.dir, 'approve', 'auth-api-k7f2')
	expect(said).toContain('is done')
	expect(said).not.toContain('Start it with')
})
