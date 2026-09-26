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
	/**
	 * Whether a human was watching this one, and could therefore be asked
	 * (ADR 0046). It decides what the host was launched with, so it is a fact
	 * about the run rather than a preference: an attended run has an open stdin
	 * and a system prompt saying somebody is there, and a headless one is told
	 * the opposite.
	 *
	 * Defaulted rather than required, because a run record written before this
	 * existed is still a run record and this file is read, not migrated (§5.5).
	 */
	attended: z.boolean().default(false),
	/**
	 * What chose the line: a tier's name (ADR 0058) or a `dispatch.models`
	 * entry's (ADR 0061), null for a node nothing scored. `host` stays the exact
	 * line that ran; `fallback` says it was `dispatch.host` because the tier
	 * named none or no entry covered the score. A string rather than an enum so
	 * records from before the list still read. Defaulted like `attended`.
	 */
	tier: z.string().nullable().default(null),
	fallback: z.boolean().default(false),
	/**
	 * The line that stands in when the primary cannot start or stops on a spent
	 * limit before its first tool call, null when none qualified. `ran` says
	 * which of the two did the work, so `host` above is still the exact line
	 * that ran; `fellBack` is the primary's reason when it was the backup.
	 * Defaulted like `attended`: this file is read, not migrated (§5.5), so a
	 * record from before them reads as the primary with no backup.
	 */
	backup: z.string().nullable().default(null),
	ran: z.enum(['primary', 'backup']).default('primary'),
	fellBack: z.string().nullable().default(null),
	/**
	 * The host's own session or thread id, which a retry resumes instead of
	 * starting cold. Null when the host named none. Defaulted like `attended`.
	 */
	session: z.string().nullable().default(null),
	/** The reasoning effort the host was launched with, null when none was passed. */
	effort: z.string().nullable().default(null),
	/**
	 * What the host said it spent, where it says so. Each part is null when the
	 * host does not report it. `contextPeak` is the largest single-turn context.
	 */
	usage: z
		.strictObject({
			turns: z.int().nullable(),
			contextPeak: z.int().nullable(),
			cost: z.number().nullable(),
		})
		.nullable()
		.default(null),
})

export type Run = z.infer<typeof Run>
