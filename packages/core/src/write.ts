import { randomBytes } from 'node:crypto'
import { mkdir, open, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * The one write in `core` (DESIGN §1.1): a temp file beside the target, fsynced,
 * then renamed over it. A process that dies mid-write leaves the old file whole
 * instead of half of the new one. Nothing else calls a bare write — the append
 * to the run log (§1.4) is the single documented exception.
 */
export const writeAtomic = async (file: string, contents: string): Promise<void> => {
	await mkdir(dirname(file), { recursive: true })
	const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`
	const handle = await open(temp, 'wx')
	try {
		await handle.writeFile(contents, 'utf8')
		await handle.sync()
	} finally {
		await handle.close()
	}
	await rename(temp, file)
}

/** Records are JSON, tab-indented, newline-terminated — a diff a human can read. */
export const writeRecord = (file: string, record: unknown): Promise<void> =>
	writeAtomic(file, `${JSON.stringify(record, null, '\t')}\n`)

/** The log's append (DESIGN §1.4). A torn last line is §8.4's problem, not a crash. */
export const appendLine = async (file: string, line: string): Promise<void> => {
	await mkdir(dirname(file), { recursive: true })
	await writeFile(file, `${line}\n`, { encoding: 'utf8', flag: 'a' })
}
