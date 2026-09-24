/**
 * The scan reads the **added lines of the diff**, not the worktree (ADR 0011).
 * Scanning the worktree reports everything already in the repository and makes
 * the review screen useless — `PR-09-07` covers what is already there.
 *
 * A unified diff is parsed rather than asking git for the lines directly,
 * because the line numbers have to survive: a finding without one sends the
 * reader hunting through a file for a string that has been masked.
 */
export interface AddedLine {
	readonly number: number
	readonly text: string
}

export interface AddedFile {
	readonly path: string
	readonly lines: readonly AddedLine[]
}

const FILE = /^\+\+\+ (?:b\/)?(.+)$/
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/

export const addedLines = (diff: string): readonly AddedFile[] => {
	const files: AddedFile[] = []
	let lines: AddedLine[] = []
	let path: string | null = null
	let next = 0

	const close = () => {
		if (path !== null && lines.length > 0) files.push({ path, lines })
		lines = []
	}

	// `\r` is stripped rather than split on: git writes CRLF on Windows and a
	// path or a line ending in one matches nothing a caller compares it to.
	for (const line of diff.replace(/\r/g, '').split('\n')) {
		const file = FILE.exec(line)
		if (file?.[1] !== undefined) {
			close()
			// `/dev/null` is a deletion: it has no added lines, and no path a
			// reader could open.
			path = file[1] === '/dev/null' ? null : file[1]
			continue
		}

		const hunk = HUNK.exec(line)
		if (hunk?.[1] !== undefined) {
			next = Number.parseInt(hunk[1], 10)
			continue
		}

		if (path === null) continue
		if (line.startsWith('+')) lines.push({ number: next++, text: line.slice(1) })
		else if (!line.startsWith('-') && !line.startsWith('\\')) next++
	}

	close()
	return files
}
