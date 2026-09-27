import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, test } from 'vitest'
import { createTempRepo, type TempRepo } from './fixture.js'

const script = fileURLToPath(new URL('../../scripts/verify-node.mjs', import.meta.url))
let repo: TempRepo | undefined
afterEach(() => {
	repo?.cleanup()
	repo = undefined
})

const check = (file: string, pr = false): string => {
	repo = createTempRepo()
	writeFileSync(join(repo.dir, 'README.md'), 'base\n')
	repo.git('add', '-A')
	repo.git('commit', '-m', 'chore: base')
	if (!pr) repo.git('branch', 'development')
	repo.git('checkout', '-b', 'node')
	mkdirSync(dirname(join(repo.dir, file)), { recursive: true })
	writeFileSync(join(repo.dir, file), 'changed\n')
	repo.git('add', '-A')
	repo.git('commit', '-m', 'feat: change')
	if (pr) {
		repo.git('checkout', 'main')
		repo.git('merge', '--no-ff', '-m', 'merge node', 'node')
	}
	return execFileSync(process.execPath, [script, '--dry-run'], {
		cwd: repo.dir,
		encoding: 'utf8',
		env: {
			...process.env,
			SOBER_VERIFY_BASE: 'development',
			GITHUB_EVENT_NAME: pr ? 'pull_request' : '',
		},
	})
}

test('a small core change runs its package tests without coverage or the integration suite', () => {
	const output = check('packages/core/src/brief.ts')
	expect(output).toContain('vitest run packages/core')
	expect(output).not.toContain('$ pnpm verify\n')
	expect(output).not.toContain('--coverage')
})

test('docs only get lint', () => {
	const output = check('docs/change.md')
	expect(output).toContain('$ pnpm lint')
	expect(output).not.toContain('typecheck')
	expect(output).not.toContain('vitest')
})

test.each(['pnpm-lock.yaml', 'packages/core/src/index.ts', 'unmapped.txt'])(
	'shared or unknown change %s gets full verification',
	(file) => {
		expect(check(file)).toContain('$ pnpm verify\n')
	},
)

test('a GitHub merge checkout uses its first parent without a local base branch', () => {
	expect(check('test/integration/cli.test.ts', true)).toContain(
		'vitest run test/integration/cli.test.ts',
	)
})
