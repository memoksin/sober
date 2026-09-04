import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { registerBuilding } from './tools/build.js'
import { registerPlanning } from './tools/plan.js'
import { registerReview } from './tools/review.js'
import { registerSync } from './tools/sync.js'

const VERSION = '0.0.0'

/**
 * SOBER's tools inside the user's own session (ADR 0009, MUST #12). Every one
 * of them calls `core` — the same functions the CLI calls — so the two surfaces
 * cannot drift into two products, and `PR-09-08`'s rule holds: every
 * state-changing operation is available on all of them.
 *
 * Three of these tools do not act on their own. Answering a decision, approving
 * a brief and accepting work are human acts, and they reach the human through
 * elicitation (ADR 0010). A host that cannot ask says so and names the surface
 * that can.
 */
export const createServer = (cwd: string = process.cwd()): McpServer => {
	const server = new McpServer(
		{ name: 'sober', version: VERSION },
		{
			instructions:
				'SOBER plans work as a graph and dispatches agents into it. Read the board first. A node is held until every decision it binds is answered, and nothing runs without a human-approved brief. You may propose, open decisions, write briefs and review; picking an option, approving a brief and accepting work are the human’s, and the tools ask them directly.',
		},
	)

	registerPlanning(server, cwd)
	registerBuilding(server, cwd)
	registerReview(server, cwd)
	registerSync(server, cwd)
	return server
}

/**
 * stdio, because that is how a host starts a server it owns. Nothing else in
 * this package may write to stdout: it is the protocol's channel.
 */
export const serve = async (): Promise<void> => {
	await createServer().connect(new StdioServerTransport())
}
