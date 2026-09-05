import { z } from 'zod'

/**
 * `.sober/project.json`. The version is an integer: the only reader is SOBER
 * and the only question is "newer than mine?" (ADR 0021).
 */
export const Project = z.strictObject({
	schemaVersion: z.int().positive(),
	title: z.string().min(1),
	intent: z.string(),
	constraints: z.array(z.string()),
})

export type Project = z.infer<typeof Project>

/** The version a board carries. M2 gave the node an assignee and a claim. */
export const SCHEMA_VERSION = 2
