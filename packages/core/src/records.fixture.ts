import type { Decision, Node, Run } from '@besober/schema'

// Records the tests build on. Not part of the package: the build and the
// published surface exclude `*.fixture.ts`.
const AT = '2026-09-04T00:00:00.000Z'

export const aNode = (overrides: Partial<Node> = {}): Node => ({
	title: 'A node',
	description: '',
	notes: '',
	dependsOn: [],
	decisions: [],
	files: [],
	brief: null,
	outcome: null,
	accepted: null,
	createdAt: AT,
	...overrides,
})

export const aDecision = (overrides: Partial<Decision> = {}): Decision => ({
	category: 'state',
	question: 'Where does session state live?',
	options: [
		{ id: 'cookie', label: 'Cookie', reason: 'No server state', costLater: 'Size limits' },
		{ id: 'redis', label: 'Redis', reason: 'Revocable', costLater: 'A service to run' },
	],
	suggested: null,
	answer: null,
	createdAt: AT,
	...overrides,
})

export const aRun = (node: string, overrides: Partial<Run> = {}): Run => ({
	node,
	host: 'claude-code',
	branch: `sober/${node}`,
	worktree: '/tmp/worktree',
	startedAt: AT,
	endedAt: null,
	exit: null,
	error: null,
	verify: null,
	acceptance: [],
	...overrides,
})
