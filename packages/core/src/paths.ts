import { existsSync } from 'node:fs'
import { dirname, join, parse } from 'node:path'

/** The directory every board lives in, at the root of the code repository. */
export const SOBER_DIR = '.sober'

export interface Paths {
	readonly root: string
	readonly sober: string
	readonly config: string
	readonly project: string
	readonly contributors: string
	readonly distribution: string
	readonly nodes: string
	readonly decisions: string
	readonly archive: string
	readonly archivedNodes: string
	readonly archivedDecisions: string
	readonly local: string
	readonly runs: string
	readonly feedback: string
	readonly log: string
	readonly cache: string
	readonly lock: string
	readonly merge: string
}

/** The layout of DESIGN §1.1, resolved against one project root. */
export const paths = (root: string): Paths => {
	const sober = join(root, SOBER_DIR)
	const local = join(sober, 'local')
	return {
		root,
		sober,
		config: join(sober, 'config.jsonc'),
		project: join(sober, 'project.json'),
		contributors: join(sober, 'contributors.json'),
		// The plan waiting on the board, when there is one (ADR 0051). Beside
		// the team rather than under `local/`: it is about who does what, which
		// is a property of the project rather than of this machine.
		distribution: join(sober, 'distribution.json'),
		nodes: join(sober, 'nodes'),
		decisions: join(sober, 'decisions'),
		archive: join(sober, 'archive'),
		// Two shapes never share a directory: one flat archive would report every
		// archived decision as a broken node (DESIGN §8.4).
		archivedNodes: join(sober, 'archive', 'nodes'),
		archivedDecisions: join(sober, 'archive', 'decisions'),
		local,
		runs: join(local, 'runs'),
		feedback: join(local, 'feedback'),
		log: join(local, 'log.jsonl'),
		cache: join(local, 'cache.json'),
		lock: join(local, 'lock'),
		// The choices a human made in a merge that is not finished yet. Losing
		// it loses no record — the questions are simply asked again (§1.4).
		merge: join(local, 'merge.json'),
	}
}

/** One record per file, named by its id — the id is never a field (ADR 0020). */
export const recordFile = (dir: string, id: string): string => join(dir, `${id}.json`)

/** The id a record file carries, or null for anything else in the directory. */
export const fileId = (file: string): string | null => {
	const { name, ext } = parse(file)
	return ext === '.json' && name.length > 0 ? name : null
}

/** Walks up for `.sober/`, so a command works from anywhere inside the repository. */
export const findRoot = (start: string): string | null => {
	let dir = start
	for (;;) {
		if (existsSync(join(dir, SOBER_DIR))) return dir
		const up = dirname(dir)
		if (up === dir) return null
		dir = up
	}
}
