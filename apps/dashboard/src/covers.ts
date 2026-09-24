import type { Operation } from '@besober/schema'

/**
 * Where the screen sends each operation `PR-09-08` binds. The server's route
 * table says what the dashboard *could* send; this says what a person can
 * actually press, which is the promise `PR-09-08` makes.
 *
 * The contract test does not take it at its word: it reads every `op` call in
 * this app through the type checker, and the operations those calls name must
 * be exactly the keys here. A button removed without this file noticing, or a
 * call added without it, is a red test.
 *
 * `GAPS` is what has no screen yet, written down so the test is green because
 * the gap is declared rather than because it is hidden. It only shrinks: each
 * dashboard node deletes its own lines in the diff that adds the UI, and the
 * test fails on an entry that is already called.
 */
export const COVERS: Readonly<Record<Exclude<Operation, (typeof GAPS)[number]>, string>> = {
	sync: 'header: sync with the remote',
	resolve: 'conflicts: pick a side for each record',
	decide: 'decision: pick an option',
	edit_decision: 'decision: change the answer, after the impact preview',
	approve: 'panel: Approve the brief',
	run: 'panel: Run, or Run and watch',
	stop: 'panel: Stop',
	answer: 'logs: Send',
	accept: 'review: Accept',
	reject: 'review: Send it back',
	audit: 'review: Run the checks again',
	dismiss: 'panel: It is fine anyway',
	reopen: 'panel: Run it again',
	create_node: 'panel: Open a node for the fix',
	accept_distribution: 'distribution: Assign all',
	drop_distribution: 'distribution: Drop it',
}

export const GAPS = [
	'init',
	'bind',
	'write_brief',
	'archive',
	'contributors_add',
	'contributors_remove',
	'assign',
	'claim',
	'release',
	'correct_node',
	'add_model',
	'start_dispatcher',
	'stop_dispatcher',
] as const satisfies readonly Operation[]
