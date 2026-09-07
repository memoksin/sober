import { z } from 'zod'
import { Brief } from './brief.js'
import { Handle, Id, Timestamp } from './id.js'

export const SCAN_RESULTS = ['clean', 'findings', 'did-not-run'] as const

export const ScanResult = z.enum(SCAN_RESULTS)

export type ScanResult = z.infer<typeof ScanResult>

/**
 * How the acceptance list read at the moment it was accepted (ADR 0049).
 * `did-not-run` covers both halves of the scan's rule: a criterion nobody could
 * run, and a node accepted before anything had judged it. `none` is a node that
 * asked for nothing, which is a different sentence and deserves its own word.
 */
export const AuditResult = z.enum(['passed', 'failed', 'did-not-run', 'none'])

export type AuditResult = z.infer<typeof AuditResult>

/**
 * The record of a human accepting the result. Its presence is what makes a node
 * finished — there is no `done` boolean to forget to set (ADR 0021).
 *
 * `scan` and `audit` are both recorded as they read at that moment rather than
 * looked up later. The run record they came from is local and disposable
 * (§5.5), so without this a teammate who clones the board a week later can see
 * that the work was accepted and nothing about what was true when it was.
 */
export const Accepted = z.strictObject({
	by: Handle,
	at: Timestamp,
	flagged: z.boolean(),
	scan: ScanResult,
	audit: AuditResult,
})

export type Accepted = z.infer<typeof Accepted>

/**
 * A flag, judged and set aside (DESIGN §7.2). The reason is the record: "the
 * answer changed and this node is fine anyway" is a judgement, and §7.2 says it
 * is kept rather than lost.
 *
 * `at` is a watermark, not a switch. The flag is derived from two timestamps
 * (§2.8), so a dismissal settles the change it was written against and a later
 * answer to the same decision flags the node again — which is the case §2.8's
 * whole argument is about: a change nothing on the board knew about.
 *
 * Git-tracked rather than local, because the flag is git-tracked. Derived on
 * every clone from records every clone holds, a dismissal kept in `local/`
 * would leave every teammate re-judging a change one of them already judged.
 */
export const Dismissal = z.strictObject({
	by: Handle,
	at: Timestamp,
	reason: z.string().min(1),
})

export type Dismissal = z.infer<typeof Dismissal>

/** Who is actually working on a node, and since when (DESIGN §3.3). */
export const Claim = z.strictObject({
	by: Handle,
	at: Timestamp,
})

export type Claim = z.infer<typeof Claim>

/**
 * `.sober/nodes/<id>.json`. Every field is a stored fact: status is derived
 * (DESIGN §3.2) and so is a canvas position (ADR 0016). There is no
 * `updatedAt` — "when did this change" is `git log` on the file (ADR 0020).
 *
 * The object is strict, so a board written by a newer SOBER fails loudly here
 * instead of being quietly rewritten without the fields it holds (ADR 0020).
 */
export const Node = z.strictObject({
	title: z.string().min(1),
	description: z.string(),
	notes: z.string(),
	dependsOn: z.array(Id),
	decisions: z.array(Id),
	// A prediction, refined when the brief is rendered — not a contract enforced
	// before the work runs. Plain globs, matched by picomatch (ADR 0021).
	files: z.array(z.string().min(1)),
	brief: Brief.nullable(),
	outcome: z.string().nullable(),
	// Assignment is a plan, a claim is a fact — two questions, two fields
	// (DESIGN §3.3). A claim is a signal, never a lock (D23, ADR 0005).
	assignee: Handle.nullable(),
	claim: Claim.nullable(),
	accepted: Accepted.nullable(),
	// §7.2's first action. Beside `accepted` rather than inside it: a flag can
	// be dismissed on a node that is still `in-review`, and §2.8 is explicit
	// that the flag is not only a finished node's.
	dismissal: Dismissal.nullable(),
	createdAt: Timestamp,
})

export type Node = z.infer<typeof Node>
