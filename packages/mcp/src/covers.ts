import type { Operation } from '@besober/schema'

/**
 * Which tool performs each operation `PR-09-08` binds. Beside the registrations
 * rather than in the contract test, for the reason the CLI's twin gives: a
 * manifest that lives away from what it describes drifts away from it too.
 *
 * The contract test checks every name here against a real `tools/list`, so a
 * tool renamed without this file noticing is a red test.
 *
 * Two entries name a tool that does something else as well, and both are the
 * right shape rather than a shortcut:
 *
 * - **`resolve` is `sync`.** A merge that could not settle itself is asked
 *   about *during* the sync, through elicitation, because that is the moment
 *   the person has the context. A separate tool would mean asking them to come
 *   back for it.
 * - **`release` is `claim`.** Giving a node back is the same statement as
 *   taking it, negated, and a claim is a signal rather than a lock (§3.3).
 */
export const COVERS: Readonly<Record<Operation, string>> = {
	init: 'init',
	bind: 'bind',
	decide: 'decide',
	// The fan-out is one elicitation for the whole change rather than one per
	// node: a window per node is how nobody reads any of them (M1 gate, defect 11).
	edit_decision: 'edit_decision',
	write_brief: 'write_brief',
	approve: 'approve',
	run: 'run',
	answer: 'answer',
	stop: 'stop',
	accept: 'accept',
	reject: 'reject',
	archive: 'archive',
	sync: 'sync',
	resolve: 'sync',
	contributors_add: 'contributors',
	contributors_remove: 'contributors',
	assign: 'assign',
	claim: 'claim',
	release: 'claim',
	// DESIGN §7.2's three. `open_node`, not `open`: a session already has
	// `propose`, and the two are told apart by what they take.
	dismiss: 'dismiss',
	reopen: 'reopen',
	create_node: 'open_node',
	// One tool, four acts, told apart by what it is given — the shape
	// `contributors` already has. Proposing is the session's alone (ADR 0051);
	// the two operations here are the human's and are on every surface.
	accept_distribution: 'distribute',
	drop_distribution: 'distribute',
}
