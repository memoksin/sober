import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ZodType } from 'zod'
import { fileId } from './paths.js'

/**
 * One bad file never takes down the board (DESIGN §8.4): a record that will not
 * parse is reported by name and every other record still loads.
 */
export interface BrokenRecord {
	readonly file: string
	readonly reason: string
}

export type ReadRecord<T> =
	| { readonly kind: 'ok'; readonly file: string; readonly value: T }
	| { readonly kind: 'missing'; readonly file: string }
	| ({ readonly kind: 'broken' } & BrokenRecord)

export interface ReadRecords<T> {
	readonly records: Map<string, T>
	readonly broken: readonly BrokenRecord[]
}

const reason = (error: unknown): string =>
	error instanceof Error ? (error.message.split('\n')[0] ?? 'unreadable') : 'unreadable'

const isMissing = (error: unknown): boolean =>
	typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT'

export const readRecord = async <T>(file: string, schema: ZodType<T>): Promise<ReadRecord<T>> => {
	let text: string
	try {
		text = await readFile(file, 'utf8')
	} catch (error) {
		if (isMissing(error)) return { kind: 'missing', file }
		return { kind: 'broken', file, reason: reason(error) }
	}

	let parsed: unknown
	try {
		parsed = JSON.parse(text)
	} catch (error) {
		return { kind: 'broken', file, reason: reason(error) }
	}

	const result = schema.safeParse(parsed)
	if (!result.success) {
		const issue = result.error.issues[0]
		const at = issue && issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
		return { kind: 'broken', file, reason: `${at}${issue?.message ?? 'did not match the schema'}` }
	}
	return { kind: 'ok', file, value: result.data }
}

/** Every record in one directory, keyed by id, with the unreadable ones listed beside them. */
export const readRecords = async <T>(dir: string, schema: ZodType<T>): Promise<ReadRecords<T>> => {
	let entries: string[]
	try {
		entries = await readdir(dir)
	} catch (error) {
		if (isMissing(error)) return { records: new Map(), broken: [] }
		throw error
	}

	const records = new Map<string, T>()
	const broken: BrokenRecord[] = []
	for (const entry of entries.sort()) {
		const id = fileId(entry)
		if (id === null) continue
		const file = join(dir, entry)
		const result = await readRecord(file, schema)
		if (result.kind === 'ok') records.set(id, result.value)
		else if (result.kind === 'broken') broken.push({ file: result.file, reason: result.reason })
	}
	return { records, broken }
}
