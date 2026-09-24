import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import type { Paths } from './paths.js'

/**
 * `.sober/.env` is where a person keeps the keys the board's settings name,
 * so neither `sober` nor the host that spawns `sober mcp` needs a shell that
 * was restarted with them. The shell still wins: a variable already set is
 * never overwritten, which is also what `node --env-file` does.
 */
export const loadEnv = (paths: Paths): void => {
	let text: string
	try {
		text = readFileSync(paths.env, 'utf8')
	} catch (error) {
		if ((error as { code?: string }).code === 'ENOENT') return
		throw error
	}
	for (const [name, value] of Object.entries(parseEnv(text)))
		if (process.env[name] === undefined) process.env[name] = value
}
