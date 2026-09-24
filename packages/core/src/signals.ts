import type { Signal } from '@besober/schema'
import picomatch from 'picomatch'
import type { AddedFile } from './diff.js'

/**
 * The rules behind the six named signals of ADR 0011. The names are a
 * vocabulary every surface renders, so they live in `schema`; the looking is
 * here, because it reads a diff.
 *
 * Every rule is language-agnostic and reads one added line at a time. None of
 * them is a proof — each is a reason for a human to look, which is the whole
 * job of the panel above the diff (§6.2). "Injection-shaped changes" was the
 * earlier wording and could not be kept: a real injection analyser needs one
 * rule set per language a user might write in.
 */
export interface SignalFinding {
	readonly signal: Signal
	readonly file: string
	readonly line: number | null
	readonly message: string
}

/** Manifests and lockfiles, across the ecosystems SOBER's users actually write in. */
const MANIFESTS = [
	'package.json',
	'package-lock.json',
	'pnpm-lock.yaml',
	'yarn.lock',
	'bun.lock',
	'bun.lockb',
	'requirements.txt',
	'pyproject.toml',
	'poetry.lock',
	'uv.lock',
	'Pipfile',
	'Pipfile.lock',
	'Cargo.toml',
	'Cargo.lock',
	'go.mod',
	'go.sum',
	'Gemfile',
	'Gemfile.lock',
	'composer.json',
	'composer.lock',
	'pom.xml',
	'build.gradle',
	'build.gradle.kts',
]

const RULES: readonly {
	readonly signal: Signal
	readonly pattern: RegExp
	readonly message: string
}[] = [
	{
		signal: 'dynamic-code',
		pattern: /\beval\s*\(|\bnew\s+Function\s*\(|\bvm\.runIn\w*\s*\(|\bexec\s*\(\s*['"`f]/,
		message: 'code is built and executed at runtime',
	},
	{
		signal: 'shell-from-variable',
		// A shell call on the same line as an interpolation. Both halves are
		// required: a shell call with a literal command is ordinary.
		pattern:
			/(exec|execSync|spawn|spawnSync|system|popen|subprocess\.\w+|Runtime\.getRuntime\(\)\.exec|os\.system)\s*\(.*(\$\{|\+\s*\w|%s|\{\}|f['"]|\.format\()/,
		message: 'a shell command is built from a variable',
	},
	{
		signal: 'tls-disabled',
		pattern:
			/rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED|verify\s*=\s*False|InsecureSkipVerify\s*:\s*true|CURLOPT_SSL_VERIFYPEER\s*,\s*(?:0|false)|--insecure\b|\bcurl\b[^\n]*\s-k\b|SSL_VERIFY_NONE/,
		message: 'TLS certificate verification is turned off',
	},
	{
		signal: 'hardcoded-address',
		// ponytail: a URL in an added comment counts. Stripping comments needs a
		// parser per language, which is the thing this list exists to avoid.
		pattern:
			/https?:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0|example\.(?:com|org|net))[\w.-]+|(?<![\w.])(?!127\.0\.0\.1|0\.0\.0\.0)\d{1,3}(?:\.\d{1,3}){3}:\d+/,
		message: 'a network call to a hardcoded address',
	},
]

export const signalsIn = (
	files: readonly AddedFile[],
	declared: readonly string[],
): readonly SignalFinding[] => {
	const findings: SignalFinding[] = []
	// The node's `files` is a prediction, not a contract enforced before the
	// work runs (§3.1). It earns its place here instead: a diff outside it is
	// the clearest sign an agent did something nobody expected, and it is a
	// finding a human reads rather than a closed pull request (ADR 0011).
	const declaredMatch = declared.length > 0 ? picomatch(declared as string[]) : null

	for (const file of files) {
		if (declaredMatch !== null && !declaredMatch(file.path))
			findings.push({
				signal: 'undeclared-file',
				file: file.path,
				line: null,
				message: 'this file is not in the node’s declared files',
			})

		if (MANIFESTS.includes(basename(file.path)))
			findings.push({
				signal: 'dependency-added',
				file: file.path,
				line: file.lines[0]?.number ?? null,
				message: 'a dependency manifest or lockfile changed',
			})

		for (const line of file.lines)
			for (const rule of RULES)
				if (rule.pattern.test(line.text))
					findings.push({
						signal: rule.signal,
						file: file.path,
						line: line.number,
						message: rule.message,
					})
	}
	return findings
}

/** Paths in a diff are always `/`-separated, whatever the platform (§9). */
const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1)
