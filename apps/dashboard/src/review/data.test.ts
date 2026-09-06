import type { Review } from '@besober/schema'
import { expect, test } from 'vitest'
import { ciLine, verdict } from './data.js'

const AT = '2026-09-06T00:00:00.000Z'

const review = (over: Partial<Review> = {}): Review => ({
	node: 'a',
	scan: { result: 'clean', ruleSet: 'default', findings: [], didNotRun: [], files: ['src/a.ts'] },
	diff: 'diff --git a/src/a.ts b/src/a.ts\n+one\n',
	files: ['src/a.ts'],
	run: 'run-1',
	exit: 'finished',
	acceptance: [{ run: 'pnpm test', proves: 'The endpoints answer.' }],
	ci: { kind: 'none' },
	pr: null,
	uncommitted: [],
	accepted: null,
	...over,
})

test('a clean scan says so, and offers the two answers', () => {
	const said = verdict(review())

	expect(said.tone).toBe('clean')
	expect(said.headline).toContain('clean')
	expect(said.decidable).toBe(true)
})

test('a scan that did not run is never read as a clean one', () => {
	// The whole of PR-09-06 and §6.2: a check that did not answer is not a check
	// that passed. It is the loudest thing on the screen, not a quiet default.
	const said = verdict(review({ scan: { ...review().scan, result: 'did-not-run' } }))

	expect(said.tone).toBe('alarm')
	expect(said.headline).not.toContain('clean')
	// Still answerable: a human may accept work whose scan could not run, and
	// what they accepted is written down as exactly that.
	expect(said.decidable).toBe(true)
})

test('findings are counted, and one is not "1 findings"', () => {
	const one = verdict(
		review({
			scan: {
				...review().scan,
				result: 'findings',
				findings: [{ signal: 'secret', file: 'a.ts', line: 3, message: 'a key' }],
			},
		}),
	)

	expect(one.tone).toBe('warn')
	expect(one.headline).toBe('1 finding')
})

test('work that never ran is not a review, and offers no answer', () => {
	const said = verdict(review({ run: null, exit: null, diff: '', files: [] }))

	expect(said.decidable).toBe(false)
	expect(said.headline).toContain('has not run')
})

test('accepted work is a record, and offers no second accept', () => {
	const said = verdict(
		review({ accepted: { by: 'memoksin', at: AT, flagged: false, scan: 'clean' } }),
	)

	expect(said.decidable).toBe(false)
	expect(said.tone).toBe('done')
})

test('uncommitted work is said out loud — a diff cannot see it', () => {
	// The M1 gate found this: an agent that wrote everything and committed
	// nothing reviewed exactly like an agent that did nothing.
	const said = verdict(review({ diff: '', uncommitted: ['src/a.ts', 'src/b.ts'] }))

	expect(said.warnings.join(' ')).toContain('never committed')
})

test('a scanner that could not run is a warning of its own, not a log line', () => {
	const said = verdict(review({ scan: { ...review().scan, didNotRun: ['semgrep'] } }))

	expect(said.warnings.join(' ')).toContain('semgrep')
})

test('CI that could not be read is never a pass', () => {
	expect(ciLine({ kind: 'unavailable', reason: 'the host timed out' })).toEqual({
		tone: 'alarm',
		text: 'CI could not be read — the host timed out',
	})
	expect(ciLine({ kind: 'passing' })?.tone).toBe('clean')
	expect(ciLine({ kind: 'pending' })?.tone).toBe('warn')
	expect(ciLine({ kind: 'failing', failed: ['build', 'test'] })).toEqual({
		tone: 'alarm',
		text: 'CI failed — build, test',
	})
	expect(ciLine({ kind: 'none' })).toBeNull()
})
