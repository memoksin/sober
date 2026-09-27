import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
	acceptWave,
	addWorktree,
	applySetting,
	finishRun,
	initBoard,
	loadBoard,
	startRun,
	writeBrief,
	writeNode,
} from '@besober/core'
import { afterEach, expect, test } from 'vitest'
import { createTempRepo, type TempRepo } from './fixture.js'

let repo: TempRepo | undefined
afterEach(() => {
	repo?.cleanup()
	repo = undefined
})

const fixture = async (
	verify = "node -e \"require('fs').appendFileSync('wave-count','x')\"",
	conflict = false,
) => {
	repo = createTempRepo()
	writeFileSync(join(repo.dir, 'README.md'), 'base\n')
	repo.git('add', '-A')
	repo.git('commit', '-m', 'chore: base')
	const { paths } = await initBoard(repo.dir, { title: 'Wave', intent: 'ship', constraints: [] })
	await applySetting(paths, ['dispatch', 'waveVerify'], verify)
	repo.git('add', '-A')
	repo.git('commit', '-m', 'chore: board')
	const worktrees: string[] = []
	for (const id of ['one-k7f2', 'two-k7f2']) {
		await writeNode(paths, id, {
			title: id,
			name: id,
			description: '',
			notes: '',
			dependsOn: [],
			decisions: [],
			files: ['src/**'],
			brief: null,
			outcome: null,
			assignee: null,
			claim: null,
			accepted: null,
			dismissal: null,
			createdAt: new Date().toISOString(),
		})
		await writeBrief(paths, id, {
			approach: 'Do it',
			acceptance: [{ run: 'exit 0', proves: 'works' }],
		})
		const { path } = await addWorktree(paths, id, 'main')
		worktrees.push(path)
		mkdirSync(join(path, 'src'), { recursive: true })
		writeFileSync(
			join(path, 'src', conflict ? 'shared.ts' : `${id}.ts`),
			`export const value = '${id}'\n`,
		)
		execFileSync('git', ['add', '-A'], { cwd: path })
		execFileSync('git', ['commit', '-m', `feat: ${id}`], { cwd: path })
		const started = await startRun(paths, id, 'fake')
		await finishRun(paths, started.id, {
			exit: 'finished',
			verify: { exit: 0 },
			acceptance: [{ exit: 0 }],
		})
	}
	return { paths, before: repo.git('rev-parse', 'HEAD'), worktrees }
}

test('two nodes get one combined verification before either is accepted', async () => {
	const { paths } = await fixture()
	const landed = await acceptWave(paths, ['one-k7f2', 'two-k7f2'], { by: 'human', base: 'main' })
	expect(landed).toHaveLength(2)
	expect(readFileSync(join(paths.root, 'wave-count'), 'utf8')).toBe('x')
	const board = await loadBoard(paths)
	expect(board.nodes.get('one-k7f2')?.accepted?.audit).toBe('passed')
	expect(board.nodes.get('two-k7f2')?.accepted?.audit).toBe('passed')
})

test.each(['exit 3', 'wave-no-such-command'])(
	'a failed or unavailable verifier keeps both nodes and restores the base: %s',
	async (verify) => {
		const { paths, before, worktrees } = await fixture(verify)
		await expect(
			acceptWave(paths, ['one-k7f2', 'two-k7f2'], { by: 'human', base: 'main' }),
		).rejects.toThrow('wave verification failed')
		expect(repo?.git('rev-parse', 'HEAD')).toBe(before)
		expect(worktrees.every(existsSync)).toBe(true)
		const board = await loadBoard(paths)
		expect(board.nodes.get('one-k7f2')?.accepted).toBeNull()
		expect(board.nodes.get('two-k7f2')?.accepted).toBeNull()
	},
)

test('a conflict on the second node also takes back the first merge', async () => {
	const { paths, before } = await fixture('exit 0', true)
	await expect(
		acceptWave(paths, ['one-k7f2', 'two-k7f2'], { by: 'human', base: 'main' }),
	).rejects.toThrow('does not merge')
	expect(repo?.git('rev-parse', 'HEAD')).toBe(before)
	expect((await loadBoard(paths)).nodes.get('one-k7f2')?.accepted).toBeNull()
})

test('a verifier that dirties tracked files cannot mark the wave done', async () => {
	const { paths } = await fixture('echo changed >> README.md')
	await expect(
		acceptWave(paths, ['one-k7f2', 'two-k7f2'], { by: 'human', base: 'main' }),
	).rejects.toThrow('manual recovery')
	expect((await loadBoard(paths)).nodes.get('one-k7f2')?.accepted).toBeNull()
	expect((await loadBoard(paths)).nodes.get('two-k7f2')?.accepted).toBeNull()
})

test('a fifth node and duplicate nodes are refused before merging', async () => {
	const { paths, before } = await fixture()
	for (const nodes of [
		['one-k7f2', 'one-k7f2'],
		['one-k7f2', 'two-k7f2', 'three', 'four', 'five'],
	])
		await expect(acceptWave(paths, nodes, { by: 'human', base: 'main' })).rejects.toThrow(
			'one to four distinct',
		)
	expect(repo?.git('rev-parse', 'HEAD')).toBe(before)
})

test('focused verify alone cannot be mistaken for the full wave gate', async () => {
	const { paths } = await fixture()
	await applySetting(paths, ['dispatch', 'waveVerify'], null)
	await applySetting(paths, ['dispatch', 'verify'], 'exit 0')
	repo?.git('add', '-A')
	repo?.git('commit', '-m', 'chore: focused checks only')
	const before = repo?.git('rev-parse', 'HEAD')
	await expect(
		acceptWave(paths, ['one-k7f2', 'two-k7f2'], { by: 'human', base: 'main' }),
	).rejects.toThrow('configure dispatch.waveVerify')
	expect(repo?.git('rev-parse', 'HEAD')).toBe(before)
})

test('a node branch changed by the verifier is not accepted on its old review', async () => {
	const { paths, before } = await fixture('git update-ref refs/heads/sober/one-k7f2 HEAD')
	await expect(
		acceptWave(paths, ['one-k7f2', 'two-k7f2'], { by: 'human', base: 'main' }),
	).rejects.toThrow('branch or run changed')
	expect(repo?.git('rev-parse', 'HEAD')).toBe(before)
	expect((await loadBoard(paths)).nodes.get('one-k7f2')?.accepted).toBeNull()
})

test('a branch contained in an earlier wave member does not create duplicate rollback entries', async () => {
	const { paths, before, worktrees } = await fixture()
	repo?.git('update-ref', 'refs/heads/sober/two-k7f2', 'refs/heads/sober/one-k7f2')
	execFileSync('git', ['reset', '--hard', 'sober/one-k7f2'], { cwd: worktrees[1] })
	await expect(
		acceptWave(paths, ['one-k7f2', 'two-k7f2'], { by: 'human', base: 'main' }),
	).rejects.toThrow('no new commits after the preceding')
	expect(repo?.git('rev-parse', 'HEAD')).toBe(before)
	expect((await loadBoard(paths)).nodes.get('one-k7f2')?.accepted).toBeNull()
})
