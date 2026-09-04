import { z } from 'zod'
import { Id, Timestamp } from './id.js'

export const RUN_EXITS = ['finished', 'stopped', 'failed'] as const

export const RunExit = z.enum(RUN_EXITS)

export type RunExit = z.infer<typeof RunExit>

/**
 * The result of one command. `null` in place of this record means the command
 * did not run — never that it passed, the rule ADR 0021 applies to the scan.
 */
export const CommandResult = z.strictObject({ exit: z.int() })

export type CommandResult = z.infer<typeof CommandResult>

/**
 * `.sober/local/runs/<runid>.json`. Small on purpose: raw agent output goes to
 * `<runid>.log`, so a run killed mid-write leaves a torn log line and never a
 * torn record (ADR 0021).
 *
 * `acceptance` is parallel to the brief's criteria, by index (ADR 0027).
 */
export const Run = z.strictObject({
	node: Id,
	host: z.string().min(1),
	branch: z.string().min(1),
	worktree: z.string().min(1),
	startedAt: Timestamp,
	endedAt: Timestamp.nullable(),
	exit: RunExit.nullable(),
	error: z.string().nullable(),
	verify: CommandResult.nullable(),
	acceptance: z.array(CommandResult.nullable()),
})

export type Run = z.infer<typeof Run>
