import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type { ScanResult } from '@besober/schema'
import { readConfigFromBase } from './config.js'
import { type AddedFile, addedLines } from './diff.js'
import { git, showFromRef } from './git.js'
import type { Paths } from './paths.js'
import { readNode } from './records.js'
import { type Signal, type SignalFinding, signalsIn } from './signals.js'
import { branchOf, worktreeOf } from './worktree.js'

const run = promisify(execFile)

/**
 * Every dispatch result is scanned before it is shown (MUST #9, ADR 0002). This
 * produces the findings; the surface renders them above the diff, never beside
 * it (§6.2). Nothing here auto-rejects and nothing hides a result — the human
 * still decides.
 */
export interface Finding {
	readonly signal: Signal | 'secret' | 'extra'
	readonly file: string
	readonly line: number | null
	readonly message: string
}

export interface ScanReport {
	/** What goes into the `accepted` record, so a scan that did not run is on it. */
	readonly result: ScanResult
	/** Which rule set ran, named — the review says so, because it can differ per project (ADR 0011). */
	readonly ruleSet: string
	readonly findings: readonly Finding[]
	/**
	 * A scanner that could not run does not disappear (`PR-09-06`). It renders
	 * with the weight of a finding, which is why it is a field of its own rather
	 * than a log line nobody reads.
	 */
	readonly didNotRun: readonly string[]
	readonly files: readonly string[]
}

const RC_FILES = ['.secretlintrc.json', '.secretlintrc']

/**
 * Resolved through this package rather than through PATH: the published CLI is
 * a bundle whose one declared dependency is `secretlint` (ADR 0007), and the
 * user is never asked to install a scanner of their own.
 */
const SECRETLINT = join(
	dirname(createRequire(import.meta.url).resolve('secretlint/package.json')),
	'bin',
	'secretlint.js',
)
const BUNDLED = { rules: [{ id: '@secretlint/secretlint-rule-preset-recommend' }] }

export interface ScanOptions {
	readonly base: string
	/** Overridable so a caller that already has the diff does not ask git twice. */
	readonly diff?: string
}

export const scanNode = async (
	paths: Paths,
	node: string,
	options: ScanOptions,
): Promise<ScanReport> => {
	// Three dots: what the branch added since it left the base, not everything
	// that happened on the base meanwhile.
	const diff =
		options.diff ??
		(await git(paths.root, 'diff', '--unified=0', `${options.base}...${branchOf(node)}`))
	const files = addedLines(diff)

	const record = await readNode(paths, node)
	const declared = record.kind === 'ok' ? record.value.files : []

	const secrets = await secretlint(paths, files, options.base)
	const extra = await extraScanners(paths, node, options.base)

	const findings: Finding[] = [
		...secrets.findings,
		...signalsIn(files, declared).map(asFinding),
		...extra.findings,
	]
	const didNotRun = [...secrets.didNotRun, ...extra.didNotRun]

	return {
		// A scan that could not run is never reported as clean, whatever the
		// other scanners found (ADR 0021's rule, applied to the scan).
		result: didNotRun.length > 0 ? 'did-not-run' : findings.length > 0 ? 'findings' : 'clean',
		ruleSet: secrets.ruleSet,
		findings,
		didNotRun,
		files: files.map((file) => file.path),
	}
}

const asFinding = (finding: SignalFinding): Finding => finding

const samePath = (path: string): string => path.replaceAll('\\', '/').toLowerCase()

interface ScannerPart {
	readonly findings: readonly Finding[]
	readonly didNotRun: readonly string[]
	readonly ruleSet: string
}

/**
 * `secretlint` runs over a temporary tree holding **only the added lines**, one
 * file per changed file so the rules that key on a filename still see one. The
 * line numbers are mapped back, because a masked finding with no line sends the
 * reader hunting for a string they cannot search for.
 */
const secretlint = async (
	paths: Paths,
	files: readonly AddedFile[],
	base: string,
): Promise<ScannerPart> => {
	const project = await projectRc(paths, base)
	const ruleSet = project === null ? 'the bundled preset' : `${base}:${project.file}`
	if (files.length === 0) return { findings: [], didNotRun: [], ruleSet }

	const dir = await mkdtemp(join(tmpdir(), 'sober-scan-'))
	try {
		const written: { path: string; temp: string; lines: readonly number[] }[] = []
		for (const file of files) {
			const temp = join(dir, file.path)
			await mkdir(dirname(temp), { recursive: true })
			await writeFile(temp, `${file.lines.map((line) => line.text).join('\n')}\n`)
			written.push({ path: file.path, temp, lines: file.lines.map((line) => line.number) })
		}

		const { stdout } = await secretlintRun(
			paths.root,
			project?.text ?? JSON.stringify(BUNDLED),
			written,
		)
		const results = JSON.parse(stdout) as SecretlintResult[]
		const findings: Finding[] = []
		for (const result of results) {
			// Compared in one shape: secretlint answers with the platform's
			// separators and case, and `endsWith` on a raw Windows path matches
			// nothing — the finding then loses both its file and its line.
			const reported = samePath(result.filePath)
			const source = written.find((file) => reported.endsWith(samePath(file.temp)))
			for (const message of result.messages)
				findings.push({
					signal: 'secret',
					file: source?.path ?? result.filePath,
					line: source?.lines[message.loc.start.line - 1] ?? null,
					message: message.message,
				})
		}
		return { findings, didNotRun: [], ruleSet }
	} catch (error) {
		return { findings: [], didNotRun: [`secretlint: ${reason(error)}`], ruleSet }
	} finally {
		await rm(dir, { recursive: true, force: true })
	}
}

/** Exit code 1 means findings, not failure — everything else is a scanner that broke. */
const secretlintRun = async (
	cwd: string,
	rc: string,
	files: readonly { temp: string }[],
): Promise<{ stdout: string }> => {
	try {
		return await run(
			process.execPath,
			[
				SECRETLINT,
				'--format',
				'json',
				'--no-color',
				'--no-glob',
				'--no-gitignore',
				'--secretlintrcJSON',
				rc,
				...files.map((file) => file.temp),
			],
			{ cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
		)
	} catch (error) {
		const failure = error as { code?: number | string; stdout?: string }
		if (failure.code === 1 && typeof failure.stdout === 'string') return { stdout: failure.stdout }
		throw error
	}
}

/**
 * A project may add rules for its own secret formats and suppress a known false
 * positive — a fixture holding a fake key would otherwise produce a finding on
 * every dispatch, and a panel that is always wrong is a panel nobody reads.
 *
 * Read from the base ref (ADR 0019): an agent that relaxes the rules in its own
 * diff does not relax the scan of its own diff.
 */
const projectRc = async (
	paths: Paths,
	base: string,
): Promise<{ file: string; text: string } | null> => {
	for (const file of RC_FILES) {
		const text = await showFromRef(paths.root, base, file)
		if (text !== null) return { file, text }
	}
	return null
}

/**
 * `scan.extra` is a list of commands, run in the node's worktree beside the
 * bundled scan — `semgrep scan --error --quiet` and the like. Commands rather
 * than tool names, because every scanner's invocation, output format and exit
 * codes differ, and guessing one per tool ages badly. A non-zero exit is a
 * finding; a command that is not installed did not run, and says so.
 */
const extraScanners = async (
	paths: Paths,
	node: string,
	base: string,
): Promise<{ findings: readonly Finding[]; didNotRun: readonly string[] }> => {
	const config = await readConfigFromBase(paths, base)
	if (config.kind !== 'ok') return { findings: [], didNotRun: [`config.jsonc on ${base}: broken`] }

	const findings: Finding[] = []
	const didNotRun: string[] = []
	for (const command of config.value.scan.extra) {
		try {
			await run(command, { cwd: worktreeOf(paths, node), shell: true, encoding: 'utf8' })
		} catch (error) {
			const failure = error as { code?: number | string; stdout?: string; stderr?: string }
			if (missing(failure)) {
				didNotRun.push(`${command}: not installed`)
				continue
			}
			findings.push({
				signal: 'extra',
				file: command,
				line: null,
				message: firstLine(failure.stdout, failure.stderr) ?? `${command} reported findings`,
			})
		}
	}
	return { findings, didNotRun }
}

/**
 * A command that is not installed reports it differently in every shell: `sh`
 * exits 127, `cmd.exe` exits 9009, and spawning without one gives ENOENT. Only
 * the text is common. Getting this wrong reads an absent scanner as findings,
 * which is the one thing `PR-09-06` says must never happen quietly.
 */
const NOT_INSTALLED = /not recognized as|not found|no such file/i

const missing = (failure: { code?: number | string; stdout?: string; stderr?: string }): boolean =>
	failure.code === 127 ||
	failure.code === 9009 ||
	failure.code === 'ENOENT' ||
	NOT_INSTALLED.test(`${failure.stderr ?? ''}${failure.stdout ?? ''}`)

const firstLine = (...outputs: (string | undefined)[]): string | null =>
	outputs
		.flatMap((output) => (output ?? '').split('\n'))
		.map((line) => line.trim())
		.find((line) => line.length > 0) ?? null

const reason = (error: unknown): string =>
	(error as { code?: string }).code === 'ENOENT'
		? 'not installed'
		: ((error as Error).message.split('\n')[0] ?? 'failed')

interface SecretlintResult {
	readonly filePath: string
	readonly messages: readonly {
		readonly message: string
		readonly loc: { readonly start: { readonly line: number } }
	}[]
}
