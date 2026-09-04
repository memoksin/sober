import { readFile } from 'node:fs/promises'
import { applyEdits, modify, type ParseError, parse as parseJsonc } from 'jsonc-parser'
import { z } from 'zod'
import type { Paths } from './paths.js'
import type { BrokenRecord } from './read.js'
import { writeAtomic } from './write.js'

/**
 * Machine settings, on the code branch (DESIGN §1.3). Project intent is board
 * state and lives in `project.json`, not here.
 *
 * `dispatch.setup`, `dispatch.verify` and `dispatch.timeoutMinutes` govern how a
 * run is prepared and judged, so from phase 2's git work on they are read from
 * the base ref rather than from the branch under review (ADR 0019). The reader
 * below is the plain one: it is correct for the lock windows and the
 * concurrency limit, and it is not what the review path calls.
 */
export const Config = z.strictObject({
	dispatch: z.strictObject({
		setup: z.string().nullable(),
		verify: z.string().nullable(),
		timeoutMinutes: z.int().positive(),
		concurrency: z.int().positive(),
		draftPr: z.boolean(),
	}),
	lock: z.strictObject({
		staleSeconds: z.int().positive(),
		waitSeconds: z.int().positive(),
	}),
})

export type Config = z.infer<typeof Config>

/** Conservative on purpose: a first dispatch should not open twelve invoices (§5.3). */
export const DEFAULT_CONFIG: Config = {
	dispatch: {
		setup: null,
		verify: null,
		timeoutMinutes: 30,
		concurrency: 3,
		draftPr: true,
	},
	lock: {
		staleSeconds: 60,
		waitSeconds: 30,
	},
}

/**
 * Every setting present at its default, with the comment that says what it is
 * (DESIGN §1.3). Written once by `initBoard`, edited by hand afterwards.
 */
export const DEFAULT_CONFIG_TEXT = `{
	// SOBER's machine settings. Project intent lives in project.json.
	"$schema": "https://besober.dev/schema/config.json",

	"dispatch": {
		// Shell command run in a fresh worktree before the agent starts.
		// null runs nothing. Read from the base ref, never from the branch
		// being worked on (ADR 0019).
		"setup": null,

		// Shell command run in the worktree when the agent finishes.
		// null runs nothing.
		"verify": null,

		// A run past this is killed and recorded as failed. Only this caps
		// how long one run burns.
		"timeoutMinutes": ${DEFAULT_CONFIG.dispatch.timeoutMinutes},

		// How many runs may burn at once. Ready nodes beyond it queue.
		"concurrency": ${DEFAULT_CONFIG.dispatch.concurrency},

		// Open the node's pull request as a draft. A draft asks nobody to
		// review anything.
		"draftPr": ${DEFAULT_CONFIG.dispatch.draftPr}
	},

	"lock": {
		// A lock whose heartbeat is older than this is broken and taken
		// over, and the takeover is reported (ADR 0025).
		"staleSeconds": ${DEFAULT_CONFIG.lock.staleSeconds},

		// A writer that cannot acquire the lock within this fails, naming
		// the action holding it. It never waits forever.
		"waitSeconds": ${DEFAULT_CONFIG.lock.waitSeconds}
	}
}
`

export type ReadConfig =
	| { readonly kind: 'ok'; readonly value: Config }
	| ({ readonly kind: 'broken' } & BrokenRecord)

/** A missing config.jsonc is the defaults; a broken one is reported, never guessed at. */
export const readConfig = async (paths: Paths): Promise<ReadConfig> => {
	let text: string
	try {
		text = await readFile(paths.config, 'utf8')
	} catch (error) {
		if ((error as { code?: string }).code === 'ENOENT') return { kind: 'ok', value: DEFAULT_CONFIG }
		return { kind: 'broken', file: paths.config, reason: (error as Error).message }
	}
	return parseConfig(paths.config, text)
}

export const parseConfig = (file: string, text: string): ReadConfig => {
	const errors: ParseError[] = []
	const parsed = parseJsonc(text, errors, { allowTrailingComma: true })
	if (errors.length > 0) return { kind: 'broken', file, reason: 'not valid JSONC' }

	// Every setting is optional in the file: a config written by an older
	// version is missing keys, and a missing key means the default.
	const merged = {
		...DEFAULT_CONFIG,
		...(parsed as Partial<Config>),
		dispatch: { ...DEFAULT_CONFIG.dispatch, ...(parsed as Partial<Config>)?.dispatch },
		lock: { ...DEFAULT_CONFIG.lock, ...(parsed as Partial<Config>)?.lock },
	}
	const { $schema: _schema, ...settings } = merged as Config & { $schema?: unknown }
	const result = Config.safeParse(settings)
	if (!result.success) {
		const issue = result.error.issues[0]
		const at = issue && issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
		return { kind: 'broken', file, reason: `${at}${issue?.message ?? 'is not a setting'}` }
	}
	return { kind: 'ok', value: result.data }
}

/**
 * The trap DESIGN §1.3 names: `JSON.stringify` would delete every comment in the
 * file. Config writes go through jsonc-parser's edits, which keep comments and
 * formatting. This is the only place in the repository where that holds, which
 * is why it is in a test and not in a comment.
 */
export const setSetting = (
	text: string,
	path: readonly (string | number)[],
	value: unknown,
): string => applyEdits(text, modify(text, [...path], value, {}))

export const writeConfig = (paths: Paths, text: string): Promise<void> =>
	writeAtomic(paths.config, text)
