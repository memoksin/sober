import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from '@besober/mcp'
import { OPERATIONS } from '@besober/schema'
import { COVERS as SERVER_COVERS, GAPS as SERVER_GAPS } from '@besober/server'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import ts from 'typescript'
import { beforeAll, expect, test } from 'vitest'
import {
	COVERS as DASHBOARD_COVERS,
	GAPS as DASHBOARD_GAPS,
} from '../../apps/dashboard/src/covers.js'
import { COVERS as CLI_COVERS, GAPS as CLI_GAPS } from '../../packages/cli/src/covers.js'
import { COVERS as MCP_COVERS, GAPS as MCP_GAPS } from '../../packages/mcp/src/covers.js'
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
 * session's must appear in `tools/list`, the server's *are* its route table's
 * keys, and the dashboard's must be exactly the operations its `op` calls name.
 *
 * What a surface does not cover yet it lists as `GAPS`, beside the coverage,
 * so parity is checked modulo a list a reviewer can read and shrink.
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

interface Declared {
	readonly covers: readonly string[]
	readonly gaps: readonly string[]
	/** What the surface actually sends, when that can be read off its code. */
	readonly calls?: readonly string[]
}

/**
 * Every operation is covered or a declared gap, never both and never neither;
 * nothing is named that the catalogue lacks; and where the calls can be read,
 * the declaration is exactly them. A gap that is called is the ratchet, the way
 * `coverage-baseline.json` is one: the diff that builds it deletes its line.
 */
const parity = (catalogue: readonly string[], { covers, gaps, calls }: Declared): string[] => {
	const problems: string[] = []
	for (const name of new Set([...covers, ...gaps, ...(calls ?? [])]))
		if (!catalogue.includes(name)) problems.push(`${name} is not an operation`)
	for (const operation of catalogue) {
		const covered = covers.includes(operation)
		const gap = gaps.includes(operation)
		if (covered && gap) problems.push(`${operation} is covered and still listed as a gap`)
		if (!covered && !gap) problems.push(`${operation} is neither covered nor a declared gap`)
	}
	if (calls === undefined) return problems
	for (const operation of covers)
		if (!calls.includes(operation)) problems.push(`${operation} is declared but never called`)
	for (const operation of calls) {
		if (gaps.includes(operation)) problems.push(`${operation} is called, so delete it from GAPS`)
		else if (!covers.includes(operation)) problems.push(`${operation} is called but not declared`)
	}
	return problems
}

test('parity passes a surface whose declaration matches its calls', () => {
	expect(parity(['a', 'b', 'c'], { covers: ['a', 'b'], gaps: ['c'], calls: ['a', 'b'] })).toEqual(
		[],
	)
})

test('parity fails a gap that is covered, and an operation in neither list', () => {
	expect(parity(['a', 'b', 'c'], { covers: ['a', 'b'], gaps: ['b'] })).toEqual([
		'b is covered and still listed as a gap',
		'c is neither covered nor a declared gap',
	])
})

test('parity fails a name the catalogue does not have', () => {
	expect(parity(['a'], { covers: ['a', 'z'], gaps: [] })).toEqual(['z is not an operation'])
})

test('parity fails an operation declared but never called, and one called but not declared', () => {
	expect(parity(['a', 'b', 'c'], { covers: ['a', 'b'], gaps: ['c'], calls: ['a'] })).toEqual([
		'b is declared but never called',
	])
	expect(parity(['a', 'b'], { covers: ['a'], gaps: [], calls: ['a', 'b'] })).toEqual([
		'b is neither covered nor a declared gap',
		'b is called but not declared',
	])
})

test('parity fails a gap that is already called — the ratchet', () => {
	expect(parity(['a', 'b'], { covers: ['a'], gaps: ['b'], calls: ['a', 'b'] })).toEqual([
		'b is called, so delete it from GAPS',
	])
})

/**
 * Every operation the dashboard sends, read from the type checker rather than
 * from the text: an `op` call is any call whose property resolves to the one
 * declared in `wire.ts`, and its first argument has to be a union of literals.
 * A call that sends a bare `Operation` could send anything, and a manifest
 * cannot be checked against that.
 */
const dashboardCalls = (): { readonly calls: string[]; readonly problems: string[] } => {
	const dir = join(repoRoot, 'apps/dashboard')
	const config = ts.readConfigFile(join(dir, 'tsconfig.json'), ts.sys.readFile)
	const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dir)
	const program = ts.createProgram(parsed.fileNames, parsed.options)
	const checker = program.getTypeChecker()
	const slash = (path: string): string => path.replaceAll('\\', '/')
	const src = `${slash(dir)}/src/`

	const calls = new Set<string>()
	const problems: string[] = []
	const visit = (node: ts.Node): void => {
		if (
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression) &&
			node.expression.name.text === 'op' &&
			checker
				.getSymbolAtLocation(node.expression.name)
				?.declarations?.some((one) => slash(one.getSourceFile().fileName) === `${src}wire.ts`)
		) {
			const argument = node.arguments[0]
			const type = argument === undefined ? undefined : checker.getTypeAtLocation(argument)
			const named = (type?.isUnion() ? type.types : type === undefined ? [] : [type]).map((one) =>
				one.isStringLiteral() ? one.value : null,
			)
			const file = node.getSourceFile()
			const { line } = file.getLineAndCharacterOfPosition(node.getStart())
			if (named.length === 0 || named.includes(null) || named.length === OPERATIONS.length)
				problems.push(`${file.fileName}:${line + 1} does not name what it sends`)
			else for (const one of named) if (one !== null) calls.add(one)
		}
		ts.forEachChild(node, visit)
	}
	for (const file of program.getSourceFiles()) {
		const name = slash(file.fileName)
		if (name.startsWith(src) && !/\.test\.tsx?$/.test(name)) visit(file)
	}
	return { calls: [...calls], problems }
}

let dashboard: ReturnType<typeof dashboardCalls> = { calls: [], problems: [] }

beforeAll(() => {
	dashboard = dashboardCalls()
}, 60_000)

test('the dashboard names what it sends at every call site', () => {
	expect(dashboard.problems).toEqual([])
	expect(dashboard.calls.length).toBeGreaterThan(0)
})

const surfaces: readonly (readonly [string, Declared])[] = [
	['the command line', { covers: Object.keys(CLI_COVERS), gaps: CLI_GAPS }],
	['the host session', { covers: Object.keys(MCP_COVERS), gaps: MCP_GAPS }],
	['the server', { covers: SERVER_COVERS, gaps: SERVER_GAPS }],
]

test.each(surfaces)('%s covers every operation or declares the gap', (_name, declared) => {
	expect(parity(OPERATIONS, declared)).toEqual([])
})

test('the dashboard declares exactly what it calls, and every other operation as a gap', () => {
	const declared = {
		covers: Object.keys(DASHBOARD_COVERS),
		gaps: DASHBOARD_GAPS,
		calls: dashboard.calls,
	}
	expect(parity(OPERATIONS, declared)).toEqual([])
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
	for (const covers of [CLI_COVERS, MCP_COVERS, DASHBOARD_COVERS]) {
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
