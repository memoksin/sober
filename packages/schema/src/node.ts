import { z } from 'zod'
import { Brief } from './brief.js'
import { Handle, Id, Timestamp } from './id.js'

export const SCAN_RESULTS = ['clean', 'findings', 'did-not-run'] as const

export const ScanResult = z.enum(SCAN_RESULTS)

export type ScanResult = z.infer<typeof ScanResult>

/**
 * The record of a human accepting the result. Its presence is what makes a node
 * finished — there is no `done` boolean to forget to set (ADR 0021).
 */
export const Accepted = z.strictObject({
	by: Handle,
	at: Timestamp,
	flagged: z.boolean(),
	scan: ScanResult,
})

export type Accepted = z.infer<typeof Accepted>

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
	createdAt: Timestamp,
})

export type Node = z.infer<typeof Node>
