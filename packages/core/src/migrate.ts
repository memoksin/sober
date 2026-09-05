import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Node, Project, SCHEMA_VERSION } from '@besober/schema'
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
	readonly node: (record: Record_) => Record_
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
				for (const step of steps) record = step.node(record)
				// Through the schema, so a migrated record is written in the same
				// field order as every other one. Bytes that differ by key order
				// are a whole-file diff to git and a phantom change to the merge
				// (§1.2.1). A record the migration could not make valid is written
				// back as it is and reported by the reader (§8.4).
				await writeRecord(file, canonical(Node, record))
				records += 1
			}
		}
		const current = JSON.parse(await readFile(paths.project, 'utf8')) as Record_
		await writeRecord(
			paths.project,
			canonical(Project, { ...current, schemaVersion: SCHEMA_VERSION }),
		)
		return { kind: 'migrated', from: version, to: SCHEMA_VERSION, records }
	})
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
