// Already on `development` and cannot be rewritten; listed by exact subject so the release range
// can pass. New commits are not covered.
const LANDED = new Set([
	'design: replace graph pulse with EKG trace, add motion-force switch',
	'design: refine watch-the-run graph pulse and session motion',
	"fix(core): prefer Git's bin/sh.exe, which puts /usr/bin on PATH",
	'fix(core): start npm-installed hosts on Windows through their script',
	"fix(core): run sober's own entry for openrouter on Windows",
	'feat(core): dispatch refusals name the config key to edit',
	'fix: advance the test board with a commit git will not deduplicate',
])

export default {
	extends: ['@commitlint/config-conventional'],
	ignores: [(message) => LANDED.has(message.split('\n')[0].trim())],
	rules: {
		// Subjects name acronyms — `ADR 0062 — SOBER …` — and the case rule reads them as shouting.
		'subject-case': [0],
		// `sober: <node>` is what `accept` writes on a node's merge commit.
		'type-enum': [
			2,
			'always',
			[
				'build',
				'chore',
				'ci',
				'docs',
				'feat',
				'fix',
				'perf',
				'refactor',
				'revert',
				'style',
				'test',
				'sober',
			],
		],
	},
}
