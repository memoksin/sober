#!/usr/bin/env node
/**
 * The skills are prose, and the same prose has to reach three hosts. Copied by
 * hand it drifts — and the part that drifts first is the "What never happens"
 * list, which is the one part that is load-bearing.
 *
 * So there is one source (`plugins/skills/`), a table of what each host calls
 * things (`plugins/hosts/`), and this, which writes the generated file into
 * each plugin package. The generated files are committed, because a plugin is
 * installed by copying a directory and nobody runs a build to do that; the
 * check that they are current is a test, not a habit (`test/integration/plugin.test.ts`).
 *
 * Run it with `pnpm plugins`.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repoRoot = fileURLToPath(new URL('../', import.meta.url))
const source = join(repoRoot, 'plugins')

/** `{{name}}`, and nothing else — a slot is a word, never an expression. */
const SLOT = /\{\{([a-z-]+)\}\}/g

/**
 * The line that stops somebody editing the wrong file. It goes after the
 * frontmatter rather than before it: a host reads the frontmatter off the first
 * bytes of the file, and anything above `---` means there is none.
 */
const GENERATED = (skill) =>
	`<!-- Generated from plugins/skills/${skill}/SKILL.md by scripts/build-plugins.mjs. Edit the source, then run \`pnpm plugins\`. -->`

/**
 * A slot with no value is a mistake that would ship silently — the sentence
 * that explains how a decision reaches the user, missing from one host. So an
 * unknown slot stops the build and names itself.
 */
export const render = (text, values, where) =>
	text.replace(SLOT, (_, name) => {
		const value = values[name]
		if (value === undefined) throw new Error(`${where}: no value for {{${name}}}`)
		return value
	})

/** The frontmatter ends at the first `---` on its own line after the first. */
const withNotice = (text, skill) => {
	const end = text.indexOf('\n---\n', 4)
	if (!text.startsWith('---\n') || end === -1)
		throw new Error(`${skill}: a skill with no frontmatter is never chosen, and never says so`)
	const cut = end + '\n---\n'.length
	return `${text.slice(0, cut)}\n${GENERATED(skill)}\n${text.slice(cut)}`
}

/** Every skill each host gets, rendered — the whole output, as text. */
export const buildSkills = (host) => {
	const values = JSON.parse(readFileSync(join(source, 'hosts', `${host}.json`), 'utf8'))
	const built = new Map()
	for (const skill of readdirSync(join(source, 'skills')).sort()) {
		const text = readFileSync(join(source, 'skills', skill, 'SKILL.md'), 'utf8')
		built.set(skill, withNotice(render(text, values.slots, `${host}/${skill}`), skill))
	}
	return built
}

/** Where each host's plugin keeps its skills, relative to the repository root. */
export const SKILL_DIRS = {
	claude: 'packages/claude-code-plugin/skills',
	codex: 'packages/codex-plugin/skills',
	opencode: 'packages/opencode-plugin/.opencode/skills',
}

const main = () => {
	for (const [host, dir] of Object.entries(SKILL_DIRS)) {
		const target = join(repoRoot, dir)
		// Removed rather than overwritten: a skill deleted from the source has to
		// disappear from every host, and an orphan left behind is a skill the
		// model can still choose.
		rmSync(target, { recursive: true, force: true })
		for (const [skill, text] of buildSkills(host)) {
			const file = join(target, skill, 'SKILL.md')
			mkdirSync(dirname(file), { recursive: true })
			writeFileSync(file, text)
		}
		console.log(`${host}: ${[...buildSkills(host).keys()].join(', ')} → ${dir}`)
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
