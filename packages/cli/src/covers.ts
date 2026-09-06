import type { Operation } from '@besober/schema'

/**
 * Which command performs each operation `PR-09-08` binds. It sits here rather
 * than in the contract test so that a reviewer reads it in the same diff as the
 * command it describes — a manifest kept somewhere else is a manifest that
 * drifts.
 *
 * The contract test does not take it at its word: every name here has to appear
 * in `sober --help`, so an operation that reaches the switch but never the help
 * text fails the check. `PR-00-03` wants the help complete anyway; this is what
 * makes that a test rather than a habit.
 */
export const COVERS: Readonly<Record<Operation, string>> = {
	init: 'init',
	bind: 'bind',
	decide: 'decide',
	// The written half of a brief arrives through `--write`, including `-` for
	// the pipe an agent uses.
	write_brief: 'brief',
	approve: 'approve',
	run: 'run',
	stop: 'stop',
	accept: 'accept',
	reject: 'reject',
	archive: 'archive',
	sync: 'sync',
	resolve: 'resolve',
	// One command, two operations: `contributors add` and `contributors remove`.
	contributors_add: 'contributors',
	contributors_remove: 'contributors',
	assign: 'assign',
	claim: 'claim',
	release: 'release',
	// DESIGN §7.2's three. `open` rather than `create`: the command line names
	// what a person does, and nobody says they are creating a node.
	dismiss: 'dismiss',
	reopen: 'reopen',
	create_node: 'open',
}
