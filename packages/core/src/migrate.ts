import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Contributors, Node, Project, SCHEMA_VERSION } from '@besober/schema'
import { SoberError } from './errors.js'
import { withLock } from './lock.js'
import type { Paths } from './paths.js'
import { fileId } from './paths.js'
import { readProject } from './records.js'
import { writeRecord } from './write.js'

type Record_ = { [field: string]: unknown }

interface Migration {
	readonly to: number
	/** Applied to every node on the board and in the archive, as raw JSON. */
	readonly node?: (record: Record_) => Record_
	/** Applied to every entry in the team file, when there is one. */
	readonly contributor?: (record: Record_) => Record_
}

/**
 * One entry per version step. A migration reads raw JSON rather than a parsed
 * record: the schema it is moving away from is, by then, the one this build no
 * longer has.
 */
const MIGRATIONS: readonly Migration[] = [
	{
		to: 2,
		// M2 gave the node an assignee and a claim (DESIGN §3.1). On a board
		// written before the team existed nobody was assigned anything, and the
		// spread order leaves a value already there alone.
		node: (record) => ({ assignee: null, claim: null, ...record }),
	},
	{
		to: 3,
		// M3 gave the node a dismissal (DESIGN §7.2). Nothing was ever dismissed
		// on a board written before the flag had actions, so every node starts
		// with the flag unjudged.
		node: (record) => ({ dismissal: null, ...record }),
	},
	{
		to: 4,
		// The auditor gave the `accepted` record how the acceptance list read
		// (ADR 0049). On a board written before anything ran that list, nobody
		// knows — which is exactly what `did-not-run` says, and is why it is not
		// backfilled as `passed`.
		node: (record) => {
			const accepted = record.accepted as Record_ | null | undefined
			if (accepted === null || accepted === undefined) return record
			return { ...record, accepted: { audit: 'did-not-run', ...accepted } }
		},
	},
	{
		to: 5,
		// A contributor's focus became a list, so a distribution can be matched
		// against it entry by entry (ADR 0051). The words are split and kept as
		// they were written: inventing globs out of "core, cli" would be guessing
		// at what somebody meant, and emptying the field would lose it.
		contributor: (record) => {
			if (typeof record.focus !== 'string') return record
			const written = record.focus
				.split(',')
				.map((part) => part.trim())
				.filter((part) => part !== '')
			return { ...record, focus: written }
		},
	},
]

export type Migrated =
	| { readonly kind: 'current' }
	| { readonly kind: 'no-board' }
	| {
			readonly kind: 'migrated'
			readonly from: number
			readonly to: number
			readonly records: number
	  }

/**
 * D42, both directions. A newer SOBER migrates an older board; an older SOBER
 * refuses a newer one, because a version that does not understand a field drops
 * it on the next write — and on a shared board that is silent data loss for
 * everyone else (DESIGN §8.5).
 */
export const migrateBoard = async (paths: Paths): Promise<Migrated> => {
	const project = await readProject(paths)
	if (project.kind === 'missing') return { kind: 'no-board' }

	// A board too new to parse is exactly the board that must not be written, so
	// the version is read from the raw file rather than through the schema.
	const version = await versionOf(paths)
	if (version === null) return { kind: 'no-board' }
	if (version > SCHEMA_VERSION)
		throw new SoberError(
			'schema',
			`this board was written by a newer SOBER (schema ${version}, this one reads ${SCHEMA_VERSION}) — upgrade SOBER before opening it`,
		)
	if (version === SCHEMA_VERSION) return { kind: 'current' }

	return withLock(paths, 'migrate', async () => {
		const steps = MIGRATIONS.filter((migration) => migration.to > version)
		let records = 0
		for (const dir of [paths.nodes, paths.archivedNodes]) {
			for (const file of await jsonFiles(dir)) {
				let record = JSON.parse(await readFile(file, 'utf8')) as Record_
				for (const step of steps) record = step.node?.(record) ?? record
				// Through the schema, so a migrated record is written in the same
				// field order as every other one. Bytes that differ by key order
				// are a whole-file diff to git and a phantom change to the merge
				// (§1.2.1). A record the migration could not make valid is written
				// back as it is and reported by the reader (§8.4).
				await writeRecord(file, canonical(Node, record))
				records += 1
			}
		}
		records += await migrateTeam(paths, steps)

		const current = JSON.parse(await readFile(paths.project, 'utf8')) as Record_
		await writeRecord(
			paths.project,
			canonical(Project, { ...current, schemaVersion: SCHEMA_VERSION }),
		)
		return { kind: 'migrated', from: version, to: SCHEMA_VERSION, records }
	})
}

/**
 * The team file, when the board has one. One record holding a list rather than
 * a directory of them, so it is counted as the single record it is.
 *
 * A file nobody can parse is left alone: rewriting it is how a board with one
 * bad line loses the whole team, and the reader already reports it (§8.4).
 */
const migrateTeam = async (paths: Paths, steps: readonly Migration[]): Promise<number> => {
	if (!steps.some((step) => step.contributor !== undefined)) return 0

	let current: { contributors?: unknown }
	try {
		current = JSON.parse(await readFile(paths.contributors, 'utf8')) as { contributors?: unknown }
	} catch {
		return 0
	}
	if (!Array.isArray(current.contributors)) return 0

	const contributors = (current.contributors as Record_[]).map((person) =>
		steps.reduce((record, step) => step.contributor?.(record) ?? record, person),
	)
	await writeRecord(paths.contributors, canonical(Contributors, { ...current, contributors }))
	return 1
}

const canonical = <T>(
	schema: { safeParse: (value: unknown) => { success: boolean; data?: T } },
	record: Record_,
): unknown => {
	const parsed = schema.safeParse(record)
	return parsed.success ? parsed.data : record
}

const versionOf = async (paths: Paths): Promise<number | null> => {
	try {
		const raw = JSON.parse(await readFile(paths.project, 'utf8')) as { schemaVersion?: unknown }
		return typeof raw.schemaVersion === 'number' ? raw.schemaVersion : null
	} catch {
		return null
	}
}

const jsonFiles = async (dir: string): Promise<string[]> => {
	try {
		return (await readdir(dir))
			.filter((entry) => fileId(entry) !== null)
			.sort()
			.map((entry) => join(dir, entry))
	} catch {
		return []
	}
}

/**
 * For a surface that cannot report a rewrite where the human will see it. The
 * MCP server reads the board inside a session and may not write to stdout, so
 * it asks this first and points at the surface that can (§2.9's pattern).
 */
export const needsMigration = async (paths: Paths): Promise<boolean> => {
	const version = await versionOf(paths)
	if (version === null) return false
	if (version > SCHEMA_VERSION)
		throw new SoberError(
			'schema',
			`this board was written by a newer SOBER (schema ${version}, this one reads ${SCHEMA_VERSION}) — upgrade SOBER before opening it`,
		)
	return version < SCHEMA_VERSION
}
