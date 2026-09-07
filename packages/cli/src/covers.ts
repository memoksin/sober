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
	// §2.8's edit. The fan-out is printed and the command refuses; `--anyway` on
	// the second command is the confirmation, the way `run` already asks for one.
	edit_decision: 'edit',
	// The written half of a brief arrives through `--write`, including `-` for
	// the pipe an agent uses.
	write_brief: 'brief',
	approve: 'approve',
	run: 'run',
	// Talking to a run you are watching. Usually a second terminal, because
	// `sober run --watch` is holding the first one.
	answer: 'say',
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
	// One command, both ways out of a plan: `--accept` assigns it, `--drop`
	// takes it off the board. Proposing is not here — a terminal has no agent
	// (ADR 0051, and ADR 0009's line before it).
	accept_distribution: 'distribute',
	drop_distribution: 'distribute',
}
