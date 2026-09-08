import { execFile } from 'node:child_process'
import type { CommandResult, Run } from '@besober/schema'
import { readConfigFromBase } from './config.js'
import { NotOnBoardError } from './errors.js'
import { loadBoard } from './graph.js'
import { HostError } from './host.js'
import { appendEvent, appendRunOutput, readRun, writeRun } from './local.js'
import { withLock } from './lock.js'
import type { Paths } from './paths.js'
import { readNode } from './records.js'
import { lastRun } from './status.js'
import { worktreeOf } from './worktree.js'

/**
 * The auditor (ADR 0049): the acceptance list is run, not read. A criterion is
 * a command and one sentence saying what passing it proves (ADR 0027), and
 * until something runs the command the sentence is a promise the review asks a
 * human to believe.
 *
 * Everything here executes in the node's worktree, through a shell, with this
 * process's environment — the same reach `dispatch.setup` and `scan.extra`
 * already have. What keeps that honest is not a sandbox: it is that the list
 * comes from the board at the project root, which a human approved, and never
 * from the branch under review, which the agent wrote.
 */
export interface Audit {
	readonly verify: CommandResult | null
	/** Parallel to the brief's criteria, by index (ADR 0027 §5). */
	readonly acceptance: readonly (CommandResult | null)[]
}

interface Judged {
	readonly result: CommandResult | null
	readonly output: string
}

/**
 * A command that is not there reports it differently in every shell: `sh` exits
 * 127, `cmd.exe` exits 9009, and spawning without one gives ENOENT. Only the
 * text is common. Getting this wrong reads a check that never ran as a check
 * that failed — or, in the scan's case, as one that passed, which is the thing
 * `PR-09-06` exists to prevent.
 */
const NOT_INSTALLED = /not recognized as|not found|no such file/i

export interface Failure {
	readonly code?: number | string
	readonly stdout?: string
	readonly stderr?: string
}

export const notInstalled = (failure: Failure): boolean =>
	failure.code === 127 ||
	failure.code === 9009 ||
	failure.code === 'ENOENT' ||
	NOT_INSTALLED.test(`${failure.stderr ?? ''}${failure.stdout ?? ''}`)

/**
 * One command, reduced to the one thing anyone reads later: the exit code.
 * `null` means it did not run, and never that it passed (ADR 0021) — a command
 * nobody configured and a command nobody installed are both silence, and the
 * review renders silence as silence.
 *
 * A shell, like the setup command and for the same reason: the value is a line
 * a human wrote, either into their config on the base ref or into an acceptance
 * list they approved.
 */
export const judge = (cwd: string, command: string | null): Promise<Judged> =>
	command === null
		? Promise.resolve({ result: null, output: '' })
		: new Promise((resolve) => {
				execFile(
					command,
					{ cwd, shell: true, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
					(error, stdout, stderr) => {
						const output = `${stdout}${stderr}`
						if (error === null) return resolve({ result: { exit: 0 }, output })
						// The text goes in from the callback, not off the error:
						// `execFile` hands stdout and stderr to the callback and never
						// attaches them to what it rejects with. Read off the error,
						// the message half of `notInstalled` tested two empty strings
						// on every platform, and only `sh`'s exit 127 was doing the
						// work — so a shell that answers differently, `cmd.exe` among
						// them, read a tool nobody installed as a criterion that
						// failed.
						const code = (error as Failure).code
						if (notInstalled({ code, stdout, stderr })) return resolve({ result: null, output })
						resolve({ result: { exit: typeof code === 'number' ? code : 1 }, output })
					},
				)
			})

/**
 * The run is judged where it worked (§6.0): `dispatch.verify` first, then every
 * criterion the human approved, each in the node's own worktree.
 *
 * The output goes to the run log (ADR 0027 §5) and never into the record. An
 * exit code is what `green` is computed from; the reason a command failed is
 * prose, and prose belongs where the rest of the run's prose already is.
 */
export const runAudit = async (
	paths: Paths,
	node: string,
	id: string,
	options: { readonly base: string; readonly verify?: string | null },
): Promise<Audit> => {
	const cwd = worktreeOf(paths, node)
	const verify =
		options.verify === undefined ? await verifyCommand(paths, options.base) : options.verify

	const judgedVerify = await judge(cwd, verify)
	if (verify !== null) await log(paths, id, `dispatch.verify: ${verify}`, judgedVerify)

	const acceptance: (CommandResult | null)[] = []
	for (const criterion of await criteriaOf(paths, node)) {
		const judged = await judge(cwd, criterion.run)
		await log(paths, id, `acceptance: ${criterion.proves}\n$ ${criterion.run}`, judged)
		acceptance.push(judged.result)
	}
	return { verify: judgedVerify.result, acceptance }
}

/**
 * What the record says when nothing was judged: one `null` per criterion rather
 * than an empty list. `[]` reads as "this node asked for nothing"; `[null]`
 * reads as "it asked for one thing and nobody checked", and only the second is
 * true of a run that did not finish.
 */
export const unjudged = async (paths: Paths, node: string): Promise<Audit> => ({
	verify: null,
	acceptance: (await criteriaOf(paths, node)).map(() => null),
})

export interface Audited {
	readonly run: string
	readonly audit: Audit
}

/**
 * Auditing on demand, against the run that is already there. A criterion that
 * was wrong, or a check that failed for a reason outside the work, does not
 * deserve a second dispatch: the worktree still holds what the agent built, so
 * the list can simply be run against it again.
 *
 * Null when the node has never run — there is nothing to audit, which is not
 * the same as an audit that found nothing.
 */
export const auditNode = async (
	paths: Paths,
	node: string,
	base: string,
): Promise<Audited | null> => {
	const board = await loadBoard(paths)
	if (!board.nodes.has(node)) throw new NotOnBoardError('node', node)

	const run = lastRun(board, node)
	if (run === null) return null

	const audit = await runAudit(paths, node, run.id, { base })
	await recordAudit(paths, run.id, audit)
	await appendEvent(paths, { action: 'run.audited', node, run: run.id })
	return { run: run.id, audit }
}

/** The audit replaces what the last one wrote: a record of two runs of one list is not a record. */
export const recordAudit = (paths: Paths, id: string, audit: Audit): Promise<Run> =>
	withLock(paths, 'run', async () => {
		const record = await readRun(paths, id)
		if (record.kind !== 'ok') throw new NotOnBoardError('node', id)

		const run: Run = { ...record.value, verify: audit.verify, acceptance: [...audit.acceptance] }
		await writeRun(paths, id, run)
		return run
	})

const criteriaOf = async (paths: Paths, node: string) => {
	const record = await readNode(paths, node)
	return record.kind === 'ok' ? (record.value.brief?.acceptance ?? []) : []
}

const verifyCommand = async (paths: Paths, base: string): Promise<string | null> => {
	const config = await readConfigFromBase(paths, base)
	if (config.kind !== 'ok')
		throw new HostError(`config.jsonc on ${base} cannot be read: ${config.reason}`)
	return config.value.dispatch.verify
}

const log = (paths: Paths, id: string, header: string, judged: Judged): Promise<void> =>
	appendRunOutput(
		paths,
		id,
		`\n--- ${header}\n${judged.output}${
			judged.result === null ? '(did not run)\n' : `(exit ${judged.result.exit})\n`
		}`,
	)
