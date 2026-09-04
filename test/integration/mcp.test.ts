import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { addWorktree, initBoard, loadBoard, setSetting, statusOf } from '@besober/core'
import { createServer } from '@besober/mcp'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, expect, test } from 'vitest'
import { createTempRepo, type TempRepo } from './fixture.js'

/**
 * The third surface, driven the way a host drives it: a real client over a
 * real transport, with a human on the other end of every elicitation. The
 * tools call the same `core` functions the CLI calls, so what this proves is
 * `PR-09-08` — a session can close the loop without the CLI.
 */
let repo: TempRepo | undefined

afterEach(() => {
	repo?.cleanup()
	repo = undefined
})

/** What the human does when asked. `null` is a human who walks away. */
type Human = (message: string, choices: string[]) => string | null

const connect = async (dir: string, human: Human = (_, choices) => choices[0] ?? null) => {
	const client = new Client(
		{ name: 'test-host', version: '0.0.0' },
		{ capabilities: { elicitation: {} } },
	)
	client.setRequestHandler(ElicitRequestSchema, (request) => {
		const params = request.params as {
			message: string
			requestedSchema?: { properties?: { choice?: { enum?: string[] } } }
		}
		const choice = human(params.message, params.requestedSchema?.properties?.choice?.enum ?? [])
		return choice === null ? { action: 'decline' } : { action: 'accept', content: { choice } }
	})

	const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
	await Promise.all([createServer(dir).connect(serverSide), client.connect(clientSide)])
	return client
}

const said = (result: unknown): string =>
	((result as { content: { text: string }[] }).content ?? []).map((part) => part.text).join('\n')

const call = async (client: Client, name: string, args: Record<string, unknown> = {}) =>
	said(await client.callTool({ name, arguments: args }))

const FAKE_HOST = `${process.execPath} ${fileURLToPath(new URL('./fake-host.mjs', import.meta.url))}`

const board = async () => {
	const created = createTempRepo()
	repo = created
	writeFileSync(join(created.dir, 'README.md'), '# fixture\n')
	created.git('add', '-A')
	created.git('commit', '-m', 'chore: first')
	const { paths } = await initBoard(created.dir, { title: 'Acme', intent: 'ship', constraints: [] })
	// The host is faked and the setup command is a no-op: everything between
	// SOBER and the host stays real (ADR 0014).
	let config = readFileSync(paths.config, 'utf8')
	config = setSetting(config, ['dispatch', 'host'], FAKE_HOST)
	config = setSetting(config, ['dispatch', 'setup'], null)
	writeFileSync(paths.config, config)
	created.git('add', '-A')
	created.git('commit', '-m', 'chore: sober')
	return { repo: created, paths }
}

const PROPOSAL = {
	decisions: [
		{
			key: 'store',
			category: 'state',
			question: 'Where does session state live?',
			options: [
				{ id: 'cookie', label: 'A cookie', reason: 'No server state', costLater: 'Size limits' },
				{ id: 'redis', label: 'Redis', reason: 'Revocable', costLater: 'A service to run' },
			],
		},
	],
	nodes: [
		{ key: 'auth', title: 'The auth API', files: ['src/auth/**'], decisions: ['store'] },
		{ key: 'billing', title: 'The billing screen', dependsOn: ['auth'] },
	],
}

test('every state-changing operation the CLI has, the session has too', async () => {
	const { repo: created } = await board()
	const client = await connect(created.dir)

	const names = (await client.listTools()).tools.map((one) => one.name).sort()
	expect(names).toEqual(
		[
			'accept',
			'approve',
			'archive',
			'board',
			'brief',
			'decide',
			'decisions',
			'init',
			'logs',
			'open_decision',
			'propose',
			'reject',
			'review',
			'run',
			'stop',
			'write_brief',
		].sort(),
	)
})

test('one call writes the graph, its edges and the decision holding it', async () => {
	const { repo: created, paths } = await board()
	const client = await connect(created.dir)

	const written = await call(client, 'propose', PROPOSAL)
	expect(written).toContain('The auth API')

	const loaded = await loadBoard(paths)
	expect(loaded.nodes.size).toBe(2)
	expect(loaded.decisions.size).toBe(1)

	// The keys became ids, and the edges point at them rather than at the keys.
	const auth = [...loaded.nodes].find(([, node]) => node.title === 'The auth API')
	const billing = [...loaded.nodes].find(([, node]) => node.title === 'The billing screen')
	expect(billing?.[1].dependsOn).toEqual([auth?.[0]])
	expect(auth?.[1].decisions).toEqual([...loaded.decisions.keys()])
	expect(statusOf(loaded, auth?.[0] ?? '')).toBe('held')
})

test('a proposal that closes a cycle is refused, and nothing is written', async () => {
	const { repo: created, paths } = await board()
	const client = await connect(created.dir)

	const said = await call(client, 'propose', {
		nodes: [
			{ key: 'a', title: 'A', dependsOn: ['b'] },
			{ key: 'b', title: 'B', dependsOn: ['a'] },
		],
	})
	expect(said).toContain('closes a cycle')
	expect((await loadBoard(paths)).nodes.size).toBe(0)
})

test('the human picks the option; the agent cannot supply one', async () => {
	const { repo: created, paths } = await board()
	const asked: string[] = []
	const client = await connect(created.dir, (message, choices) => {
		asked.push(message)
		return choices[1] ?? null
	})
	await call(client, 'propose', PROPOSAL)

	const [decision] = [...(await loadBoard(paths)).decisions.keys()]
	const answered = await call(client, 'decide', { decision })

	// The question and both options reached the human, not just the ids.
	expect(asked[0]).toContain('Where does session state live?')
	expect(asked[0]).toContain('A service to run')
	expect(answered).toContain('redis')

	const after = await loadBoard(paths)
	expect(after.decisions.get(decision ?? '')?.answer?.option).toBe('redis')
	const auth = [...after.nodes].find(([, node]) => node.title === 'The auth API')
	expect(statusOf(after, auth?.[0] ?? '')).toBe('needs-brief')
})

test('a human who walks away answers nothing', async () => {
	const { repo: created, paths } = await board()
	const client = await connect(created.dir, () => null)
	await call(client, 'propose', PROPOSAL)

	const [decision] = [...(await loadBoard(paths)).decisions.keys()]
	expect(await call(client, 'decide', { decision })).toContain('did not answer')
	expect((await loadBoard(paths)).decisions.get(decision ?? '')?.answer).toBeNull()
})

test('a host that cannot ask cannot accept, and says which surface can', async () => {
	const { repo: created, paths } = await board()
	// A client declaring no elicitation capability at all: the 2025 hosts that
	// have none, and every host with the feature switched off (`PR-03-09`).
	const client = new Client({ name: 'mute-host', version: '0.0.0' }, { capabilities: {} })
	const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
	await Promise.all([createServer(created.dir).connect(serverSide), client.connect(clientSide)])

	await call(client, 'propose', PROPOSAL)
	const [decision] = [...(await loadBoard(paths)).decisions.keys()]
	const refused = await call(client, 'decide', { decision })
	expect(refused).toContain('command line')
	expect((await loadBoard(paths)).decisions.get(decision ?? '')?.answer).toBeNull()
})

test('a brief is written, approved by the human, and nothing runs before that', async () => {
	const { repo: created, paths } = await board()
	const client = await connect(created.dir)
	await call(client, 'propose', PROPOSAL)
	const [decision] = [...(await loadBoard(paths)).decisions.keys()]
	await call(client, 'decide', { decision })
	const node = [...(await loadBoard(paths)).nodes].find(
		([, record]) => record.title === 'The auth API',
	)?.[0] as string

	expect(await call(client, 'run', { nodes: [node] })).toContain('needs-brief')

	await call(client, 'write_brief', {
		node,
		approach: 'Endpoints first, then the middleware.',
		acceptance: [{ run: 'npm test', proves: 'The endpoints answer.' }],
	})
	const brief = await call(client, 'brief', { node })
	expect(brief).toContain('Endpoints first')
	expect(brief).toContain('Not approved')

	await call(client, 'approve', { node })
	expect(await call(client, 'brief', { node })).toContain('Approved by')
	expect(statusOf(await loadBoard(paths), node)).toBe('ready')
})

test('a rewritten approach is not the approved one', async () => {
	const { repo: created, paths } = await board()
	const client = await connect(created.dir)
	await call(client, 'propose', { nodes: [{ key: 'a', title: 'Alone' }] })
	const node = [...(await loadBoard(paths)).nodes.keys()][0] as string

	const write = (approach: string) =>
		call(client, 'write_brief', {
			node,
			approach,
			acceptance: [{ run: 'npm test', proves: 'It answers.' }],
		})
	await write('The first way.')
	await call(client, 'approve', { node })
	await write('Actually, the second way.')

	expect((await loadBoard(paths)).nodes.get(node)?.brief?.approval).toBeNull()
})

test('review reads the scan, the criteria and the files; accept merges what the human accepts', async () => {
	const { repo: created, paths } = await board()
	const client = await connect(created.dir)
	await call(client, 'propose', { nodes: [{ key: 'a', title: 'The auth API', files: ['src/**'] }] })
	const node = [...(await loadBoard(paths)).nodes.keys()][0] as string
	await call(client, 'write_brief', {
		node,
		approach: 'Endpoints first.',
		acceptance: [{ run: 'npm test', proves: 'The endpoints answer.' }],
	})

	// Work, the way a dispatched agent leaves it: in the node's own worktree.
	const { path: worktree } = await addWorktree(paths, node, 'main')
	mkdirSync(dirname(join(worktree, 'src/auth/token.ts')), { recursive: true })
	writeFileSync(join(worktree, 'src/auth/token.ts'), 'export const sign = () => "ok"\n')
	execFileSync('git', ['add', '-A'], { cwd: worktree })
	execFileSync('git', ['commit', '-m', 'feat: work'], { cwd: worktree })

	const review = await call(client, 'review', { node, base: 'main' })
	expect(review).toContain('Scan: clean')
	expect(review).toContain('The endpoints answer.')
	expect(review).toContain('src/auth/token.ts')
	expect(review).not.toContain('+export const sign')
	expect(await call(client, 'review', { node, base: 'main', diff: true })).toContain(
		'+export const sign',
	)

	expect(await call(client, 'accept', { node, base: 'main' })).toContain('is done')
	expect(statusOf(await loadBoard(paths), node)).toBe('done')
})

test('a rejected node keeps its work, and the rejection is what takes it out of review', async () => {
	const { repo: created, paths } = await board()
	const client = await connect(created.dir)
	await call(client, 'propose', { nodes: [{ key: 'a', title: 'The auth API' }] })
	const node = [...(await loadBoard(paths)).nodes.keys()][0] as string

	const said = await call(client, 'reject', { node, feedback: 'Nothing checks the session.' })
	expect(said).toContain('Nothing was deleted')
	expect((await loadBoard(paths)).feedback.get(node)?.text).toBe('Nothing checks the session.')
})

test('an archived node leaves the board and keeps its record', async () => {
	const { repo: created, paths } = await board()
	const client = await connect(created.dir)
	await call(client, 'propose', { nodes: [{ key: 'a', title: 'Alone' }] })
	const node = [...(await loadBoard(paths)).nodes.keys()][0] as string

	expect(await call(client, 'archive', { id: node })).toContain('archived')
	expect((await loadBoard(paths)).nodes.has(node)).toBe(false)
})

test('an archived decision stops being listed as one waiting on the human', async () => {
	const { repo: created, paths } = await board()
	const client = await connect(created.dir)
	await call(client, 'propose', PROPOSAL)
	const [decision] = [...(await loadBoard(paths)).decisions.keys()]

	expect(await call(client, 'archive', { id: decision })).toContain('archived')

	// The record is still there and the node that bound it still reads it
	// (§8.3) — but neither list offers it to answer any more.
	const after = await loadBoard(paths)
	expect(after.decisions.has(decision ?? '')).toBe(true)
	expect(after.archivedDecisions.has(decision ?? '')).toBe(true)
	expect(await call(client, 'decisions')).toContain('Nothing is waiting on you')
	expect(await call(client, 'board')).not.toContain('Decisions waiting')

	// The node it bound is still held, and now says by what: otherwise it waits
	// on something no list offers.
	const shown = await call(client, 'board')
	expect(shown).toContain('[held]')
	expect(shown).toContain(`${decision} (archived)`)
})

test('a tool that cannot do its job answers with a sentence, never a protocol error', async () => {
	const { repo: created } = await board()
	const client = await connect(created.dir)

	const result = await client.callTool({ name: 'brief', arguments: { node: 'nothing-aaaa' } })
	expect(said(result)).toContain('not on this board')
	expect(await call(client, 'logs', { node: 'nothing-aaaa' })).toContain('has not run yet')
})

test('`sober mcp` starts from the published bundle and speaks the protocol', async () => {
	const { repo: created } = await board()
	const client = new Client({ name: 'test-host', version: '0.0.0' }, { capabilities: {} })
	// The bundle is what a host actually starts (ADR 0007), and a bundle that
	// cannot be started is a class of bug the source tests never see.
	const transport = new StdioClientTransport({
		command: process.execPath,
		args: [fileURLToPath(new URL('../../packages/cli/dist/sober.js', import.meta.url)), 'mcp'],
		cwd: created.dir,
	})
	await client.connect(transport)
	try {
		expect((await client.listTools()).tools.length).toBe(16)
		expect(said(await client.callTool({ name: 'board', arguments: {} }))).toContain('No nodes yet')
	} finally {
		await client.close()
	}
})

test('the board reads back what the session wrote, with what each node waits for', async () => {
	const { repo: created } = await board()
	const client = await connect(created.dir)

	expect(await call(client, 'board')).toContain('No nodes yet')
	expect(await call(client, 'decisions')).toContain('Nothing is waiting on you')

	await call(client, 'propose', PROPOSAL)
	const shown = await call(client, 'board')
	expect(shown).toContain('[held]')
	expect(shown).toContain('[blocked]')
	expect(shown).toMatch(/waiting on \S+/)

	// Every option carries why and what it costs later, on every surface.
	const open = await call(client, 'decisions')
	expect(open).toContain('because: Revocable')
	expect(open).toContain('later:   A service to run')
})

test('a decision with no options is opened before it is put to anyone', async () => {
	const { repo: created, paths } = await board()
	const client = await connect(created.dir)
	await call(client, 'propose', {
		decisions: [{ key: 'd', category: 'data-flow', question: 'How does the form submit?' }],
	})
	const [decision] = [...(await loadBoard(paths)).decisions.keys()]

	expect(await call(client, 'decide', { decision })).toContain('no options yet')
	await call(client, 'open_decision', {
		decision,
		options: [
			{
				id: 'post',
				label: 'A form post',
				reason: 'Works with no script',
				costLater: 'Full reloads',
			},
			{ id: 'fetch', label: 'fetch()', reason: 'No reload', costLater: 'You own the error states' },
		],
		suggested: 'post',
	})
	expect(await call(client, 'decisions')).toContain('Suggested: post')
	expect(await call(client, 'decide', { decision })).toContain('post')
})

test('a run goes through the same dispatch the CLI uses, and the log reads back', async () => {
	const { repo: created, paths } = await board()
	const client = await connect(created.dir)
	await call(client, 'propose', { nodes: [{ key: 'a', title: 'The auth API' }] })
	const node = [...(await loadBoard(paths)).nodes.keys()][0] as string
	await call(client, 'write_brief', {
		node,
		approach: 'Endpoints first.',
		acceptance: [{ run: 'npm test', proves: 'The endpoints answer.' }],
	})
	await call(client, 'approve', { node })

	expect(await call(client, 'stop', { node })).toContain('Nothing is running')
	expect(await call(client, 'run', { nodes: [node], base: 'main' })).toContain('finished')
	expect(await call(client, 'logs', { node })).toContain('result')
	expect(statusOf(await loadBoard(paths), node)).toBe('in-review')
})

test('a repository with no board says so, and `init` makes one', async () => {
	const created = createTempRepo()
	repo = created
	writeFileSync(join(created.dir, 'README.md'), '# fixture\n')
	created.git('add', '-A')
	created.git('commit', '-m', 'chore: first')

	const client = await connect(created.dir)
	expect(await call(client, 'board')).toContain('no board')

	expect(await call(client, 'init', { title: 'Acme', intent: 'Ship sign-in' })).toContain(
		'The board is ready',
	)
	expect(await call(client, 'board')).toContain('Acme')
	expect(await call(client, 'init', {})).toContain('already a board')
})
