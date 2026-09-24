import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { loadEnv } from './env.js'
import { paths } from './paths.js'

const env = { ...process.env }
let dir: string | undefined
afterEach(() => {
	process.env = { ...env }
	if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
})

test('.sober/.env fills what the shell left unset, and never overwrites the shell', () => {
	dir = mkdtempSync(join(tmpdir(), 'sober-env-'))
	const p = paths(dir)
	mkdirSync(p.sober)
	writeFileSync(p.env, 'JEV_API_KEY=from-file\nJEV_MODEL="typesafe/jev-latest"\n')
	process.env.JEV_API_KEY = 'from-shell'
	delete process.env.JEV_MODEL

	loadEnv(p)

	expect(process.env.JEV_API_KEY).toBe('from-shell')
	expect(process.env.JEV_MODEL).toBe('typesafe/jev-latest')
})

test('no .env is nothing to do', () => {
	const empty = mkdtempSync(join(tmpdir(), 'sober-env-'))
	dir = empty
	expect(() => loadEnv(paths(empty))).not.toThrow()
})
