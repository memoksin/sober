import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
	acceptNode,
	addWorktree,
	finishRun,
	initBoard,
	listWorktrees,
	loadBoard,
	mergeNode,
	recordOutcome,
	removeWorktree,
	renderBrief,
	startRun,
	statusOf,
	writeDecision,
	writeNode,
} from '@besober/core'
import { afterEach, expect, test } from 'vitest'
import { createTempRepo, type TempRepo } from './fixture.js'

let repo: TempRepo | undefined

afterEach(() => {
	repo?.cleanup()
	repo = undefined
})

const AT = '2026-09-04T00:00:00.000Z'

const node = (over: Record<string, unknown>) => ({
	title: 'A node',
	description: '',
	notes: '',
	dependsOn: [],
	decisions: [],
	files: [],
	brief: null,
	outcome: null,
	assignee: null,
	claim: null,
	accepted: null,
	dismissal: null,
	createdAt: AT,
	...over,
})

/**
 * Phase 2's gate: the board, the graph, the derived status, the worktree, the
 * run record and the merge, against a real repository. What is missing from
 * BUILD-PLAN's nine-step script is only what phase 3 adds — the CLI, the host
 * that runs an agent, and the scan.
 */
test('a node is briefed, run, accepted, and the node waiting on it becomes ready', async () => {
	const created = createTempRepo()
	repo = created
	writeFileSync(join(created.dir, 'README.md'), '# fixture\n')
	created.git('add', 'README.md')
	created.git('commit', '-m', 'chore: first')

	const { paths } = await initBoard(created.dir, {
		title: 'Acme API',
		intent: 'A billing API two teams can call.',
		constraints: ['No new services'],
	})
	created.git('add', '.gitignore', '.sober/config.jsonc')
	created.git('commit', '-m', 'chore: sober')

	await writeDecision(paths, 'auth-model-k7f2', {
		category: 'state',
		question: 'Where does session state live?',
		options: [
			{ id: 'cookie', label: 'Cookie', reason: 'No server state', costLater: 'Size limits' },
			{ id: 'redis', label: 'Redis', reason: 'Revocable', costLater: 'A service to run' },
		],
		suggested: null,
		answer: { option: 'redis', rationale: 'We already run one.', by: 'memoksin', at: AT },
		createdAt: AT,
	})
	await writeNode(
		paths,
		'auth-api-k7f2',
		node({
			title: 'Session endpoints',
			description: 'Login, logout, and the middleware.',
			decisions: ['auth-model-k7f2'],
			files: ['src/auth/**'],
			brief: {
				approach: 'Endpoints first, then the middleware.',
				acceptance: [{ run: 'node --test', proves: 'Login answers.' }],
				approval: { by: 'memoksin', at: AT, queue: false },
			},
		}),
	)
	await writeNode(
		paths,
		'billing-api-m3q8',
		node({ title: 'Billing', dependsOn: ['auth-api-k7f2'] }),
	)

	// Ready, and the node that depends on it is blocked.
	expect(statusOf(await loadBoard(paths), 'auth-api-k7f2')).toBe('ready')
	expect(statusOf(await loadBoard(paths), 'billing-api-m3q8')).toBe('blocked')

	// The brief carries the answered decision without the node storing it.
	expect(renderBrief(await loadBoard(paths), 'auth-api-k7f2')).toContain('Chosen: Redis')

	// Dispatch: one worktree for the node, and the run in flight.
	const { path } = await addWorktree(paths, 'auth-api-k7f2', 'main')
	const run = await startRun(paths, 'auth-api-k7f2', 'claude-code')
	expect(statusOf(await loadBoard(paths), 'auth-api-k7f2')).toBe('running')

	// The agent's work, committed on the node's branch.
	writeFileSync(join(path, 'session.ts'), 'export const session = true\n')
	execFileSync('git', ['add', 'session.ts'], { cwd: path })
	execFileSync('git', ['commit', '-m', 'feat: session'], { cwd: path })

	await finishRun(paths, run.id, {
		exit: 'finished',
		verify: { exit: 0 },
		acceptance: [{ exit: 0 }],
	})
	expect(statusOf(await loadBoard(paths), 'auth-api-k7f2')).toBe('in-review')

	// Accept: the outcome is recorded, the work merges, the worktree is removed.
	await recordOutcome(paths, 'auth-api-k7f2', 'Added session.ts with the login endpoint.')
	await mergeNode(paths, 'auth-api-k7f2', 'main')
	await acceptNode(paths, 'auth-api-k7f2', {
		by: 'memoksin',
		at: AT,
		flagged: false,
		scan: 'clean',
	})
	await removeWorktree(paths, 'auth-api-k7f2')

	const done = await loadBoard(paths)
	expect(statusOf(done, 'auth-api-k7f2')).toBe('done')
	expect(statusOf(done, 'billing-api-m3q8')).toBe('needs-brief')
	expect(created.git('show', '--stat', 'HEAD')).toContain('session.ts')
	expect(await listWorktrees(paths)).toHaveLength(1)

	// The downstream brief carries what the upstream produced.
	expect(renderBrief(done, 'billing-api-m3q8')).toContain('Added session.ts')
})
