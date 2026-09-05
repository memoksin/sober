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
 * - **Editing an answered decision.** It arrives with the impact preview
 *   (DESIGN §2.8) in the session that wires all three surfaces at once. Listing
 *   it early would hold the contract test red for a reason no earlier session
 *   can answer.
 */
export const OPERATIONS = [
	'init',
	'bind',
	'decide',
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
 */
export const AGENT_OPERATIONS = ['propose', 'open_decision'] as const

export type AgentOperation = (typeof AGENT_OPERATIONS)[number]
