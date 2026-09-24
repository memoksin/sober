import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

/**
 * The install docs are hand-written prose that names things the repository
 * owns: marketplace names, plugin paths, the published package, links between
 * READMEs. Nothing typechecks prose, so a rename in a manifest only surfaces in
 * a user's terminal. These checks pin those facts to the files they come from.
 *
 * Do not add assertions on wording, word counts, headings other than the Hosts
 * table, or the order of install sections. Those fail on every honest edit and
 * teach people to update the test without reading it.
 */
const root = fileURLToPath(new URL('../../', import.meta.url))
const text = (file: string) => readFileSync(join(root, file), 'utf8')
const read = (file: string) => JSON.parse(text(file))

const readme = text('README.md')
const cliName: string = read('packages/cli/package.json').name

const linkTargets = (markdown: string) =>
	[...markdown.matchAll(/\]\(([^)\s]+)\)/g)]
		.map((m) => m[1] as string)
		.filter((t) => !/^(http|#|mailto:)/.test(t))
		.map((t) => t.split('#')[0] as string)

// A dead link sends a reader to a 404 in the middle of an install.
test('every relative link in README.md resolves to a file', () => {
	for (const target of linkTargets(readme)) {
		expect(existsSync(join(root, target)), `README.md links to missing ${target}`).toBe(true)
	}
})

// A host row pointing nowhere leaves that host's users with no install steps.
test('every host row in the Hosts table points at something that exists', () => {
	const section = readme.split(/^## Hosts$/m)[1]?.split(/^## /m)[0] ?? ''
	for (const host of ['Claude Code', 'Cursor', 'Codex', 'OpenCode']) {
		const row = section.split('\n').find((line) => line.startsWith(`| ${host} |`))
		expect(row, `Hosts table has no ${host} row`).toBeDefined()
		const targets = linkTargets(row ?? '')
		expect(targets.length, `${host} row has no link`).toBeGreaterThan(0)
		for (const target of targets) {
			expect(existsSync(join(root, target)), `${host} row links to missing ${target}`).toBe(true)
		}
	}
})

// A quoted name that does not match the manifest makes the install command fail.
test('install snippets quote the names the manifests declare', () => {
	const claude = read('.claude-plugin/marketplace.json')
	const [plugin] = claude.plugins
	expect(readme).toContain(`/plugin install ${plugin.name}@${claude.name}`)
	expect(existsSync(join(root, plugin.source)), `missing ${plugin.source}`).toBe(true)

	// A source path that does not resolve installs an empty plugin, silently.
	const codex = read('.agents/plugins/marketplace.json')
	const path: string = codex.plugins[0].source.path
	expect(existsSync(join(root, path)), `missing ${path}`).toBe(true)
	expect(readme).toContain('.agents/plugins/marketplace.json')
	for (const [, quoted] of readme.matchAll(/`((?:\.\/)?packages\/[^`\s*]*)`/g)) {
		expect(existsSync(join(root, quoted as string)), `README.md quotes missing ${quoted}`).toBe(
			true,
		)
	}

	expect(readme).toContain(`npm i -g ${cliName}`)
})

// Without `sober` on the PATH no host plugin can run anything.
test('every host plugin README names the published CLI as a prerequisite', () => {
	for (const pkg of ['claude-code-plugin', 'cursor-plugin', 'codex-plugin', 'opencode-plugin']) {
		expect(text(`packages/${pkg}/README.md`), `packages/${pkg}/README.md`).toContain(
			`npm i -g ${cliName}`,
		)
	}
})

test('the release ADR names all three bumps', () => {
	const adr = text('docs/adr/0059-a-merge-into-main-is-a-release.md')
	for (const bump of ['patch', 'minor', 'major']) expect(adr).toContain(bump)
})
