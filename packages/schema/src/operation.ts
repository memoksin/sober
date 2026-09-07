/**
 * The operations `PR-09-08` binds: every one of them is reachable from the host
 * session, the command line and the dashboard, headless. This list is the spine
 * of the wire contract (ADR 0036) — a route is named from an entry here, and
 * the contract test in `test/integration` reads it against what each surface
 * declares it covers.
 *
 * A surface declares coverage rather than being matched by name, because the
 * same operation is spelled differently on each: `resolve` is folded into the
 * host session's `sync` elicitation, and `release` is a flag on `claim`. A
 * declaration can lie, which is why it sits beside the registration it
 * describes, where a reviewer reads both in one diff.
 *
 * Not here, each for its own reason:
 *
 * - **Reads.** A surface may read in whatever shape suits it; the canvas asks
 *   for a slim projection (ADR 0008) that no other surface wants.
 * - **`accept --green`.** Batching, not a state change of its own — it is N
 *   accepts, and requiring it everywhere would invent a host-session tool
 *   nobody asked for. `DESIGN.md` §6.0 already gives each surface its own
 *   shape for the same idea.
 * - **The impact preview.** `edit_decision` below is one entry rather than two
 *   because the preview is a read (`/read/impact`), and the fan-out it shows is
 *   carried by the refusal the edit answers with when it arrives unconfirmed.
 *   The confirmation is a second call with a flag, which is the shape ADR 0032
 *   already gave `run --anyway` (ADR 0044).
 */
export const OPERATIONS = [
	'init',
	'bind',
	'decide',
	// Changing an answer already given, previewed and then confirmed (§2.8).
	// Not `decide` a second time: the first answer holds nothing back, and this
	// one withdraws every brief written against the answer it replaces.
	'edit_decision',
	'write_brief',
	'approve',
	'run',
	'stop',
	'accept',
	'reject',
	'archive',
	'sync',
	'resolve',
	'contributors_add',
	'contributors_remove',
	'assign',
	'claim',
	'release',
	// DESIGN §7.2's three, and each one is a different act rather than three
	// spellings of one. `reopen` only clears what made a node done — running it
	// is still `run`, because approving and starting have never been one step.
	'dismiss',
	'reopen',
	'create_node',
] as const

export type Operation = (typeof OPERATIONS)[number]

/**
 * Operations a model authors: `propose` returns nodes with the edges between
 * them and the decisions each introduces (DESIGN §3.5), and `open_decision`
 * generates options on demand (§2.6). Both need an agent, and a terminal does
 * not have one — ADR 0009 put planning in a host session for exactly this
 * reason.
 *
 * So `PR-09-08` does not reach them. Its promise is that choosing a surface
 * never costs a human an ability; it is not a promise that every surface grows
 * a model. In v1 that means the host session, and the dashboard does not plan —
 * `BUILD-PLAN.md` §2 lists M3's screens and no planning screen is among them.
 *
 * `create_node` above is not the thin end of this. Opening one node with a
 * title and its edges is data entry; `propose` returns a set of nodes, the
 * edges between them and the decisions each one introduces, against the code as
 * it is now. The first needs a person who knows what they want, the second
 * needs a model — which is the line ADR 0009 drew.
 */
export const AGENT_OPERATIONS = ['propose', 'open_decision'] as const

export type AgentOperation = (typeof AGENT_OPERATIONS)[number]
