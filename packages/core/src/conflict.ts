import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Decision, Node, Project } from '@besober/schema'
import type { ZodType } from 'zod'
import { SoberError } from './errors.js'
import { gitWithEnv } from './git.js'
import type { Paths } from './paths.js'
import { SOBER_DIR } from './paths.js'
import { writeAtomic } from './write.js'

/** Which side a human chose, for one field. */
export type Side = 'ours' | 'theirs'

/**
 * The archive question has one answer and it is not a side: "keep it archived"
 * or "put it back". Asking someone to say `ours` about a rename is asking them
 * to hold the mechanism in their head to answer a question about their work.
 */
export type ArchiveChoice = 'keep' | 'restore'

/** A field both sides changed, with the two values, so a surface can show them. */
export interface FieldConflict {
	readonly field: string
	readonly ours: string
	readonly theirs: string
}

/**
 * One conflicted record. `fields` is the ordinary case — both people edited the
 * same record, and only the fields they both touched are a question.
 * `archived` is the other kind ADR 0013 names: archiving is a rename, so a
 * record archived on one side and edited on the other is not a field question
 * at all.
 */
export type Conflict =
	| {
			readonly kind: 'fields'
			readonly path: string
			readonly id: string
			readonly fields: readonly FieldConflict[]
	  }
	| {
			readonly kind: 'archived'
			readonly path: string
			readonly id: string
			/** Who archived it. The other side is the one still editing. */
			readonly by: Side
	  }

/** The choices a human made for one record: by field, or the single archive choice. */
export type Choices = Readonly<Record<string, Side | ArchiveChoice>>

/** The one pseudo-field an archived record has, so both kinds carry one shape. */
export const ARCHIVE_FIELD = 'record'

const SCHEMAS: readonly (readonly [string, ZodType])[] = [
	[`${SOBER_DIR}/nodes/`, Node],
	[`${SOBER_DIR}/decisions/`, Decision],
	[`${SOBER_DIR}/archive/nodes/`, Node],
	[`${SOBER_DIR}/archive/decisions/`, Decision],
	[`${SOBER_DIR}/project.json`, Project],
]

const schemaFor = (path: string): ZodType | null =>
	SCHEMAS.find(([prefix]) => path.startsWith(prefix))?.[1] ?? null

/** The record id a board path carries — the file name is the id (ADR 0020). */
export const idOf = (path: string): string =>
	path
		.split('/')
		.pop()
		?.replace(/\.json$/, '') ?? path

/**
 * Every record the merge could not settle by itself, in the order a person
 * should be asked about them. Anything git resolved on its own is not here:
 * with one file per entity, that is most of what two people do in a day.
 */
export const conflictsOf = async (
	paths: Paths,
	index: string,
	unmerged: readonly string[],
): Promise<Conflict[]> => {
	const conflicts: Conflict[] = []
	for (const path of [...unmerged].sort()) {
		const [base, ours, theirs] = await stagesOf(paths.root, index, path)
		const id = idOf(path)

		// One side has no version of the record at all: it was archived there,
		// which is a delete here and an add under `archive/`.
		if (ours === null || theirs === null) {
			conflicts.push({ kind: 'archived', path, id, by: ours === null ? 'ours' : 'theirs' })
			continue
		}

		const fields = fieldsInConflict(path, base, ours, theirs)
		// Both sides wrote the same bytes through different histories: nothing
		// to ask, and `merge` will take either.
		if (fields.length === 0) continue
		conflicts.push({ kind: 'fields', path, id, fields })
	}
	return conflicts
}

/**
 * The three versions git kept: `:1:` the merge base, `:2:` ours, `:3:` theirs
 * (ADR 0013). They come from the index and never from the working tree, which
 * still holds our copy untouched — that is what `merge=binary` bought.
 *
 * A missing stage is not an error: a record added on both sides has no base, and
 * a record archived on one side has no version on that side at all.
 */
export const stagesOf = async (
	root: string,
	index: string,
	path: string,
): Promise<[string | null, string | null, string | null]> => {
	const read = async (stage: number): Promise<string | null> => {
		try {
			return await gitWithEnv(root, { GIT_INDEX_FILE: index }, ['show', `:${stage}:${path}`])
		} catch {
			return null
		}
	}
	return [await read(1), await read(2), await read(3)]
}

const parse = (path: string, text: string | null): Record<string, unknown> => {
	if (text === null) return {}
	try {
		const value: unknown = JSON.parse(text)
		if (value === null || typeof value !== 'object' || Array.isArray(value))
			throw new Error('not a record')
		return value as Record<string, unknown>
	} catch {
		throw new SoberError('git', `${path} in the merge is not a record SOBER can read`)
	}
}

const same = (left: unknown, right: unknown): boolean =>
	JSON.stringify(left ?? null) === JSON.stringify(right ?? null)

const show = (value: unknown): string => (value === undefined ? '(not set)' : JSON.stringify(value))

/**
 * A field only one side changed is taken, and only a field both sides changed
 * is a question (DESIGN §1.2.1). Fields are the top level of the record: a
 * brief is one value, because "which of these two briefs" is a question a
 * person can answer and "which `acceptance[2].run`" is not.
 */
export const fieldsInConflict = (
	path: string,
	baseText: string | null,
	oursText: string,
	theirsText: string,
): FieldConflict[] => {
	const base = parse(path, baseText)
	const ours = parse(path, oursText)
	const theirs = parse(path, theirsText)

	const found: FieldConflict[] = []
	for (const field of [...new Set([...Object.keys(ours), ...Object.keys(theirs)])].sort()) {
		if (same(ours[field], theirs[field])) continue
		if (same(ours[field], base[field]) || same(theirs[field], base[field])) continue
		found.push({ field, ours: show(ours[field]), theirs: show(theirs[field]) })
	}
	return found
}

/**
 * The record the human's choices produce. Fields nobody had to choose about are
 * merged the same way they were classified, so the result carries both people's
 * work — which is the whole reason the question is field-level and not
 * record-level.
 */
export const mergeRecord = (
	path: string,
	baseText: string | null,
	oursText: string,
	theirsText: string,
	choices: Choices,
): string => {
	const base = parse(path, baseText)
	const ours = parse(path, oursText)
	const theirs = parse(path, theirsText)

	const merged: Record<string, unknown> = {}
	for (const field of [...new Set([...Object.keys(ours), ...Object.keys(theirs)])]) {
		const taken = pick(field, base, ours, theirs, choices)
		if (taken !== undefined) merged[field] = taken
	}

	const schema = schemaFor(path)
	if (schema === null) return record(merged)

	const result = schema.safeParse(merged)
	if (!result.success)
		throw new SoberError(
			'git',
			`merging ${idOf(path)} would produce a record SOBER cannot read: ${result.error.issues[0]?.message ?? 'invalid'} — fix the record by hand and sync again`,
		)
	// The parsed value, not the merged one: Zod builds it in the schema's key
	// order, so a merged record and a written one are the same bytes and the
	// next sync sees no change.
	return record(result.data)
}

/** Records are JSON, tab-indented, newline-terminated — exactly `writeRecord`. */
const record = (value: unknown): string => `${JSON.stringify(value, null, '\t')}\n`

const pick = (
	field: string,
	base: Record<string, unknown>,
	ours: Record<string, unknown>,
	theirs: Record<string, unknown>,
	choices: Choices,
): unknown => {
	if (same(ours[field], theirs[field])) return ours[field]
	if (same(ours[field], base[field])) return theirs[field]
	if (same(theirs[field], base[field])) return ours[field]
	const chosen = choices[field]
	if (chosen !== 'ours' && chosen !== 'theirs')
		throw new SoberError('git', `nobody chose a value for ${field} — that is not SOBER's to pick`)
	return chosen === 'ours' ? ours[field] : theirs[field]
}

/**
 * Applies one resolved record to the merge index: the merged bytes go into the
 * working tree at their real path, and the index entry replaces all three
 * unmerged stages with one. A record whose archive was kept is removed instead.
 */
export const settle = async (
	paths: Paths,
	index: string,
	path: string,
	contents: string | null,
): Promise<void> => {
	const file = join(paths.root, ...path.split('/'))
	const env = { GIT_INDEX_FILE: index }
	// An unmerged path carries three entries. Removing them first is what turns
	// the next `--add` into a resolution rather than a fourth stage.
	await gitWithEnv(paths.root, env, ['update-index', '--force-remove', '--', path])
	if (contents === null) {
		await rm(file, { force: true })
		return
	}
	await writeAtomic(file, contents)
	await gitWithEnv(paths.root, env, ['update-index', '--add', '--', path])
}

/** Where an archived record's other half lives, so restoring can remove it. */
export const archivePathOf = (path: string): string =>
	path.startsWith(`${SOBER_DIR}/archive/`)
		? path.replace(`${SOBER_DIR}/archive/`, `${SOBER_DIR}/`)
		: path.replace(`${SOBER_DIR}/`, `${SOBER_DIR}/archive/`)
