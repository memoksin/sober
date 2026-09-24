import { expect, test, vi } from 'vitest'
import type { Paths } from './paths.js'

// `posixShell` and `readConfigFromBase`/`readNode` are mocked so the
// shell-not-found branch of `extraScanners` (scan.ts) is reachable without a
// real Git for Windows install or a real board on disk — the same seam the
// integration suite cannot take on Linux CI, where `posixShell()` is always
// `true`.
vi.mock('./audit.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./audit.js')>()
	return { ...actual, posixShell: () => null }
})
vi.mock('./config.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./config.js')>()
	return {
		...actual,
		readConfigFromBase: async () => ({
			kind: 'ok' as const,
			value: { ...actual.DEFAULT_CONFIG, scan: { extra: ['sober-would-never-run'] } },
		}),
	}
})
vi.mock('./records.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./records.js')>()
	return {
		...actual,
		readNode: async () => ({ kind: 'ok' as const, value: { files: [] } }),
	}
})

const { scanNode } = await import('./scan.js')

test('an extra scanner does not run when no POSIX shell was found', async () => {
	const paths = { root: '/tmp/sober-scan-shell-test' } as Paths
	const report = await scanNode(paths, 'some-node', { base: 'main', diff: '' })
	expect(report.didNotRun).toEqual(['no POSIX shell found: install Git for Windows'])
	expect(report.result).toBe('did-not-run')
})
