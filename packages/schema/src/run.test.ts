import { expect, test } from 'vitest'
import { Run } from './run.js'

const run = {
	node: 'auth-api-k7f2',
	host: 'claude-code',
	branch: 'sober/auth-api-k7f2',
	worktree: '/tmp/sober/auth-api-k7f2',
	startedAt: '2026-08-27T10:00:00Z',
	endedAt: null,
	exit: null,
	error: null,
	verify: null,
	acceptance: [],
}

test('parses a run still in flight', () => {
	expect(Run.parse(run)).toEqual(run)
})

test('a criterion that did not run is null, never a passing exit code', () => {
	const parsed = Run.parse({ ...run, verify: { exit: 0 }, acceptance: [{ exit: 0 }, null] })

	expect(parsed.acceptance[1]).toBeNull()
	expect(parsed.acceptance[0]).toEqual({ exit: 0 })
})

test('results are parallel to the criteria, so a result carries no criterion of its own', () => {
	const acceptance = [{ exit: 0, run: 'pnpm test' }]

	expect(Run.safeParse({ ...run, acceptance }).success).toBe(false)
})

test('exit names one of the three ways a run ends', () => {
	for (const exit of ['finished', 'stopped', 'failed']) {
		expect(Run.safeParse({ ...run, exit }).success, exit).toBe(true)
	}
	expect(Run.safeParse({ ...run, exit: 'done' }).success).toBe(false)
})

test('the agent output is not in the record', () => {
	expect(Run.safeParse({ ...run, log: 'npm warn …' }).success).toBe(false)
})
