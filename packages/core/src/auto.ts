import type { AutoProvenance, Checks, Handle, Node, ScanResult, Status } from '@besober/schema'
import { readConfig } from './config.js'
import { sameHandle } from './contributors.js'
import { approveBrief } from './decide.js'
import { type Dispatched, type DispatchOptions, dispatch } from './dispatch.js'
import { SoberError } from './errors.js'
import { findCycle, loadBoard } from './graph.js'
import { appendEvent } from './local.js'
import type { Paths } from './paths.js'
import { acceptWork, auditOf, type Landed } from './review.js'
import { flagsOf, openDecisions, statusOf } from './status.js'
import { overlaps } from './team.js'

/**
 * ADR 0065 §3: one failed condition refuses the transition, and the node goes
 * back to the human exactly as a blocked person would find it.
 */
export class AutoRefusedError extends SoberError {
	constructor(
		readonly node: string,
		readonly transition: AutoTransition,
		readonly reasons: readonly string[],
	) {
		super(
			'auto-refused',
			`sober:auto did not ${transition} ${node}, so it is left for a human — ${reasons.join('; ')}`,
		)
	}
}

export type AutoTransition = 'approve' | 'dispatch' | 'accept'

const EXPECTED: Record<AutoTransition, Status> = {
	approve: 'needs-approval',
	dispatch: 'ready',
	accept: 'in-review',
}

export interface AutoOptions {
	readonly invokedBy: Handle
	/** The branch the work lands on. It has to be `dispatch.base`, and never a release branch. */
	readonly base: string
}

const RELEASE = /^(main|master)$|^release[/-]/

const unsafeBase = async (paths: Paths, base: string): Promise<string | null> => {
	const config = await readConfig(paths)
	if (config.kind !== 'ok') return `the config could not be read (${config.reason})`
	const configured = config.value.dispatch.base
	if (configured === null)
		return 'dispatch.base is not set — sober:auto lands only on a configured base, so set it in .sober/config.jsonc (e.g. "development")'
	if (base !== configured) return `${base} is not the configured base, ${configured}`
	if (RELEASE.test(base))
		return `${base} is main or a release branch — a merge there is a release, and a release is the human's`
	return null
}

/**
 * Every condition of ADR 0065 §3–§4, read from a fresh board: the caller cannot
 * hand in a stale one. Empty means clear.
 */
export const autoGate = async (
	paths: Paths,
	id: string,
	transition: AutoTransition,
	options: AutoOptions,
): Promise<string[]> => {
	const board = await loadBoard(paths)
	const reasons: string[] = []

	const open = openDecisions(board).map(([decision]) => decision)
	if (open.length > 0) reasons.push(`the board has open decisions: ${open.join(', ')}`)
	if (board.broken.length > 0)
		reasons.push(`the board has broken records: ${board.broken.map((b) => b.file).join(', ')}`)
	const cycle = findCycle(board.nodes)
	if (cycle !== null) reasons.push(`the graph has a cycle: ${cycle.join(' → ')}`)

	const base = await unsafeBase(paths, options.base)
	if (base !== null) reasons.push(base)

	const node = board.nodes.get(id)
	if (node === undefined) return [...reasons, `${id} is not on this board`]

	const status = statusOf(board, id)
	if (status !== EXPECTED[transition])
		reasons.push(`${id} is ${status}, and ${transition} needs it ${EXPECTED[transition]}`)
	if (node.claim !== null && !sameHandle(node.claim.by, options.invokedBy))
		reasons.push(`${id} is claimed by ${node.claim.by}`)
	const shared = overlaps(board.nodes, id)
	if (shared.length > 0)
		reasons.push(`active nodes share its files: ${shared.map((other) => other.id).join(', ')}`)
	if (flagsOf(board, id).flagged)
		reasons.push(`${id} is flagged: a bound decision changed after its brief was approved`)
	if (node.brief === null || node.brief.acceptance.length === 0)
		reasons.push(`${id} has no brief with an acceptance list`)

	// ADR 0056 decision 3: a run that went wrong or was turned down is the
	// human's from then on.
	if (transition === 'dispatch') {
		const failed = [...board.runs.values()].some(
			(run) => run.node === id && (run.exit === 'failed' || run.exit === 'stopped'),
		)
		if (failed) reasons.push(`${id} has a run that failed or was stopped, and auto never retries`)
		if (board.feedback.has(id)) reasons.push(`${id} was rejected before, and auto never retries`)
	}
	return reasons
}

const enforce = async (
	paths: Paths,
	id: string,
	transition: AutoTransition,
	options: AutoOptions,
): Promise<void> => {
	const reasons = await autoGate(paths, id, transition, options)
	if (reasons.length > 0) throw new AutoRefusedError(id, transition, reasons)
}

const provenance = (invokedBy: Handle): AutoProvenance => ({
	invocation: 'sober:auto',
	invokedBy,
})

/**
 * The attended approval, gated twice: once before, and once under the lock
 * that writes it, so a decision opened in between is caught (ADR 0065 §7).
 * Never queued: auto dispatches it itself, and the queue would race it.
 */
export const autoApprove = async (
	paths: Paths,
	id: string,
	options: AutoOptions,
): Promise<Node> => {
	await enforce(paths, id, 'approve', options)
	return approveBrief(paths, id, {
		by: options.invokedBy,
		queue: false,
		autonomous: provenance(options.invokedBy),
		guard: () => enforce(paths, id, 'approve', options),
	})
}

/**
 * Never `anyway` and never `attended`: nobody saw an overlap warning, and
 * nobody is there to answer the run.
 */
export const autoDispatch = async (
	paths: Paths,
	id: string,
	options: AutoOptions & Pick<DispatchOptions, 'onLine' | 'alsoStarting'>,
): Promise<Dispatched> => {
	// ponytail: dispatch holds no lock to recheck under, so a change between
	// this read and its start is caught by the next transition's gate (§7).
	await enforce(paths, id, 'dispatch', options)
	await appendEvent(paths, {
		action: 'auto.dispatched',
		node: id,
		by: options.invokedBy,
		autonomous: provenance(options.invokedBy),
	})
	return dispatch(paths, id, {
		base: options.base,
		onLine: options.onLine,
		alsoStarting: options.alsoStarting,
	})
}

export interface AutoAcceptOptions extends AutoOptions {
	readonly scan: ScanResult
	readonly ci: Checks
}

/**
 * ADR 0065 §5: only a conclusively green result. Anything short refuses and
 * leaves the node in review; rejecting it is the caller's sequencing.
 */
export const autoAccept = async (
	paths: Paths,
	id: string,
	options: AutoAcceptOptions,
): Promise<Landed> => {
	const reasons = await autoGate(paths, id, 'accept', options)
	if (options.scan !== 'clean') reasons.push(`the scan reads ${options.scan}, not clean`)
	const audit = await auditOf(paths, id)
	if (audit !== 'passed') reasons.push(`the acceptance list reads ${audit}, not passed`)
	if (options.ci.kind !== 'passing' && options.ci.kind !== 'none')
		reasons.push(`CI is ${options.ci.kind}, not passing`)
	if (reasons.length > 0) throw new AutoRefusedError(id, 'accept', reasons)

	return acceptWork(paths, id, {
		by: options.invokedBy,
		base: options.base,
		scan: options.scan,
		autonomous: provenance(options.invokedBy),
		guard: () => enforce(paths, id, 'accept', options),
	})
}
