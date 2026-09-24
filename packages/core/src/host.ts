import { execFile, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, delimiter, join } from 'node:path'
import { promisify } from 'node:util'
import { SoberError } from './errors.js'
import { adapterFor, hostCommand, limitSpent } from './hosts.js'
import type { Paths } from './paths.js'
import { writeAtomic } from './write.js'

export {
	A_HUMAN_IS_WATCHING,
	ATTENDED_ARGS,
	HOST_ARGS,
	hostCommand,
	NO_HUMAN,
} from './hosts.js'

const run = promisify(execFile)
const PROBE_TIMEOUT_MS = 30_000

/**
 * The script an npm `.cmd` shim runs, found the way Windows finds the command:
 * PATH in order, and a native `.exe` in the same directory wins. Null when the
 * command is not a shim — then it is spawned as it is.
 */
export const npmShimTarget = (command: string, path = process.env.PATH ?? ''): string | null => {
	if (/[\\/.]/.test(command)) return null
	for (const dir of path.split(delimiter).filter(Boolean)) {
		if (existsSync(join(dir, `${command}.exe`))) return null
		const shim = join(dir, `${command}.cmd`)
		if (!existsSync(shim)) continue
		const script = /"%~?dp0%\\?([^"]+\.[cm]?js)"/i.exec(readFileSync(shim, 'utf8'))?.[1]
		return script === undefined ? null : join(dir, script)
	}
	return null
}

/**
 * On Windows an npm-installed host (`codex`, `sober`) is a `.cmd` shim, which a
 * spawn without a shell cannot start (ENOENT) — and a shell cannot carry a
 * multi-line brief. So the shim's script runs under this node instead. When
 * this process is sober itself, `sober` is its own entry: the same version.
 */
const program = (command: string): readonly [string, string[]] => {
	const self = process.argv[1]
	if (command === 'sober' && self !== undefined && /^sober(\.js)?$/.test(basename(self)))
		return [process.execPath, [self]]
	const script = process.platform === 'win32' ? npmShimTarget(command) : null
	return script === null ? [command, []] : [process.execPath, [script]]
}

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

const withoutModel = (args: readonly string[]): string[] =>
	args.filter((arg, i) => {
		if (/^(--model|-m)=/.test(arg)) return false
		if (arg === '--model' || arg === '-m') return false
		return !(args[i - 1] === '--model' || args[i - 1] === '-m')
	})

/**
 * Checked before anything starts, never three minutes in (`PR-05-04`). Two
 * failures, and they need different sentences: a host that is not installed and
 * a host that is installed but logged out are not the same problem.
 */
export const checkHost = async (host: string): Promise<HostReady> => {
	const adapter = adapterFor(host)
	const [command, args] = hostCommand(host)
	const [file, lead] = program(adapter.command ?? command)
	let stdout: string
	let stderr: string
	try {
		// The model flag is the run's, not the probe's: `opencode providers list`
		// rejects `--model` and prints its help, which read as "not logged in".
		;({ stdout, stderr } = await run(file, [...lead, ...withoutModel(args), ...adapter.probe], {
			encoding: 'utf8',
		}))
	} catch (error) {
		const code = (error as { code?: string }).code
		if (code === 'ENOENT')
			return { ok: false, reason: `${host} is not installed, or is not on this PATH` }
		return { ok: false, reason: `${host} could not report its authentication status` }
	}

	// `codex login status` answers on stderr; stdout still goes first, so a JSON
	// answer is never read with a warning glued to it.
	const loggedIn = adapter.loggedIn(stdout) ?? adapter.loggedIn(stderr)
	if (loggedIn === true) return { ok: true, reason: null }
	if (loggedIn === null)
		return { ok: false, reason: `${host} reported an authentication status SOBER cannot read` }
	return {
		ok: false,
		reason: `${host} is installed but not logged in — run \`${adapter.signIn(host)}\``,
	}
}

export interface HostAvailability {
	readonly state: 'ready' | 'spent' | 'unknown'
	/** What is out, in the words the user has to act on (§8.7) — null when ready or unknown. */
	readonly reason: string | null
}

interface HostsCache {
	readonly at: number
	readonly hosts: Readonly<Record<string, HostAvailability>>
}

const readHostsCache = async (file: string): Promise<HostsCache> => {
	try {
		return JSON.parse(await readFile(file, 'utf8')) as HostsCache
	} catch {
		return { at: 0, hosts: {} }
	}
}

export interface HostAvailabilityDeps {
	readonly run?: typeof run
	readonly now?: () => number
}

/**
 * Whether each host's *account* — not any one model — still has runway, per
 * the `limit-detect` decision: probe, and still fall to the backup. One probe
 * per host id, never per model, since the limit is the account's; cached at
 * `paths.hosts`, fresh for `probeSeconds`.
 *
 * A host with no `availability` table (`opencode`, `cursor`) is left out of
 * the result entirely — the caller keeps whatever it has no answer for.
 * A probe that errors, times out, or prints nothing readable is `unknown`,
 * never a silent `spent` or `ready` — the fallback is what catches it.
 */
export const hostAvailability = async (
	paths: Paths,
	hosts: readonly string[],
	probeSeconds: number,
	deps: HostAvailabilityDeps = {},
): Promise<Record<string, HostAvailability>> => {
	const runFn = deps.run ?? run
	const now = deps.now?.() ?? Date.now()
	const cache = await readHostsCache(paths.hosts)
	const fresh = now < cache.at + probeSeconds * 1000

	// One entry per adapter id — the first host line naming it is what says
	// which binary to spawn, and the probe itself is fixed from there.
	const byId = new Map<string, string>()
	for (const host of hosts) {
		try {
			const id = adapterFor(host).id
			if (!byId.has(id)) byId.set(id, host)
		} catch {
			// An unknown host is refused elsewhere, at `checkHost` time.
		}
	}

	const result: Record<string, HostAvailability> = {}
	const probed: Record<string, HostAvailability> = {}
	let changed = false
	for (const [id, host] of byId) {
		const adapter = adapterFor(host)
		if (adapter.availability === undefined) continue

		if (fresh && cache.hosts[id] !== undefined) {
			result[id] = cache.hosts[id]
			continue
		}

		changed = true
		const [command] = hostCommand(host)
		try {
			const { stdout } = await runFn(adapter.command ?? command, [...adapter.availability.argv], {
				encoding: 'utf8',
				timeout: PROBE_TIMEOUT_MS,
			})
			if (stdout.trim().length === 0) {
				result[id] = { state: 'unknown', reason: null }
				probed[id] = result[id]
				continue
			}
			const reason = limitSpent(id, stdout)
			result[id] = reason === null ? { state: 'ready', reason: null } : { state: 'spent', reason }
		} catch (error) {
			// execFile rejects on a nonzero exit, including when the host prints
			// its limit message and exits. Classify that output before falling back.
			const failed = error as Error & { stdout?: string; stderr?: string }
			const reason = limitSpent(id, `${failed.stdout ?? ''}\n${failed.stderr ?? ''}`)
			if (reason !== null) result[id] = { state: 'spent', reason }
			else {
				console.error(`sober: ${id}'s availability could not be probed: ${failed.message}`)
				result[id] = { state: 'unknown', reason: null }
			}
		}
		probed[id] = result[id]
	}

	if (changed) {
		// The timestamp belongs to this set of probes. Carrying an older
		// unrequested host forward would make its stale answer look fresh.
		await writeAtomic(paths.hosts, JSON.stringify({ at: now, hosts: probed }))
	}

	return result
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
		const [file, lead] = program(adapter.command ?? command)
		const child = spawn(file, [...lead, ...args, ...adapter.argv(options.prompt, attended)], {
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
