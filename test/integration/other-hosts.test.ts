import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	checkHost,
	dispatch,
	HostError,
	initBoard,
	type Paths,
	readRuns,
	runLog,
	setSetting,
	tail,
	writeNode,
} from '@besober/core'
import { afterEach, expect, test } from 'vitest'
import { createTempRepo, type TempRepo } from './fixture.js'

/**
 * The second, third and fourth hosts, end to end: a real git repository, a real child
 * process, a real worktree and a real run record, with only the host itself
 * faked (ADR 0014). The fakes answer the shapes recorded off `codex exec
 * --json` and `opencode run --format json`, and the shape Cursor's CLI
 * reference publishes for `agent -p --output-format stream-json` — see
 * `hosts/codex.mjs`, `hosts/opencode.mjs` and `hosts/cursor.mjs`.
 *
 * What this proves is the half of `SCOPE.md`'s SHOULD that is code: a node
 * dispatched to one of these hosts actually runs, commits, and reads back.
 */
const fake = (host: string): string =>
	`${process.execPath} ${fileURLToPath(new URL(`./hosts/${host}.mjs`, import.meta.url))}`

const OTHER_HOSTS = ['codex', 'opencode', 'cursor'] as const

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
	delete process.env.FAKE_HOST_LOGGED_OUT
	delete process.env.FAKE_HOST_WRITE
	delete process.env.FAKE_HOST_COMMIT
	delete process.env.FAKE_HOST_FAIL
})

const board = async (host: string): Promise<Paths> => {
	const created = createTempRepo()
	repo = created
	writeFileSync(join(created.dir, 'README.md'), '# fixture\n')
	created.git('add', 'README.md')
	created.git('commit', '-m', 'chore: first')

	const { paths } = await initBoard(created.dir, { title: 'Acme', intent: 'ship', constraints: [] })
	let config = readFileSync(paths.config, 'utf8')
	config = setSetting(config, ['dispatch', 'host'], fake(host))
	config = setSetting(config, ['dispatch', 'draftPr'], false)
	writeFileSync(paths.config, config)

	await writeNode(paths, 'auth-api-k7f2', aNode('The auth API'))
	created.git('add', '.gitignore', '.sober/config.jsonc')
	created.git('commit', '-m', 'chore: sober')
	return paths
}

for (const host of OTHER_HOSTS) {
	test(`a node dispatched to ${host} runs in its worktree and records how it exited`, async () => {
		const paths = await board(host)
		const written = join(paths.root, 'seen-by-the-agent.txt')
		process.env.FAKE_HOST_WRITE = written

		const result = await dispatch(paths, 'auth-api-k7f2', {
			base: 'main',
			prompt: '# The auth API\n\nSign in and sign out.',
		})

		expect(result).toMatchObject({ exit: 'finished', error: null, prepared: true })
		const record = [...(await readRuns(paths)).records.values()][0]
		expect(record).toMatchObject({ node: 'auth-api-k7f2', exit: 'finished', error: null })

		// The brief reached the host, and the sentence that stops a headless run
		// asking for permission reached it too — this host has no flag for a
		// system prompt, so it goes in front of the brief.
		const seen = readFileSync(written, 'utf8')
		expect(seen).toContain('Sign in and sign out.')
		expect(seen).toContain('no question you ask can be answered')
	})

	test(`a ${host} run reads back as a run, not as raw JSON`, async () => {
		const paths = await board(host)
		const result = await dispatch(paths, 'auth-api-k7f2', { base: 'main', prompt: 'do the thing' })

		const rendered = tail(readFileSync(runLog(paths, result.run), 'utf8'))
		expect(rendered.some((line) => line.kind === 'tool')).toBe(true)
		expect(rendered.some((line) => line.kind === 'text')).toBe(true)
		// Nothing renders as `raw` unless the host itself said something in
		// prose, which is the shape of an unparsed event leaking to the reader.
		for (const line of rendered)
			if (line.kind === 'raw') expect(line.text.startsWith('{')).toBe(false)
		// And nothing renders as `answer`: nobody was watching this run, so a
		// line in the half of the transcript ADR 0046 keeps for the human is a
		// sentence nobody said. Cursor echoes the brief back and is the reason
		// this assertion exists.
		expect(rendered.some((line) => line.kind === 'answer')).toBe(false)
	})

	test(`a logged-out ${host} is caught before a worktree exists`, async () => {
		process.env.FAKE_HOST_LOGGED_OUT = '1'
		expect(await checkHost(fake(host))).toMatchObject({
			ok: false,
			reason: expect.stringContaining('not logged in'),
		})
	})

	test(`${host} cannot be attended, and says so instead of pretending`, async () => {
		// ADR 0046's conversation needs a host that reads stdin while it runs.
		// Neither of these does — they take one message and exit — so an
		// attended run here would be a monologue with somebody watching it.
		const paths = await board(host)
		await expect(
			dispatch(paths, 'auth-api-k7f2', { base: 'main', prompt: 'do it', attended: true }),
		).rejects.toThrow(HostError)
		// Refused before the worktree, so there is no half-started run to explain.
		expect((await readRuns(paths)).records.size).toBe(0)
	})
}
