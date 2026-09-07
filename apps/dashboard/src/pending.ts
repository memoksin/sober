/**
 * What a button says while it is working.
 *
 * M3's gate found the review button silent — no spinner, no disabled state, no
 * narration — and the screen read as frozen for the seconds the scan takes.
 * The fix is not one spinner. Every surface in this product narrates: the CLI
 * has `spinner` on stderr and prints its scan, its criteria and its diff in
 * order, and the screen inherited the operations without the sentences.
 *
 * One vocabulary rather than five, for ADR 0032's reason: a person learns the
 * convention once, and an operation added later that says nothing is a hole a
 * test can see (`pending.test.ts` walks every clickable operation).
 *
 * The sentences name the operation rather than the button. "Accepting…" on a
 * button labelled Accept says only that the click landed; "Merging it…" says
 * what is taking the time, which is the half a person is waiting to be told.
 */
export const PENDING: Readonly<Record<string, string>> = {
	approve: 'Approving the brief…',
	run: 'Cutting the worktree…',
	stop: 'Stopping the run…',
	// The one the gate found. A review is a scan over the diff, and the scan is
	// what the seconds are spent on.
	review: 'Running the scan…',
	accept: 'Merging it…',
	reject: 'Sending it back…',
	decide: 'Saving the answer…',
	edit_decision: 'Changing the answer…',
	impact: 'Reading what it reaches…',
	dismiss: 'Setting it aside…',
	reopen: 'Reopening it…',
	open: 'Opening the node…',
}

/** The fallback is a sentence, not silence: an unlisted operation still speaks. */
export const pending = (does: string): string => PENDING[does] ?? 'Working…'
