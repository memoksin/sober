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

test('the guard is declared on the spawn, and announces itself at the start', () => {
	const hooks = read('hooks/hooks.json') as {
		hooks: Record<string, { matcher?: string; hooks: { type: string; command: string }[] }[]>
	}

	// `Task` is the agent spawn. Anything else here would be a guard on the
	// wrong event, which is a guard that is never reached.
	const spawn = hooks.hooks.PreToolUse?.[0]
	expect(spawn?.matcher).toBe('Task')
	expect(spawn?.hooks).toEqual([{ type: 'command', command: 'sober hook spawn' }])

	// A guard that is not installed is silent, and silence reads as permission
	// — so the installed one says so at the start of every session (ADR 0029).
	expect(hooks.hooks.SessionStart?.[0]?.hooks).toEqual([
		{ type: 'command', command: 'sober hook session' },
	])

	// `sober` off the PATH, the same binary `.mcp.json` names: one install.
	for (const event of Object.values(hooks.hooks))
		for (const entry of event)
			for (const one of entry.hooks) expect(one.command.startsWith('sober ')).toBe(true)
})

test('every skill carries the description the model decides on', () => {
	const skills = readdirSync(join(plugin, 'skills'))
	expect(skills.sort()).toEqual(['decide', 'loop', 'next', 'plan'])

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
	for (const skill of ['plan', 'decide', 'next', 'loop']) {
		const text = readFileSync(join(plugin, 'skills', skill, 'SKILL.md'), 'utf8')
		expect(text, skill).toContain('MCP server')
		expect(text, skill).toMatch(/never reproduce|do not shell out/i)
	}
})
