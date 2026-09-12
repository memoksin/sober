import { readFile } from 'node:fs/promises'
import { applyEdits, modify, type ParseError, parse as parseJsonc } from 'jsonc-parser'
import { z } from 'zod'
import { showFromRef } from './git.js'
import type { Paths } from './paths.js'
import { SOBER_DIR } from './paths.js'
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
		host: z.string().min(1),
		setup: z.string().nullable(),
		verify: z.string().nullable(),
		timeoutMinutes: z.int().positive(),
		concurrency: z.int().positive(),
		draftPr: z.boolean(),
		accept: z.enum(['merge', 'pull-request']),
		queueByDefault: z.boolean(),
		tiers: z.strictObject({
			high: z.string().min(1).nullable().default(null),
			mid: z.string().min(1).nullable().default(null),
			low: z.string().min(1).nullable().default(null),
		}),
		thresholds: z
			.strictObject({
				mid: z.int().min(1).max(10),
				high: z.int().min(1).max(10),
			})
			.refine((t) => t.high > t.mid, { message: 'high must be above mid' }),
	}),
	board: z.strictObject({
		branch: z.string().min(1),
	}),
	scan: z.strictObject({
		extra: z.array(z.string()),
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
		host: 'claude',
		setup: null,
		verify: null,
		timeoutMinutes: 30,
		concurrency: 3,
		draftPr: true,
		accept: 'merge',
		queueByDefault: false,
		tiers: { high: null, mid: null, low: null },
		thresholds: { mid: 4, high: 8 },
	},
	board: {
		branch: 'sober-graph',
	},
	scan: {
		extra: [],
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
		// The host CLI SOBER launches headless. It is the tool you already
		// installed and logged into: SOBER never asks for an API key. This
		// is what runs a node whose tier names nothing (ADR 0058).
		"host": "${DEFAULT_CONFIG.dispatch.host}",

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

		// When a run finishes, push its branch and open the node's pull
		// request as a draft, so CI runs before a human looks. A draft asks
		// nobody to review anything, and the review stays in SOBER either
		// way (DESIGN §6.1). Needs a remote and the \`gh\` CLI; without
		// either, everything else is identical.
		"draftPr": ${DEFAULT_CONFIG.dispatch.draftPr},

		// What accepting does: "merge" lands the branch locally,
		// "pull-request" marks the draft ready and merges it on the host.
		// A protected main cannot take a local merge; a repository with no
		// remote cannot take a pull request (DESIGN §6.3).
		"accept": "${DEFAULT_CONFIG.dispatch.accept}",

		// Which approval action is offered when nobody says: false asks for
		// "approve", true asks for "approve and queue", which starts the node
		// unattended the moment it is ready. Approval stays human and per
		// node either way — this moves the starting position, not the trade
		// (ADR 0056).
		"queueByDefault": ${DEFAULT_CONFIG.dispatch.queueByDefault},

		// A tier is how hard a node's brief scores it. Each names the command
		// that runs it, the same shape as "host" — for example
		// "claude --model claude-fable-5-1" or "opencode --model minimax/m3-free".
		// null falls back to "host". Read from the base ref, never from the
		// branch being worked on (ADR 0019, ADR 0058).
		"tiers": {
			"high": null,
			"mid": null,
			"low": null
		},

		// Where the tiers split on a brief's complexity (1–10): at or above
		// "high" is the high tier, at or above "mid" is mid, below is low.
		"thresholds": {
			"mid": ${DEFAULT_CONFIG.dispatch.thresholds.mid},
			"high": ${DEFAULT_CONFIG.dispatch.thresholds.high}
		}
	},

	"board": {
		// The orphan branch the board travels on. Created by \`sober init\`,
		// and never checked out in your working copy (DESIGN §1.2).
		"branch": "${DEFAULT_CONFIG.board.branch}"
	},

	"scan": {
		// Extra scanners run in the worktree beside the bundled secretlint,
		// as commands — for example ["semgrep scan --error --quiet"]. A
		// non-zero exit is a finding; a command that is not installed is
		// reported, never silently skipped (DESIGN §6.2). Read from the base
		// ref, never from the branch under review.
		"extra": []
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

export type Tier = 'high' | 'mid' | 'low'

/** No score, no tier. */
export const tierFor = (
	thresholds: Config['dispatch']['thresholds'],
	complexity: number | null,
): Tier | null => {
	if (complexity === null) return null
	if (complexity >= thresholds.high) return 'high'
	return complexity >= thresholds.mid ? 'mid' : 'low'
}

/** `fallback` is what the run record and `sober status` report (ADR 0058). */
export const hostForTier = (
	dispatch: Config['dispatch'],
	tier: Tier,
): { host: string; fallback: boolean } => {
	const line = dispatch.tiers[tier]
	return line === null ? { host: dispatch.host, fallback: true } : { host: line, fallback: false }
}

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

/**
 * The reader ADR 0019 requires: the settings that govern how a run is prepared
 * and how its result is judged come from the base ref, not from the branch
 * being worked on. A dispatched agent can write to `config.jsonc`; read from
 * its own branch, it could rewrite the command SOBER runs on the next dispatch,
 * or relax the scan its own diff is measured by. Read from the base, that edit
 * is a diff line a human reads first.
 *
 * A base that carries no config is the defaults, exactly like a missing file.
 */
export const readConfigFromBase = async (paths: Paths, base: string): Promise<ReadConfig> => {
	const text = await showFromRef(paths.root, base, `${SOBER_DIR}/config.jsonc`)
	if (text === null) return { kind: 'ok', value: DEFAULT_CONFIG }
	return parseConfig(`${base}:${SOBER_DIR}/config.jsonc`, text)
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
		board: { ...DEFAULT_CONFIG.board, ...(parsed as Partial<Config>)?.board },
		scan: { ...DEFAULT_CONFIG.scan, ...(parsed as Partial<Config>)?.scan },
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

/**
 * Change one setting in place, keeping every comment and the shape of the file
 * around it. Both writing surfaces do the same three steps — read, modify,
 * write atomically — so they do it here rather than each holding a copy.
 */
export const applySetting = async (
	paths: Paths,
	path: readonly (string | number)[],
	value: unknown,
): Promise<void> => {
	const text = await readFile(paths.config, 'utf8')
	await writeConfig(paths, setSetting(text, path, value))
}
