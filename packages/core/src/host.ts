import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { SoberError } from './errors.js'
import { adapterFor, hostCommand } from './hosts.js'

export {
	A_HUMAN_IS_WATCHING,
	ATTENDED_ARGS,
	HOST_ARGS,
	hostCommand,
	NO_HUMAN,
} from './hosts.js'

const run = promisify(execFile)

/**
 * Launching an adapter (DESIGN §5.1): SOBER shells out to the host CLI the user
 * already installed and logged into. It never asks for an API key and never
 * chooses the model. Thin by contract — build an invocation, stream its output,
 * report how it exited.
 *
 * What differs host by host is a table in `hosts.ts`. This file is the half
 * every host shares: the probe, the spawn, the line splitting, and how an exit
 * is read.
 */

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
	const adapter = adapterFor(host)
	const [command, args] = hostCommand(host)
	let stdout: string
	try {
		;({ stdout } = await run(command, [...args, ...adapter.probe], { encoding: 'utf8' }))
	} catch (error) {
		const code = (error as { code?: string }).code
		if (code === 'ENOENT')
			return { ok: false, reason: `${host} is not installed, or is not on this PATH` }
		return { ok: false, reason: `${host} could not report its authentication status` }
	}

	const loggedIn = adapter.loggedIn(stdout)
	if (loggedIn === true) return { ok: true, reason: null }
	if (loggedIn === null)
		return { ok: false, reason: `${host} reported an authentication status SOBER cannot read` }
	return {
		ok: false,
		reason: `${host} is installed but not logged in — run \`${adapter.signIn(host)}\``,
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
	/**
	 * A human is watching and may reply (ADR 0046). It opens stdin and swaps the
	 * system prompt; everything else about the run is the same, which is what
	 * keeps one dispatch path rather than two.
	 */
	readonly attended?: boolean
	/**
	 * Handed the writer for the session's input, once, as soon as there is one.
	 * Only called in attended mode — a headless host has no stdin to write to.
	 */
	readonly onInput?: (input: AgentInput) => void
}

/** Talking to a live session: one message, or the end of the conversation. */
export interface AgentInput {
	readonly say: (text: string) => void
	/** Closes the session's input, which is how an attended host exits on its own. */
	readonly done: () => void
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
		const adapter = adapterFor(options.host)
		const attended = options.attended === true && adapter.attendable
		const child = spawn(command, [...args, ...adapter.argv(options.prompt, attended)], {
			cwd: options.cwd,
			// Never a shell: a brief carrying a backtick is text, not a second command.
			shell: false,
			// stdin is closed for a headless run, and the reason is measurable: a
			// `claude -p` with an open stdin waits three seconds for input that
			// never comes, and `codex exec` says so out loud — "Reading additional
			// input from stdin...". An attended run is the case where something
			// does come.
			stdio: [attended ? 'pipe' : 'ignore', 'pipe', 'pipe'],
		})

		if (child.pid !== undefined) options.onStart?.(child.pid)

		if (attended && child.stdin !== null) {
			const input = child.stdin
			options.onInput?.({
				// The shape the host reads on `--input-format stream-json`, recorded
				// off a real invocation rather than from memory (BUILD-PLAN §6).
				say: (text) =>
					void input.write(
						`${JSON.stringify({
							type: 'user',
							message: { role: 'user', content: [{ type: 'text', text }] },
						})}\n`,
					),
				// An attended host exits when its input ends, so this is what lets a
				// conversation finish without killing anything.
				done: () => input.end(),
			})
			// A host that exits while a write is in flight is an ordinary end to a
			// conversation, not a crash in this process.
			input.on('error', () => {})
		}

		let stopped = false
		const abort = () => {
			stopped = true
			// ponytail: kills the host process, not its tree. A stopped run that
			// leaves a child behind is what earns a per-platform tree kill.
			child.kill('SIGTERM')
		}
		options.signal?.addEventListener('abort', abort, { once: true })

		const stderr: string[] = []
		// Both are piped in both modes; the null is what the type says about a
		// `stdio` array TypeScript cannot read the shape of, not a state that
		// happens here.
		if (child.stdout !== null) lines(child.stdout, options.onLine)
		if (child.stderr !== null)
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
