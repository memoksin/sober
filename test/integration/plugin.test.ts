import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

/**
 * The plugin is data, not code: nothing typechecks it and nothing imports it,
 * so a renamed directory or a dropped field is only found by a human starting
 * a session. These are the checks that would have caught each one.
 */
const root = fileURLToPath(new URL('../../', import.meta.url))
const plugin = join(root, 'packages/claude-code-plugin')
const read = (file: string) => JSON.parse(readFileSync(join(plugin, file), 'utf8'))

test('the manifest names the plugin, and the marketplace points at it', () => {
	expect(read('.claude-plugin/plugin.json')).toMatchObject({ name: 'sober' })

	const marketplace = JSON.parse(
		readFileSync(join(root, '.claude-plugin/marketplace.json'), 'utf8'),
	) as { plugins: { name: string; source: string }[] }
	const entry = marketplace.plugins.find((one) => one.name === 'sober')
	expect(entry?.source).toBe('./packages/claude-code-plugin')
	// A source path that does not resolve installs an empty plugin, silently.
	expect(readdirSync(join(root, entry?.source ?? ''))).toContain('.claude-plugin')
})

test('the server it declares is the one the CLI publishes', () => {
	// `sober` off the PATH, which is what `npm i -g @besober/cli` puts there
	// (`PR-00-01`) — not a path into anyone's checkout.
	expect(read('.mcp.json')).toEqual({ mcpServers: { sober: { command: 'sober', args: ['mcp'] } } })
})

test('every skill carries the description the model decides on', () => {
	const skills = readdirSync(join(plugin, 'skills'))
	// `brief` is M3's gate finding 5: step 5 of the loop is the third thing a
	// human asks a session for, and it had no command of its own.
	expect(skills.sort()).toEqual(['brief', 'decide', 'loop', 'next', 'plan'])

	for (const skill of skills) {
		const text = readFileSync(join(plugin, 'skills', skill, 'SKILL.md'), 'utf8')
		expect(text.startsWith('---\n'), `${skill} has no frontmatter`).toBe(true)
		const frontmatter = text.slice(4).split('\n---')[0] ?? ''
		// Without it the skill is never chosen, and never says so.
		expect(frontmatter, `${skill} has no description`).toContain('description:')
	}
})

test('every invocable skill says the tools are tools', () => {
	// The M1 gate caught a host reconstructing the board in bash — "Mock the
	// board output since we can't call MCP from bash" — and handing the user
	// invented ids. The instruction against it has to be in every entry point,
	// because a weaker model reads one skill and not the others.
	for (const skill of ['plan', 'decide', 'brief', 'next', 'loop']) {
		const text = readFileSync(join(plugin, 'skills', skill, 'SKILL.md'), 'utf8')
		expect(text, skill).toContain('MCP server')
		expect(text, skill).toMatch(/never reproduce|do not shell out/i)
	}
})
