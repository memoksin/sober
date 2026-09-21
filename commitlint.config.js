export default {
	extends: ['@commitlint/config-conventional'],
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
