import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from '@besober/mcp'
import { OPERATIONS } from '@besober/schema'
import { COVERS as SERVER_COVERS } from '@besober/server'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { beforeAll, expect, test } from 'vitest'
import { COVERS as CLI_COVERS } from '../../packages/cli/src/covers.js'
import { COVERS as MCP_COVERS } from '../../packages/mcp/src/covers.js'
import { createTempRepo } from './fixture.js'

/**
 * `PR-09-08`, as a check rather than a sentence: every state-changing operation
 * is reachable from the host session, the command line and the dashboard.
 *
 * Each surface declares what it covers, because the same operation is spelled
 * differently on each — `resolve` is folded into the session's `sync`
 * elicitation and `release` is a flag on `claim`. A declaration on its own
 * would be a promise, so every declaration is checked against the surface it
 * describes: the command line's names must appear in `sober --help`, the
 * session's must appear in `tools/list`, and the server's *are* its route
 * table's keys.
 */
const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const SOBER = join(repoRoot, 'packages/cli/dist/sober.js')

let help = ''
let tools: string[] = []
let described: Record<string, string> = {}

beforeAll(async () => {
	execFileSync(process.execPath, ['build.mjs'], { cwd: join(repoRoot, 'packages/cli') })
	help = execFileSync(process.execPath, [SOBER, '--help'], {
		encoding: 'utf8',
		env: { ...process.env, NO_COLOR: '1' },
	})

	const repo = createTempRepo()
	try {
		const client = new Client({ name: 'contract', version: '0.0.0' }, { capabilities: {} })
		const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
		await Promise.all([createServer(repo.dir).connect(serverSide), client.connect(clientSide)])
		const listed = (await client.listTools()).tools
		tools = listed.map((one) => one.name)
		described = Object.fromEntries(listed.map((one) => [one.name, one.description ?? '']))
		await client.close()
	} finally {
		repo.cleanup()
	}
}, 180_000)

const surfaces = [
	['the command line', CLI_COVERS],
	['the host session', MCP_COVERS],
] as const

test.each(surfaces)('%s covers every operation, and nothing extra', (_name, covers) => {
	expect(Object.keys(covers).sort()).toEqual([...OPERATIONS].sort())
})

test('the dashboard covers every operation, and nothing extra', () => {
	expect([...SERVER_COVERS].sort()).toEqual([...OPERATIONS].sort())
})

test('every command the command line claims is a command it has', () => {
	for (const [operation, command] of Object.entries(CLI_COVERS)) {
		expect(help, `${operation} -> sober ${command}`).toContain(command)
	}
})

test('every tool the host session claims is a tool it registers', () => {
	for (const [operation, tool] of Object.entries(MCP_COVERS)) {
		expect(tools, `${operation} -> ${tool}`).toContain(tool)
	}
})

test('an operation folded into another still names the tool that performs it', () => {
	// The two the M2 gate's shapes forced, kept explicit so that unfolding one
	// later is a visible change rather than a silent one.
	expect(MCP_COVERS.resolve).toBe('sync')
	expect(MCP_COVERS.release).toBe('claim')
})

test('no surface routes what an agent authors — planning stays in the session', () => {
	for (const covers of [CLI_COVERS, MCP_COVERS]) {
		expect(Object.keys(covers)).not.toContain('propose')
		expect(Object.keys(covers)).not.toContain('open_decision')
		// The matching is a model's, the same way decomposition is (ADR 0051).
		// The two operations it produces are not — they are on every surface, and
		// the checks above already hold them there.
		expect(Object.keys(covers)).not.toContain('distribute')
	}
})

/**
 * ADR 0051's split, which no check above can see: `accept_distribution` and
 * `drop_distribution` are in `OPERATIONS`, so parity already covers them — but
 * nothing says that only a session can *propose* one. That is the half a
 * terminal grows by accident the day somebody adds a heuristic to `core`.
 */
test('only a session proposes a distribution, and every surface settles one', async () => {
	expect(tools).toContain('distribute')
	expect(described.distribute).toMatch(/propose/i)
	expect(help).not.toMatch(/distribute .*--propose/)

	const { OPS } = await import('@besober/server')
	for (const operation of ['accept_distribution', 'drop_distribution'] as const) {
		expect(OPS[operation].accepts.safeParse({}).success, operation).toBe(true)
	}
})

/**
 * A run of linked nodes is not a new operation (ADR 0050) — it is `claim` and
 * `release` over a set — so `OPERATIONS` does not grow and the checks above
 * stay green whether or not any surface has it. That is exactly how parity
 * would break silently here, so the run is named on each surface by hand.
 */
test('a run of linked nodes is claimed and released on every surface', async () => {
	expect(help).toContain('from..to')
	expect(described.claim).toContain('from..to')

	const { OPS } = await import('@besober/server')
	for (const operation of ['claim', 'release'] as const) {
		const accepts = OPS[operation].accepts
		expect(accepts.safeParse({ node: 'auth-api-k7f2..auth-ui-9x1p' }).success, operation).toBe(true)
	}
})

test('every surface reads a run with the same parser, so the three cannot drift', async () => {
	const { chainEnds } = await import('@besober/schema')

	expect(chainEnds('auth-api-k7f2..auth-ui-9x1p')).toEqual(['auth-api-k7f2', 'auth-ui-9x1p'])
})
