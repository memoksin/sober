import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	acceptNode,
	addWorktree,
	adoptBoard,
	flagsOf,
	initBoard,
	loadBoard,
	type Paths,
	publish,
	paths as resolve,
	setSetting,
	statusOf,
	sync,
	writeNode,
	writeRun,
} from '@besober/core'
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
type Human = (message: string, choices: string[], labels: string[]) => string | null

const connect = async (dir: string, human: Human = (_, choices) => choices[0] ?? null) => {
	const client = new Client(
		{ name: 'test-host', version: '0.0.0' },
		{ capabilities: { elicitation: {} } },
	)
	client.setRequestHandler(ElicitRequestSchema, (request) => {
		const params = request.params as {
			message: string
			requestedSchema?: {
				properties?: {
					choice?: { enum?: string[]; enumNames?: string[] }
					confirmed?: { type: 'boolean' }
				}
			}
		}
		const properties = params.requestedSchema?.properties as
			| {
					choice?: { enum?: string[]; enumNames?: string[] }
					confirmed?: { type: 'boolean' }
			  }
			| undefined
		// A confirmation is a boolean field, a choice is an enum one: the host
		// renders the first without an expand step, and every approval is one.
		if (properties?.confirmed !== undefined) {
			const said = human(params.message, ['yes', 'no'], ['yes', 'no'])
			return said === null
				? { action: 'decline' }
				: { action: 'accept', content: { confirmed: said === 'yes' } }
		}
		const field = properties?.choice
		if (field !== undefined) {
			const choice = human(params.message, field.enum ?? [], field.enumNames ?? [])
			return choice === null ? { action: 'decline' } : { action: 'accept', content: { choice } }
		}

		// A merge asks about one record at a time, and a record is several
		// fields: one form, one enum per field (ADR 0013).
		const form = (params.requestedSchema?.properties ?? {}) as Record<
			string,
			{ enum?: string[]; enumNames?: string[] }
		>
		const content: Record<string, string> = {}
		for (const [name, one] of Object.entries(form)) {
			const said = human(`${params.message} ${name}`, one.enum ?? [], one.enumNames ?? [])
			if (said === null) return { action: 'decline' }
			content[name] = said
		}
		return { action: 'accept', content }
	})

	const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
	await Promise.all([createServer(dir).connect(serverSide), client.connect(clientSide)])
	return client
}

const said = (result: unknown): string =>
	((result as { content: { text: string }[] }).content ?? []).map((part) => part.text).join('\n')

const call = async (client: Client, name: string, args: Record<string, unknown> = {}) =>
	said(await client.callTool({ name, arguments: args }))

const FAKE_HOST = `${process.execPath} ${fileURLToPath(new URL('./hosts/claude.mjs', import.meta.url))}`

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
			'answer',
			'approve',
			'archive',
			'assign',
			'bind',
			'board',
			'brief',
			'claim',
			'contributors',
			'decide',
			'decisions',
			'dismiss',
			'edit_decision',
			'init',
			'logs',
			'open_decision',
			'open_node',
			'propose',
			'reject',
			'reopen',
			'review',
			'run',
			'stop',
			'sync',
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
	const asked_choices: string[][] = []
	const client = await connect(created.dir, (message, choices, labels) => {
		asked.push(message)
		asked_choices.push(labels)
		return choices[1] ?? null
	})
	await call(client, 'propose', PROPOSAL)

	const [decision] = [...(await loadBoard(paths)).decisions.keys()]
	const answered = await call(client, 'decide', { decision })

	// The message is the question and nothing else: a host truncates a long one,
	// and a truncated option list is a choice made blind (found in the M1 gate).
	expect(asked[0]).toBe('Where does session state live?')
	// Labels alone: a narrow terminal cuts what it cannot fit, so nothing that
	// has to be read whole is put where it can be cut (found in the M1 gate).
	expect(asked_choices[0]).toEqual(['A cookie', 'Redis'])
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

/**
 * DESIGN §2.8 in a host session. The command line spells the confirmation as a
 * second command; a host that can ask, asks — **once for the whole fan-out**,
 * never once per node (M1 gate, defect 11). One vocabulary, two registers
 * (ADR 0032, ADR 0044).
 */
test('changing an answer asks once, and names every node the change reaches', async () => {
	const { repo: created, paths } = await board()
	let asked: string[] = []
	// A confirmation is offered `yes`/`no`; a choice is offered the option ids.
	const client = await connect(created.dir, (message, choices) => {
		asked = [...asked, message]
		return choices.includes('yes') ? 'yes' : (choices[0] ?? null)
	})
	await call(client, 'propose', PROPOSAL)

	const [decision] = [...(await loadBoard(paths)).decisions.keys()]
	await call(client, 'decide', { decision })
	const [node] = [...(await loadBoard(paths)).nodes.keys()].filter((id) =>
		id.startsWith('the-auth'),
	)
	await call(client, 'write_brief', {
		node,
		approach: 'Write the endpoints.',
		acceptance: [{ run: 'pnpm test', proves: 'They answer.' }],
	})
	await call(client, 'approve', { node })

	asked = []
	const changed = await call(client, 'edit_decision', { decision: decision ?? '', option: 'redis' })

	// One question, and the node it reaches is named in it — a person cannot
	// confirm a fan-out they were not shown.
	expect(asked).toHaveLength(1)
	expect(asked[0]).toContain(node ?? '')
	expect(changed).toContain('redis')
	// §2.8's first row: the brief is withdrawn and nothing was started or stopped.
	expect((await loadBoard(paths)).nodes.get(node ?? '')?.brief).toBeNull()
})

test('the edit refuses before it asks, so a typo never costs a person a question', async () => {
	const { repo: created, paths } = await board()
	let asked = 0
	const client = await connect(created.dir, (_, choices) => {
		asked += 1
		return choices.includes('yes') ? 'yes' : (choices[0] ?? null)
	})
	await call(client, 'propose', PROPOSAL)
	const [decision] = [...(await loadBoard(paths)).decisions.keys()]

	expect(await call(client, 'edit_decision', { decision: 'gone-x9y8', option: 'redis' })).toContain(
		'not on this board',
	)
	// An unanswered decision is `decide`'s, not this one's: the first answer
	// withdraws nothing, so it has no fan-out to show.
	expect(
		await call(client, 'edit_decision', { decision: decision ?? '', option: 'redis' }),
	).toContain('no answer yet')

	await call(client, 'decide', { decision })
	asked = 0
	expect(
		await call(client, 'edit_decision', { decision: decision ?? '', option: 'postgres' }),
	).toContain('no option called')
	expect(asked).toBe(0)
})

test('a human who does not confirm the fan-out changes nothing', async () => {
	const { repo: created, paths } = await board()
	const client = await connect(created.dir, (_, choices) =>
		choices.includes('no') ? 'no' : (choices[0] ?? null),
	)
	await call(client, 'propose', PROPOSAL)
	const [decision] = [...(await loadBoard(paths)).decisions.keys()]
	await call(client, 'decide', { decision })
	const answered = (await loadBoard(paths)).decisions.get(decision ?? '')?.answer?.option

	expect(
		await call(client, 'edit_decision', { decision: decision ?? '', option: 'redis' }),
	).toContain('did not confirm')
	expect((await loadBoard(paths)).decisions.get(decision ?? '')?.answer?.option).toBe(answered)
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
		expect((await client.listTools()).tools.length).toBe(26)
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
		nodes: [{ key: 'form', title: 'The sign-up form', decisions: ['d'] }],
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
	// Answering something that has not run yet is refused for the honest reason,
	// rather than accepting the words and dropping them (ADR 0046).
	expect(await call(client, 'answer', { node, text: 'anyone there?' })).toMatch(/has not run yet/i)
	expect(await call(client, 'run', { nodes: [node], base: 'main' })).toContain('finished')
	expect(await call(client, 'logs', { node })).toContain('result')
	// And a finished one cannot be answered either: the session is over.
	expect(await call(client, 'answer', { node, text: 'well done' })).toMatch(/not running/i)
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

test('a decision nothing binds is refused, and nothing is written', async () => {
	const { repo: created, paths } = await board()
	const client = await connect(created.dir)

	// Found in the M1 gate: two of three decisions bound no node, so answering
	// them would have unblocked nothing and the node they were about was ready.
	const said = await call(client, 'propose', {
		nodes: [{ key: 'auth', title: 'The auth API' }],
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
	})
	expect(said).toContain('bind no node')
	expect(said).toContain('store')

	const loaded = await loadBoard(paths)
	expect(loaded.nodes.size).toBe(0)
	expect(loaded.decisions.size).toBe(0)
})

test('a wrong edge can be corrected, which is what makes a proposal safe to accept', async () => {
	const { repo: created, paths } = await board()
	const client = await connect(created.dir)
	await call(client, 'propose', PROPOSAL)

	const before = await loadBoard(paths)
	const [decision] = [...before.decisions.keys()]
	const billing = [...before.nodes].find(
		([, node]) => node.title === 'The billing screen',
	)?.[0] as string

	// The decision was bound to the auth node only; it holds the billing screen too.
	expect(before.nodes.get(billing)?.decisions).toEqual([])
	await call(client, 'bind', { node: billing, decisions: [decision] })

	const after = await loadBoard(paths)
	expect(after.nodes.get(billing)?.decisions).toEqual([decision])

	// And removing it again, which is the half an add-only edit cannot do.
	await call(client, 'bind', { node: billing, decisions: [] })
	expect((await loadBoard(paths)).nodes.get(billing)?.decisions).toEqual([])
})

test('an edge that would close a cycle is refused after the fact too', async () => {
	const { repo: created, paths } = await board()
	const client = await connect(created.dir)
	await call(client, 'propose', {
		nodes: [
			{ key: 'a', title: 'A' },
			{ key: 'b', title: 'B', dependsOn: ['a'] },
		],
	})
	const nodes = await loadBoard(paths)
	const a = [...nodes.nodes].find(([, node]) => node.title === 'A')?.[0] as string
	const b = [...nodes.nodes].find(([, node]) => node.title === 'B')?.[0] as string

	expect(await call(client, 'bind', { node: a, dependsOn: [b] })).toContain('closes a cycle')
	expect((await loadBoard(paths)).nodes.get(a)?.dependsOn).toEqual([])
})

test('a decision nothing binds is named on the board, not left to be noticed', async () => {
	const { repo: created, paths } = await board()
	const client = await connect(created.dir)
	await call(client, 'propose', PROPOSAL)
	const [decision] = [...(await loadBoard(paths)).decisions.keys()]
	const auth = [...(await loadBoard(paths)).nodes].find(
		([, node]) => node.title === 'The auth API',
	)?.[0] as string

	expect(await call(client, 'board')).not.toContain('Bound to nothing')
	await call(client, 'bind', { node: auth, decisions: [] })

	const shown = await call(client, 'board')
	expect(shown).toContain('Bound to nothing')
	expect(shown).toContain(decision ?? '')
})

/** A second clone of the same remote, so the session has something to merge. */
const teammate = async (created: TempRepo) => {
	created.git('add', '-A')
	// The board fixture may already have committed everything.
	try {
		created.git('commit', '-m', 'chore: board')
	} catch {
		// Nothing to commit.
	}
	created.git('push', '-u', 'origin', 'main')
	const dir = join(created.remote, '..', 'teammate')
	execFileSync('git', ['clone', '--quiet', created.remote, dir])
	execFileSync('git', ['config', 'user.name', 'Bob'], { cwd: dir })
	execFileSync('git', ['config', 'user.email', 'bob@example.com'], { cwd: dir })
	execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir })
	const other = resolve(dir)
	await adoptBoard(other, 'sober-graph')
	return other
}

test('the session syncs the board, and says what went out', async () => {
	const { repo: created, paths } = await board()
	const client = await connect(created.dir)
	await call(client, 'propose', { nodes: [{ key: 'a', title: 'A node' }] })

	expect(await call(client, 'sync')).toContain('your board went out')
	expect(await sync(paths, 'sober-graph')).toMatchObject({ kind: 'synced' })
})

test('a record both of you changed is put to the human, one form, and lands', async () => {
	const { repo: created, paths } = await board()
	const client = await connect(created.dir, (message, choices) =>
		message.includes('title') ? 'theirs' : (choices[0] ?? null),
	)
	await call(client, 'propose', { nodes: [{ key: 'a', title: 'Ours' }] })
	await sync(paths, 'sober-graph')

	const other = await teammate(created)
	const [id] = [...(await loadBoard(paths)).nodes.keys()]
	const mine = (await loadBoard(paths)).nodes.get(id as string)
	await writeNode(other, id as string, { ...mine, title: 'Theirs', notes: 'from Bob' } as never)
	await sync(other, 'sober-graph')
	await writeNode(paths, id as string, { ...mine, title: 'Mine again' } as never)

	const answered = await call(client, 'sync')
	expect(answered).toContain('Records both of you changed')
	expect(answered).toContain('the merge landed')
	const merged = (await loadBoard(paths)).nodes.get(id as string)
	expect(merged?.title).toBe('Theirs')
	// The field only one of them touched came through without a question.
	expect(merged?.notes).toBe('from Bob')

	rmSync(other.root, { recursive: true, force: true })
})

test('a human who walks away merges nothing', async () => {
	const { repo: created, paths } = await board()
	const client = await connect(created.dir, (message, choices) =>
		message.includes('title') ? null : (choices[0] ?? null),
	)
	await call(client, 'propose', { nodes: [{ key: 'a', title: 'Ours' }] })
	await sync(paths, 'sober-graph')

	const other = await teammate(created)
	const [id] = [...(await loadBoard(paths)).nodes.keys()]
	const mine = (await loadBoard(paths)).nodes.get(id as string)
	await writeNode(other, id as string, { ...mine, title: 'Theirs' } as never)
	await sync(other, 'sober-graph')
	await writeNode(paths, id as string, { ...mine, title: 'Mine again' } as never)

	const stopped = await call(client, 'sync')
	expect(stopped).toContain('You stopped at')
	expect((await loadBoard(paths)).nodes.get(id as string)?.title).toBe('Mine again')

	rmSync(other.root, { recursive: true, force: true })
})

test('the team is put together in a session, and an unknown handle is refused', async () => {
	const { repo: created } = await board()
	const client = await connect(created.dir)
	await call(client, 'propose', PROPOSAL)

	expect(await call(client, 'contributors')).toContain('Nobody is on this project yet')
	expect(await call(client, 'contributors', { action: 'add' })).toContain('Which handle')

	await call(client, 'contributors', { action: 'add', handle: 'alice', role: 'maintainer' })
	expect(await call(client, 'contributors')).toContain('maintainer')

	const node = [...(await loadBoard(resolve(created.dir))).nodes.keys()].sort()[0] as string
	expect(await call(client, 'assign', { node, handle: 'alcie' })).toContain(
		'is not on this project',
	)
	expect(await call(client, 'assign', { node, handle: 'alice' })).toContain('assigned to alice')
	expect(await call(client, 'assign', { node })).toContain('assigned to nobody')

	expect(await call(client, 'contributors', { action: 'remove', handle: 'alice' })).toContain(
		'off the project',
	)
	expect(await call(client, 'contributors', { action: 'remove', handle: 'alice' })).toContain(
		'was not on it',
	)
})

test('a claim in a session names what it is heading for, and gives it back', async () => {
	const { repo: created } = await board()
	const client = await connect(created.dir)
	await call(client, 'propose', PROPOSAL)

	const ids = [...(await loadBoard(resolve(created.dir))).nodes.keys()].sort()
	const auth = ids.find((id) => id.startsWith('the-auth-api')) as string
	const billing = ids.find((id) => id.startsWith('the-billing-screen')) as string

	expect(await call(client, 'claim', { node: auth })).toContain("'s")
	// The proposal gives only the auth node files, so nothing is heading anywhere.
	expect(await call(client, 'claim', { node: billing })).not.toContain('same files')

	expect(await call(client, 'claim', { node: auth, release: true })).toContain("nobody's again")
	expect(await call(client, 'claim', { node: auth, release: true })).toContain('Nobody had claimed')
})

test('an older board is not rewritten inside a session — it names the surface that can', async () => {
	const { repo: created, paths: board_ } = await board()
	const client = await connect(created.dir)
	writeFileSync(
		board_.project,
		JSON.stringify({ schemaVersion: 1, title: 'Acme', intent: '', constraints: [] }),
	)

	const said_ = await call(client, 'board')
	expect(said_).toContain('older SOBER')
	expect(said_).toContain('sober status')
})

test('the session’s review carries CI, and a host that could not be read is not a pass', async () => {
	const { repo: created, paths: board_ } = await board()
	const client = await connect(created.dir)
	await call(client, 'propose', PROPOSAL)
	const node = [...(await loadBoard(board_)).nodes.keys()].sort()[0] as string

	// A branch with a commit on it, so there is something to open a draft over.
	const worktree = await addWorktree(board_, node, 'main')
	writeFileSync(join(worktree.path, 'written.ts'), 'export const x = 1\n')
	execFileSync('git', ['add', '-A'], { cwd: worktree.path })
	execFileSync('git', ['commit', '-m', 'feat: work'], { cwd: worktree.path })

	process.env.SOBER_GH = `${process.execPath} ${fileURLToPath(new URL('./fake-gh.mjs', import.meta.url))}`
	process.env.FAKE_GH_STATE = join(board_.local, 'gh.json')
	created.git('push', '-u', 'origin', 'main')
	await publish(board_, node, 'main')

	process.env.FAKE_GH_CHECKS = 'pass'
	expect(await call(client, 'review', { node })).toContain('## CI: green')

	process.env.FAKE_GH_CHECKS = 'fail'
	expect(await call(client, 'review', { node })).toContain('## CI: FAILED')

	process.env.FAKE_GH_CHECKS = 'pending'
	expect(await call(client, 'review', { node })).toContain('still running')

	delete process.env.FAKE_GH_CHECKS
	process.env.FAKE_GH_FAIL = '1'
	expect(await call(client, 'review', { node })).toContain('COULD NOT BE READ')

	delete process.env.FAKE_GH_FAIL
	delete process.env.SOBER_GH
	delete process.env.FAKE_GH_STATE
})

test('a run that meets another node’s files asks the human, and starts when they say so', async () => {
	const { repo: created, paths } = await board()
	let asked = ''
	const client = await connect(created.dir, (message, choices) => {
		if (message.includes('heading for')) asked = message
		return choices[0] ?? null
	})
	await call(client, 'propose', {
		nodes: [
			{ key: 'auth', title: 'The auth API', files: ['src/auth/**'] },
			{ key: 'ui', title: 'The session panel', files: ['src/auth/session.ts'] },
		],
	})
	const ids = [...(await loadBoard(paths)).nodes.keys()]
	const auth = ids.find((id) => id.startsWith('the-auth-api')) as string
	const ui = ids.find((id) => id.startsWith('the-session-panel')) as string
	for (const node of [auth, ui]) {
		await call(client, 'write_brief', {
			node,
			approach: 'Write it.',
			acceptance: [{ run: 'true', proves: 'it works' }],
		})
		await call(client, 'approve', { node })
	}
	await call(client, 'claim', { node: ui })

	// The human is asked, and this one says yes — the confirmation is not a block.
	expect(await call(client, 'run', { nodes: [auth], base: 'main' })).toContain('finished')
	expect(asked).toContain('heading for')
})

test('a run the human declines is not started, and nothing was cut', async () => {
	const { repo: created, paths } = await board()
	const client = await connect(created.dir, (message, choices) =>
		message.includes('heading for') ? 'no' : (choices[0] ?? null),
	)
	await call(client, 'propose', {
		nodes: [
			{ key: 'auth', title: 'The auth API', files: ['src/auth/**'] },
			{ key: 'ui', title: 'The session panel', files: ['src/auth/session.ts'] },
		],
	})
	const ids = [...(await loadBoard(paths)).nodes.keys()]
	const auth = ids.find((id) => id.startsWith('the-auth-api')) as string
	const ui = ids.find((id) => id.startsWith('the-session-panel')) as string
	await call(client, 'write_brief', {
		node: auth,
		approach: 'Write it.',
		acceptance: [{ run: 'true', proves: 'it works' }],
	})
	await call(client, 'approve', { node: auth })
	await call(client, 'claim', { node: ui })

	expect(await call(client, 'run', { nodes: [auth], base: 'main' })).toContain('was not started')
	expect(created.git('branch', '--list', `sober/${auth}`)).toBe('')
})

test('accepting starts what was approved and queued behind it, and says it did', async () => {
	const { repo: created, paths } = await board()
	const client = await connect(created.dir)
	await call(client, 'propose', {
		nodes: [
			{ key: 'auth', title: 'The auth API', files: ['src/auth/**'] },
			{ key: 'ui', title: 'The session panel', files: ['src/ui/**'], dependsOn: ['auth'] },
		],
	})
	const ids = [...(await loadBoard(paths)).nodes.keys()]
	const auth = ids.find((id) => id.startsWith('the-auth-api')) as string
	const ui = ids.find((id) => id.startsWith('the-session-panel')) as string
	for (const node of [auth, ui])
		await call(client, 'write_brief', {
			node,
			approach: 'Write it.',
			acceptance: [{ run: 'true', proves: 'it works' }],
		})
	await call(client, 'approve', { node: auth })
	await call(client, 'approve', { node: ui, queue: true })

	process.env.FAKE_HOST_COMMIT = 'src/auth/api.ts'
	await call(client, 'run', { nodes: [auth], base: 'main' })
	const accepted = await call(client, 'accept', { node: auth, base: 'main' })
	delete process.env.FAKE_HOST_COMMIT

	expect(accepted).toContain('The queue moved')
	expect(accepted).toContain(`${ui} finished`)

	// And reading it back is a record, not a decision waiting to be made — found
	// in M2's gate, where a node accepted from a session still read as reviewable.
	const read = await call(client, 'review', { node: auth, base: 'main' })
	expect(read).toContain('done — accepted by')
	expect(read).toContain('nothing here to accept or reject')
	expect(read).not.toContain('The diff is 1 lines')
})

test('a wave asks once about every node it warned on, and starts them when the human agrees', async () => {
	const { repo: created, paths } = await board()
	let asked = 0
	const client = await connect(created.dir, (message, choices) => {
		if (message.includes('heading for')) asked += 1
		return choices[0] ?? null
	})
	await call(client, 'propose', {
		nodes: [
			{ key: 'auth', title: 'The auth API', files: ['src/auth/**'] },
			{ key: 'ui', title: 'The session panel', files: ['src/auth/session.ts'] },
		],
	})
	const nodes = [...(await loadBoard(paths)).nodes.keys()]
	for (const node of nodes) {
		await call(client, 'write_brief', {
			node,
			approach: 'Write it.',
			acceptance: [{ run: 'true', proves: 'it works' }],
		})
		await call(client, 'approve', { node })
	}

	// Both of them meet, so the wave starts neither until it has an answer — and
	// one question covers the pair, because one window per node is how nobody
	// reads any of them.
	const ran = await call(client, 'run', { nodes, base: 'main' })
	expect(asked).toBe(1)
	for (const node of nodes) expect(ran).toContain(`${node}: finished`)
})

/**
 * DESIGN §7.2's three actions, in a session. The flag itself is `core`'s and
 * proven there; what this asks is whether a host can reach all three — the
 * `PR-09-08` promise that choosing a surface never costs a human an ability.
 */
const flagged = async (client: Client, paths: Paths): Promise<string> => {
	await call(client, 'propose', PROPOSAL)
	const board = await loadBoard(paths)
	const node = [...board.nodes].find(([, one]) => one.title === 'The auth API')?.[0] ?? ''

	await call(client, 'write_brief', {
		node,
		approach: 'Write the endpoints.',
		acceptance: [{ run: 'npm test', proves: 'They answer.' }],
	})
	// Approving does not require the decision to be answered, so answering it
	// afterwards is a real user path rather than a fixture (§2.8).
	await call(client, 'approve', { node })
	await call(client, 'decide', { decision: [...board.decisions.keys()][0] ?? '' })
	expect(flagsOf(await loadBoard(paths), node).flagged).toBe(true)
	return node
}

test('a session can set a flag aside, and the reason is what is kept', async () => {
	const { repo: created, paths } = await board()
	const client = await connect(created.dir)
	const node = await flagged(client, paths)

	const done = await call(client, 'dismiss', {
		node,
		reason: 'The endpoints never read the session store.',
	})
	expect(done).toContain('no longer flagged')

	const record = (await loadBoard(paths)).nodes.get(node)
	expect(record?.dismissal?.reason).toBe('The endpoints never read the session store.')
	// A dismissal settles the change it judged; it does not clear the flag.
	expect(flagsOf(await loadBoard(paths), node).flagged).toBe(false)
})

test('a session reopens a finished node, and reopening does not run it', async () => {
	const { repo: created, paths } = await board()
	const client = await connect(created.dir)
	const node = await flagged(client, paths)

	// Nothing has been accepted yet, and the refusal is a sentence rather than a
	// protocol error (§8.7).
	expect(await call(client, 'reopen', { node })).toContain('not finished')

	await acceptNode(paths, node, {
		by: 'memoksin',
		at: '2026-09-06T03:00:00.000Z',
		flagged: true,
		scan: 'clean',
	})
	expect(statusOf(await loadBoard(paths), node)).toBe('done')

	expect(await call(client, 'reopen', { node })).toContain('back in the loop')
	// Its brief is still approved, so it lands on `ready` — and nothing started.
	expect(statusOf(await loadBoard(paths), node)).toBe('ready')
})

test('a session opens one node for the fix, and it is not a plan', async () => {
	const { repo: created, paths } = await board()
	const client = await connect(created.dir)
	const node = await flagged(client, paths)

	const made = await call(client, 'open_node', {
		title: 'Re-read the session store',
		dependsOn: [node],
	})
	expect(made).toContain('needs a brief')

	const opened = [...(await loadBoard(paths)).nodes].find(
		([, one]) => one.title === 'Re-read the session store',
	)
	expect(opened?.[1].brief).toBeNull()
	expect(opened?.[1].dependsOn).toEqual([node])

	// A dependency the board does not hold is refused in a sentence, and nothing
	// is written.
	expect(await call(client, 'open_node', { title: 'A fix', dependsOn: ['gone-x9y8'] })).toContain(
		'not on this board',
	)
	expect((await loadBoard(paths)).nodes.size).toBe(3)
})

test('a session can answer a run somebody is watching, and finish it', async () => {
	const { repo: created, paths } = await board()
	const client = await connect(created.dir)
	await call(client, 'propose', { nodes: [{ key: 'a', title: 'The auth API' }] })
	const node = [...(await loadBoard(paths)).nodes.keys()][0] as string

	// A live attended run, written directly: `answerRun` appends to a file the
	// owning process relays, so reaching it needs a record rather than a host
	// (ADR 0046). What is under test is the tool, not the dispatch.
	await writeRun(paths, 'run-attended-k7f2', {
		node,
		host: 'claude-code',
		branch: `sober/${node}`,
		worktree: '/tmp/worktree',
		startedAt: new Date().toISOString(),
		endedAt: null,
		exit: null,
		error: null,
		verify: null,
		acceptance: [],
		attended: true,
	})

	expect(await call(client, 'answer', { node, text: 'use the second option' })).toMatch(
		/logs.*says back|Told/i,
	)
	expect(await call(client, 'answer', { node, text: 'that is everything', done: true })).toMatch(
		/finish/i,
	)
})
