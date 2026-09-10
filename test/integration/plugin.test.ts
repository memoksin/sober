import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

/**
 * The plugins are data, not code: nothing typechecks them and nothing imports
 * them, so a renamed directory or a dropped field is only found by a human
 * starting a session. These are the checks that would have caught each one.
 *
 * There are four of them now, and the prose in them is one source
 * (`plugins/skills/`) rendered per host by `scripts/build-plugins.mjs`. That is
 * what the drift check below is for: a generated file edited in place looks
 * right until the next build silently reverts it.
 */
const root = fileURLToPath(new URL('../../', import.meta.url))
const read = (file: string) => JSON.parse(readFileSync(join(root, file), 'utf8'))

const { SKILL_DIRS, buildSkills } = (await import(join(root, 'scripts/build-plugins.mjs'))) as {
	SKILL_DIRS: Record<string, string>
	buildSkills: (host: string) => Map<string, string>
}

const SKILLS = ['brief', 'decide', 'distribute', 'loop', 'next', 'plan']

test('the Claude Code manifest names the plugin, and the marketplace points at it', () => {
	expect(read('packages/claude-code-plugin/.claude-plugin/plugin.json')).toMatchObject({
		name: 'sober',
	})

	const marketplace = read('.claude-plugin/marketplace.json') as {
		plugins: { name: string; source: string }[]
	}
	const entry = marketplace.plugins.find((one) => one.name === 'sober')
	expect(entry?.source).toBe('./packages/claude-code-plugin')
	// A source path that does not resolve installs an empty plugin, silently.
	expect(readdirSync(join(root, entry?.source ?? ''))).toContain('.claude-plugin')
})

test('the Codex manifest names the plugin and says where its skills are', () => {
	// Codex reads `.codex-plugin/plugin.json` and the `skills` path in it. A
	// plugin with no `skills` entry installs and teaches nothing.
	expect(read('packages/codex-plugin/.codex-plugin/plugin.json')).toMatchObject({
		name: 'sober',
		skills: './skills/',
	})
	expect(readdirSync(join(root, 'packages/codex-plugin/skills')).sort()).toEqual(SKILLS)
})

test('the Cursor manifest names the plugin, and its components sit where Cursor looks', () => {
	// A Cursor Plugin manifest requires only a name; skills and the MCP server
	// are discovered from their default directories rather than named in it.
	// That is why the directory layout is the assertion here and the manifest
	// is not — a renamed `skills/` installs a plugin that teaches nothing.
	expect(read('packages/cursor-plugin/.cursor-plugin/plugin.json')).toMatchObject({
		name: 'sober',
	})
	expect(readdirSync(join(root, 'packages/cursor-plugin/skills')).sort()).toEqual(SKILLS)
})

test('every host declares the server the CLI publishes, in that host’s own format', () => {
	// `sober` off the PATH, which is what `npm i -g @besober/cli` puts there
	// (`PR-00-01`) — not a path into anyone's checkout.
	const server = { command: 'sober', args: ['mcp'] }
	expect(read('packages/claude-code-plugin/.mcp.json')).toEqual({ mcpServers: { sober: server } })
	expect(read('packages/codex-plugin/.mcp.json')).toEqual({ mcpServers: { sober: server } })
	// Cursor spells it the same way and keeps it unhidden, beside the manifest.
	expect(read('packages/cursor-plugin/mcp.json')).toEqual({ mcpServers: { sober: server } })

	// OpenCode spells the same thing differently: one array, and a `type` that
	// says the server is a process rather than a URL.
	expect(read('packages/opencode-plugin/opencode.json')).toMatchObject({
		mcp: { sober: { type: 'local', command: ['sober', 'mcp'], enabled: true } },
	})
})

test('what is on disk is what the source builds, for every host', () => {
	// The generated files are committed, because a plugin is installed by
	// copying a directory and nobody runs a build to do that. This is the check
	// that they are current — the alternative is a plugin that ships last
	// month's refusals.
	for (const [host, dir] of Object.entries(SKILL_DIRS)) {
		for (const [skill, text] of buildSkills(host)) {
			const file = join(dir, skill, 'SKILL.md')
			expect(
				readFileSync(join(root, file), 'utf8'),
				`${file} is stale — run \`pnpm plugins\``,
			).toBe(text)
		}
	}
})

test('every skill in every host carries the description the model decides on', () => {
	for (const [host, dir] of Object.entries(SKILL_DIRS)) {
		expect(readdirSync(join(root, dir)).sort(), host).toEqual(SKILLS)
		for (const skill of SKILLS) {
			const text = readFileSync(join(root, dir, skill, 'SKILL.md'), 'utf8')
			expect(text.startsWith('---\n'), `${host}/${skill} has no frontmatter`).toBe(true)
			const frontmatter = text.slice(4).split('\n---')[0] ?? ''
			// Without it the skill is never chosen, and never says so.
			expect(frontmatter, `${host}/${skill} has no description`).toContain('description:')
		}
	}
})

test('every invocable skill in every host says the tools are tools', () => {
	// The M1 gate caught a host reconstructing the board in bash — "Mock the
	// board output since we can't call MCP from bash" — and handing the user
	// invented ids. The instruction against it has to be in every entry point,
	// because a weaker model reads one skill and not the others.
	for (const [host, dir] of Object.entries(SKILL_DIRS)) {
		for (const skill of SKILLS) {
			const text = readFileSync(join(root, dir, skill, 'SKILL.md'), 'utf8')
			expect(text, `${host}/${skill}`).toContain('MCP server')
			expect(text, `${host}/${skill}`).toMatch(/never reproduce|do not shell out/i)
		}
	}
})

test('the refusals are the same sentence in every host', () => {
	// This is the list the whole product rests on, and it is also the first
	// thing hand-copied prose loses. One source is what makes it one list; this
	// is what proves the render did not drop it.
	const never = (host: string): string => {
		const text = buildSkills(host).get('loop') ?? ''
		const found = /## What never happens\n([\s\S]*?)\n## /.exec(text)
		expect(found, `${host} has no "What never happens" list`).not.toBeNull()
		return found?.[1] ?? ''
	}
	const claude = never('claude')
	expect(claude).toContain('An agent answering a decision')
	expect(never('codex')).toBe(claude)
	expect(never('opencode')).toBe(claude)
	expect(never('cursor')).toBe(claude)
})

test('a host that cannot enforce the block says so, rather than claiming it can', () => {
	// DESIGN §2.9: hook enforcement is Claude Code's, and a plugin that claims
	// it everywhere is worse than one that admits where it only advises — a
	// guard that is not installed is silent, and silence reads as permission.
	const loop = (host: string) => buildSkills(host).get('loop') ?? ''
	expect(loop('claude')).toContain('This plugin installs a hook')

	for (const host of ['codex', 'opencode', 'cursor']) {
		expect(loop(host), host).not.toContain('This plugin installs a hook')
		expect(loop(host), host).toContain('cannot enforce it')
	}
})

test('every host’s decision skill asks with the host’s own question, and relays only the pick', () => {
	// The host's question tool asks; the agent passes on what was picked and
	// nothing else (ADR 0057). No host is told `decide` will ask for it.
	for (const host of Object.keys(SKILL_DIRS)) {
		const decide = buildSkills(host).get('decide') ?? ''
		expect(decide, host).toContain('Never pass an option they did not pick')
		expect(decide, host).toMatch(/question tool/)
		expect(decide, host).not.toContain('`decide` is what opens it')
	}
})
