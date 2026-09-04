import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Project } from '@besober/schema'
import { SCHEMA_VERSION } from '@besober/schema'
import { DEFAULT_CONFIG_TEXT, writeConfig } from './config.js'
import type { Paths } from './paths.js'
import { paths as resolvePaths } from './paths.js'
import { readProject, writeProject } from './records.js'
import { writeAtomic } from './write.js'

/**
 * The board is gitignored on the code branch and reaches teammates through the
 * board branch (DESIGN §1.2). config.jsonc is the exception: it is machine
 * settings for this repository, so it is tracked here.
 */
export const GITIGNORE_BLOCK = `# SOBER: the board travels on its own branch, and local/ is disposable.
.sober/*
!.sober/config.jsonc
`

export interface InitResult {
	readonly paths: Paths
	/** False when a board was already here — init never overwrites one. */
	readonly created: boolean
}

/**
 * Creates `.sober/` in a repository that has none. Idempotent: run twice, the
 * second run reports the board it found and changes nothing.
 */
export const initBoard = async (
	root: string,
	project: Omit<Project, 'schemaVersion'>,
): Promise<InitResult> => {
	const paths = resolvePaths(root)
	const existing = await readProject(paths)
	if (existing.kind !== 'missing') return { paths, created: false }

	for (const dir of [paths.nodes, paths.decisions, paths.archive, paths.runs]) {
		await mkdir(dir, { recursive: true })
	}
	await writeConfig(paths, DEFAULT_CONFIG_TEXT)
	await writeProject(paths, { schemaVersion: SCHEMA_VERSION, ...project })
	await ensureGitignore(root)
	return { paths, created: true }
}

/** Nothing else in the design works without these entries (DESIGN §1.2). */
export const ensureGitignore = async (root: string): Promise<void> => {
	const file = join(root, '.gitignore')
	let current = ''
	try {
		current = await readFile(file, 'utf8')
	} catch (error) {
		if ((error as { code?: string }).code !== 'ENOENT') throw error
	}
	if (current.includes('.sober/*')) return
	const separator = current.length === 0 || current.endsWith('\n') ? '' : '\n'
	await writeAtomic(
		file,
		`${current}${separator}${current.length === 0 ? '' : '\n'}${GITIGNORE_BLOCK}`,
	)
}
