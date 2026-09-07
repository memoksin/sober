import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { paths as resolve } from '@besober/core'
import { createServer } from '@besober/mcp'
import { serve } from '@besober/server'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, beforeAll, expect, test } from 'vitest'
import { createTempRepo, type TempRepo } from './fixture.js'

/**
 * ADR 0051's split, driven the way it is actually used: the plan is written by
 * a session, and settled from a terminal that never saw the session. That
 * crossing is the whole feature — a proposal only one window can read is the
 * thing the record exists to avoid.
 */
const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const SOBER = join(repoRoot, 'packages/cli/dist/sober.js')
const AT = '2026-09-08T00:00:00.000Z'

beforeAll(() => {
	execFileSync(process.execPath, ['build.mjs'], { cwd: join(repoRoot, 'packages/cli') })
}, 180_000)

let repo: TempRepo | undefined

afterEach(() => {
	repo?.cleanup()
	repo = undefined
})

const sober = (cwd: string, ...args: string[]): string =>
	execFileSync(process.execPath, [SOBER, ...args], {
		cwd,
		encoding: 'utf8',
		env: { ...process.env, NO_COLOR: '1' },
	})

const said = (result: unknown): string =>
	((result as { content: { text: string }[] }).content ?? []).map((one) => one.text).join('\n')

/**
 * A host with a human on the other end of every elicitation. `answers` is what
 * they say when asked; `false` is a human who says no.
 */
const session = async (dir: string, answers = true) => {
	const client = new Client(
		{ name: 'test-host', version: '0.0.0' },
		{ capabilities: { elicitation: {} } },
	)
	client.setRequestHandler(ElicitRequestSchema, () =>
		Promise.resolve(
			answers ? { action: 'accept', content: { confirmed: true } } : { action: 'decline' },
		),
	)
	const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
	await Promise.all([createServer(dir).connect(serverSide), client.connect(clientSide)])
	return client
}

const node = (dir: string, id: string, title: string, over: Record<string, unknown> = {}) =>
	writeFileSync(
		join(dir, '.sober/nodes', `${id}.json`),
		`${JSON.stringify(
			{
				title,
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
			},
			null,
			'\t',
		)}\n`,
	)

const project = (): string => {
	const created = createTempRepo()
	repo = created
	writeFileSync(join(created.dir, 'README.md'), '# acme\n')
	created.git('add', '-A')
	created.git('commit', '-m', 'chore: first')
	sober(created.dir, 'init', '--title', 'Acme', '--intent', 'Ship sign-in')
	sober(
		created.dir,
		'contributors',
		'add',
		'alice',
		'--role',
		'maintainer',
		'--focus',
		'src/api/**',
	)
	sober(created.dir, 'contributors', 'add', 'bob', '--role', 'author', '--focus', 'src/ui/**')
	node(created.dir, 'auth-api-k7f2', 'The auth API')
	node(created.dir, 'auth-ui-9x1p', 'The auth panel')
	return created.dir
}

const assigneeOf = (dir: string, id: string): string | null =>
	JSON.parse(readFileSync(join(dir, '.sober/nodes', `${id}.json`), 'utf8')).assignee

test('a session writes the plan and a terminal that never saw it takes it', async () => {
	const dir = project()
	const client = await session(dir)

	const proposed = await client.callTool({
		name: 'distribute',
		arguments: {
			matches: [
				{ node: 'auth-api-k7f2', handle: 'alice', because: 'the api is hers' },
				{ node: 'auth-ui-9x1p', handle: 'bob', because: 'the ui is his' },
			],
		},
	})
	expect(said(proposed)).toContain('the api is hers')
	// The session wrote a plan and assigned nobody — the constraint the whole
	// feature turns on (ADR 0004's rule, ADR 0051's application of it).
	expect(assigneeOf(dir, 'auth-api-k7f2')).toBeNull()

	const read = sober(dir, 'distribute')
	expect(read).toContain('alice')
	expect(read).toContain('the api is hers')
	expect(read).toContain('Nothing is assigned yet')

	expect(sober(dir, 'distribute', '--accept')).toContain('2 nodes assigned')
	expect(assigneeOf(dir, 'auth-api-k7f2')).toBe('alice')
	expect(assigneeOf(dir, 'auth-ui-9x1p')).toBe('bob')
	expect(existsSync(join(dir, '.sober/distribution.json'))).toBe(false)

	await client.close()
})

test('a node somebody is on is passed over, and the terminal says which', async () => {
	const dir = project()
	node(dir, 'auth-api-k7f2', 'The auth API', { claim: { by: 'carol', at: AT } })
	const client = await session(dir)

	await client.callTool({
		name: 'distribute',
		arguments: {
			matches: [
				{ node: 'auth-api-k7f2', handle: 'alice', because: 'the api is hers' },
				{ node: 'auth-ui-9x1p', handle: 'bob', because: 'the ui is his' },
			],
		},
	})

	const read = sober(dir, 'distribute')
	expect(read).toContain('passed over 1 node')
	expect(read).toContain('auth-api-k7f2')

	sober(dir, 'distribute', '--accept')
	// The claim is untouched and no plan was written over it.
	expect(assigneeOf(dir, 'auth-api-k7f2')).toBeNull()
	expect(assigneeOf(dir, 'auth-ui-9x1p')).toBe('bob')

	await client.close()
})

test('a session settles its own plan too — the two operations are on every surface', async () => {
	const dir = project()
	const client = await session(dir)

	expect(said(await client.callTool({ name: 'distribute', arguments: {} }))).toContain(
		'No proposal is waiting',
	)

	await client.callTool({
		name: 'distribute',
		arguments: {
			matches: [{ node: 'auth-api-k7f2', handle: 'alice', because: 'the api is hers' }],
		},
	})
	expect(said(await client.callTool({ name: 'distribute', arguments: {} }))).toContain(
		'the api is hers',
	)

	const landed = await client.callTool({ name: 'distribute', arguments: { accept: true } })
	expect(said(landed)).toContain('auth-api-k7f2 → alice')
	expect(assigneeOf(dir, 'auth-api-k7f2')).toBe('alice')

	// Accepting twice is not a second assignment: the record it was about is gone.
	expect(
		said(await client.callTool({ name: 'distribute', arguments: { accept: true } })),
	).toContain('no proposal waiting')
	expect(said(await client.callTool({ name: 'distribute', arguments: { drop: true } }))).toContain(
		'no proposal waiting',
	)

	await client.close()
})

test('a session may not accept its own plan — the human is asked, and may say no', async () => {
	const dir = project()
	const client = await session(dir, false)

	await client.callTool({
		name: 'distribute',
		arguments: {
			matches: [{ node: 'auth-api-k7f2', handle: 'alice', because: 'the api is hers' }],
		},
	})

	expect(
		said(await client.callTool({ name: 'distribute', arguments: { accept: true } })),
	).toContain('Not accepted')
	expect(assigneeOf(dir, 'auth-api-k7f2')).toBeNull()
	// Refused, not dropped: the plan is still there for the surface that asks
	// the question differently.
	expect(sober(dir, 'distribute')).toContain('the api is hers')

	await client.close()
})

test('a plan whose every node is taken assigns nothing, and says which', async () => {
	const dir = project()
	node(dir, 'auth-api-k7f2', 'The auth API', { claim: { by: 'carol', at: AT } })
	const client = await session(dir)

	await client.callTool({
		name: 'distribute',
		arguments: {
			matches: [{ node: 'auth-api-k7f2', handle: 'alice', because: 'the api is hers' }],
		},
	})

	const landed = await client.callTool({ name: 'distribute', arguments: { accept: true } })
	expect(said(landed)).toContain('Nothing was assigned')
	expect(said(landed)).toContain('auth-api-k7f2')

	await client.close()
})

test('a session with nobody on the project is told to put someone on it first', async () => {
	const dir = project()
	sober(dir, 'contributors', 'remove', 'alice')
	sober(dir, 'contributors', 'remove', 'bob')
	const client = await session(dir)

	expect(said(await client.callTool({ name: 'distribute', arguments: {} }))).toContain(
		'Nobody is on this project yet',
	)

	await client.close()
})

test('dropping is a way out, and it assigns nothing on the way', async () => {
	const dir = project()
	const client = await session(dir)

	await client.callTool({
		name: 'distribute',
		arguments: {
			matches: [{ node: 'auth-api-k7f2', handle: 'alice', because: 'the api is hers' }],
		},
	})

	expect(sober(dir, 'distribute', '--drop')).toContain('off the board')
	expect(assigneeOf(dir, 'auth-api-k7f2')).toBeNull()
	expect(sober(dir, 'distribute')).toContain('no proposal is waiting')
	expect(sober(dir, 'distribute', '--drop')).toContain('no proposal waiting')
	expect(sober(dir, 'distribute', '--accept')).toContain('no proposal is waiting')

	await client.close()
})

test('the dashboard reads the plan and settles it, the same as the other two', async () => {
	const dir = project()
	const client = await session(dir)
	await client.callTool({
		name: 'distribute',
		arguments: {
			matches: [{ node: 'auth-api-k7f2', handle: 'alice', because: 'the api is hers' }],
		},
	})
	await client.close()

	const served = await serve({ paths: resolve(dir) })
	try {
		const read = async (name: string) =>
			(
				await fetch(new URL(`/read/${name}`, served.url), {
					headers: { authorization: `Bearer ${served.token}` },
				})
			).json()
		const send = (operation: string) =>
			fetch(new URL(`/op/${operation}`, served.url), {
				method: 'POST',
				headers: {
					authorization: `Bearer ${served.token}`,
					'content-type': 'application/json',
				},
				body: '{}',
			})

		expect(await read('distribution')).toMatchObject({ matches: [{ handle: 'alice' }] })

		expect((await send('accept_distribution')).status).toBe(200)
		expect(assigneeOf(dir, 'auth-api-k7f2')).toBe('alice')
		expect(await read('distribution')).toBeNull()

		// Both refusals are a `false`/`null`, never a failure: the screen polls
		// this every two seconds and a 500 there is an error banner, not an answer.
		expect(await (await send('drop_distribution')).json()).toEqual({ dropped: false })
	} finally {
		await served.close()
	}
})

test('the plan travels with the board, so it is the team’s and not one machine’s', () => {
	expect(
		readFileSync(join(repoRoot, '.gitattributes'), 'utf8'),
		'a board record git may line-merge is a board record with conflict markers in it',
	).toContain('.sober/distribution.json merge=binary')
})
