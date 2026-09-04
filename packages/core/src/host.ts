import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { SoberError } from './errors.js'

const run = promisify(execFile)

/**
 * The adapter (DESIGN §5.1): SOBER shells out to the host CLI the user already
 * installed and logged into. It never asks for an API key and never chooses the
 * model. Thin by contract — build an invocation, stream its output, report how
 * it exited — and deliberately not abstracted: Claude Code is the only host in
 * v1, and the second one is what earns the interface.
 *
 * Every flag below was read off `claude --help` and one real invocation at
 * implementation time, never from memory (BUILD-PLAN §6). Two of them are not
 * guesses a reader would make:
 *
 * - `--output-format stream-json` is what makes a live tail possible at all.
 *   Plain `--print` emits the final answer only, after the run, so there is
 *   nothing to watch while a node is building (`PR-05-09`).
 * - stdin is closed. A `claude -p` with an open stdin waits three seconds for
 *   input that never comes, on every dispatch.
 */
export const HOST_ARGS = [
	'--output-format',
	'stream-json',
	'--verbose',
	'--permission-mode',
	'bypassPermissions',
] as const

/**
 * `dispatch.host` is a command line, not just a program name, so `npx claude`
 * and `claude --model opus` are both settable without a fourth setting.
 *
 * ponytail: split on whitespace, so a host whose *path* contains a space has to
 * go through a wrapper script. Real quoting when someone hits it — the default
 * is a bare name on PATH.
 */
export const hostCommand = (host: string): readonly [string, string[]] => {
	const [command = host, ...args] = host.trim().split(/\s+/)
	return [command, args]
}

export class HostError extends SoberError {
	constructor(message: string) {
		super('host', message)
	}
}

export interface HostReady {
	readonly ok: boolean
	/** What is missing, in the words the user has to act on (§8.7). */
	readonly reason: string | null
}

/**
 * Checked before anything starts, never three minutes in (`PR-05-04`). Two
 * failures, and they need different sentences: a host that is not installed and
 * a host that is installed but logged out are not the same problem.
 */
export const checkHost = async (host: string): Promise<HostReady> => {
	const [command, args] = hostCommand(host)
	let stdout: string
	try {
		;({ stdout } = await run(command, [...args, 'auth', 'status', '--json'], { encoding: 'utf8' }))
	} catch (error) {
		const code = (error as { code?: string }).code
		if (code === 'ENOENT')
			return { ok: false, reason: `${host} is not installed, or is not on this PATH` }
		return { ok: false, reason: `${host} could not report its authentication status` }
	}

	try {
		const status = JSON.parse(stdout) as { loggedIn?: boolean }
		if (status.loggedIn === true) return { ok: true, reason: null }
	} catch {
		return { ok: false, reason: `${host} reported an authentication status SOBER cannot read` }
	}
	return {
		ok: false,
		reason: `${host} is installed but not logged in — run \`${host} auth login\``,
	}
}

export type AgentExit =
	| { readonly kind: 'finished' }
	| { readonly kind: 'failed'; readonly reason: string }
	| { readonly kind: 'stopped' }

export interface AgentOptions {
	readonly host: string
	readonly cwd: string
	readonly prompt: string
	/** Raw output, one line at a time — the caller appends it to the run log (§5.5). */
	readonly onLine: (line: string) => void
	/** The pid, as soon as there is one, so a second process can stop this run. */
	readonly onStart?: (pid: number) => void
	readonly signal?: AbortSignal
}

/**
 * The brief is handed over as the prompt argument. There is no brief file: the
 * scan reports a diff that touches files outside the node's declared `files`
 * (§6.2), and a brief materialised into the worktree would be that finding on
 * every dispatch. This closes DESIGN §3.7's open question.
 */
export const startAgent = (options: AgentOptions): Promise<AgentExit> =>
	new Promise((resolve) => {
		const [command, args] = hostCommand(options.host)
		const child = spawn(command, [...args, '-p', options.prompt, ...HOST_ARGS], {
			cwd: options.cwd,
			// Never a shell: a brief carrying a backtick is text, not a second command.
			shell: false,
			stdio: ['ignore', 'pipe', 'pipe'],
		})

		if (child.pid !== undefined) options.onStart?.(child.pid)

		let stopped = false
		const abort = () => {
			stopped = true
			// ponytail: kills the host process, not its tree. A stopped run that
			// leaves a child behind is what earns a per-platform tree kill.
			child.kill('SIGTERM')
		}
		options.signal?.addEventListener('abort', abort, { once: true })

		const stderr: string[] = []
		lines(child.stdout, options.onLine)
		lines(child.stderr, (line) => {
			stderr.push(line)
			options.onLine(line)
		})

		child.on('error', (error) => {
			options.signal?.removeEventListener('abort', abort)
			resolve({ kind: 'failed', reason: describe(options.host, error) })
		})

		child.on('close', (code, signal) => {
			options.signal?.removeEventListener('abort', abort)
			// A SIGTERM this process did not send came from `sober stop` in
			// another terminal (§5.4). Either way the answer is the same: the
			// run was stopped, and nothing it wrote is deleted.
			if (stopped || (code === null && signal === 'SIGTERM')) return resolve({ kind: 'stopped' })
			if (code === 0) return resolve({ kind: 'finished' })
			const tail = stderr.at(-1)?.trim()
			const how = code === null ? `was killed by ${signal}` : `exited with code ${code}`
			resolve({
				kind: 'failed',
				reason: tail ? `${options.host} ${how}: ${tail}` : `${options.host} ${how}`,
			})
		})
	})

const describe = (host: string, error: Error): string =>
	(error as { code?: string }).code === 'ENOENT'
		? `${host} is not installed, or is not on this PATH`
		: `${host} could not be started: ${error.message}`

/** Split on newlines across chunk boundaries: a JSON event arrives in pieces. */
const lines = (stream: NodeJS.ReadableStream, onLine: (line: string) => void): void => {
	let buffer = ''
	stream.setEncoding('utf8')
	stream.on('data', (chunk: string) => {
		buffer += chunk
		const parts = buffer.split('\n')
		buffer = parts.pop() ?? ''
		for (const part of parts) if (part.length > 0) onLine(part)
	})
	stream.on('end', () => {
		if (buffer.length > 0) onLine(buffer)
	})
}
