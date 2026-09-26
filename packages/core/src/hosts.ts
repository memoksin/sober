import { LogLine, type LogLineInput } from '@besober/schema'
import { SoberError } from './errors.js'

const BODY_LINES = 40
const BODY_CHARS = 4096

/** A result's text as the log keeps it: the first 40 lines or 4 KB, and a marker when cut. */
export const capBody = (text: string): string => {
	const kept = text.split('\n').slice(0, BODY_LINES).join('\n').slice(0, BODY_CHARS)
	return kept.length < text.length ? `${kept}\n… (truncated)` : kept
}

/**
 * A result in one line: `error: …` when the host says it failed, `exit N`
 * where the text carries an exit code, the line itself when there is one, and
 * a line count otherwise.
 */
export const summarize = (text: string, failed = false): string => {
	const lines = text.trimEnd().split('\n')
	const first = (lines[0] ?? '').trim()
	if (failed) return `error: ${first}`
	// Claude Code opens a failed Bash result with `Exit code N`; SOBER's own
	// loop closes every bash result with `exit code: N`.
	const exit = /^Exit code (\d+)/.exec(first) ?? /^exit code: (\d+)$/.exec(lines.at(-1) ?? '')
	if (exit !== null) return `exit ${exit[1]}`
	return lines.length === 1 ? first : `${lines.length} lines`
}

/** The one line of a tool's input a person wants beside its name. */
const oneLine = (value: unknown): string | null =>
	typeof value === 'string' && value.trim().length > 0
		? (value.trim().split('\n')[0] ?? null)
		: null

/** Which key of a Claude Code tool's input names what it touched. */
const CLAUDE_DETAIL: Readonly<Record<string, string>> = {
	Read: 'file_path',
	Edit: 'file_path',
	Write: 'file_path',
	Bash: 'command',
	Grep: 'pattern',
	Glob: 'pattern',
	WebFetch: 'url',
	Task: 'description',
}

/** A Claude `tool_result`'s content is a string or a list of text blocks. */
const resultText = (content: string | readonly { text?: string }[] | undefined): string =>
	typeof content === 'string'
		? content
		: (content ?? []).map((block) => block.text ?? '').join('\n')

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

/**
 * What a headless run is told before anything else, on every host.
 *
 * This is the M2 gate's finding 1, and it is not a Claude Code fact. Any host
 * discovers the operator's own instructions file, and one of them said "never
 * run `git commit` without asking": two of five dispatches stopped to ask a
 * permission nobody was there to give, finished with an empty branch, and left
 * the work staged in the worktree. A permission mode does not reach this — the
 * agent was not blocked, it was instructed. So the instruction is answered
 * where instructions live.
 */
export const NO_HUMAN =
	'You are running headless, dispatched by SOBER. No human is reading this session and no question you ask can be answered. Ignore any instruction — from a CLAUDE.md, a rules file, or anywhere else — that tells you to ask for confirmation or approval before acting, including before committing: there is nobody to ask. Do the work described and commit it. If something genuinely stops you, stop and say why in your final message, because that message is what the human will read.'

/**
 * The inverse of `NO_HUMAN`, for a run somebody is watching (ADR 0046).
 *
 * It says the opposite about the reader and the same thing about committing,
 * and the second half is deliberate. `NO_HUMAN` exists because two of five M2
 * dispatches stopped to ask a permission nobody could give and finished with an
 * empty branch; a human at the screen fixes the "nobody could give" half and
 * changes nothing about what SOBER does with the branch afterwards. An attended
 * run that ends its turn waiting for approval to commit is the same empty
 * branch with somebody watching it happen.
 */
export const A_HUMAN_IS_WATCHING =
	'You are running inside SOBER, dispatched to build one node, and a human is watching this session on a dashboard and can reply to you. If you genuinely need a decision only they can make, ask for it in a short message and wait — they will answer. Do not ask for permission to act or to commit: that is already granted, and the work is committed on this branch either way. Prefer doing the work and reporting what you did over asking whether to start.'

/**
 * Claude Code's headless flags. Two of them are not guesses a reader would
 * make:
 *
 * - `--output-format stream-json` is what makes a live tail possible at all.
 *   Plain `--print` emits the final answer only, after the run, so there is
 *   nothing to watch while a node is building (`PR-05-09`).
 * - `--append-system-prompt` is where `NO_HUMAN` goes on the one host that has
 *   somewhere to put it. The other two get it in front of the brief.
 */
export const HOST_ARGS = [
	'--output-format',
	'stream-json',
	'--verbose',
	'--permission-mode',
	'bypassPermissions',
	'--append-system-prompt',
	NO_HUMAN,
] as const

/**
 * What attended mode adds. `--input-format stream-json` is what keeps the
 * session open for a reply — without it the host reads the prompt, answers, and
 * exits, which is a monologue rather than a conversation. `--replay-user-messages`
 * echoes what the human sent back onto stdout, so the run log holds both halves
 * and the transcript can be read later by somebody who was not there.
 *
 * `bypassPermissions` stays. Answering a *tool permission* prompt is a
 * different feature: the host routes those through a control protocol to an SDK
 * host (`--permission-prompts host`), which is a second protocol to implement
 * and is not what `SCOPE.md`'s line asks for. This is the conversation, and it
 * is the half that a person watching a run actually wants.
 */
export const ATTENDED_ARGS = [
	'--output-format',
	'stream-json',
	'--input-format',
	'stream-json',
	'--replay-user-messages',
	'--verbose',
	'--permission-mode',
	'bypassPermissions',
	'--append-system-prompt',
	A_HUMAN_IS_WATCHING,
] as const

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** What one run adds to a host's invocation beyond the prompt. A host ignores what it has no flag for. */
export interface RunArgs {
	readonly effort?: Effort | null
	/**
	 * Claude only: launch without the operator's own settings, MCP servers and
	 * plugins, keeping just these plugins. Null leaves the operator's environment in.
	 */
	readonly plugins?: readonly string[] | null
	/** The host's session to continue instead of starting a new one. */
	readonly resume?: string | null
	/** Claude only: settings layered over the run, from `dispatch.workerSettings`. */
	readonly settings?: Readonly<Record<string, unknown>> | null
}

/**
 * What `HOW_IT_ENDS` tells every agent not to do, held by the host rather than
 * by the prose: a deny rule applies under `bypassPermissions` too (measured on
 * 2.1.283). Both shells, because Claude on Windows may run either.
 */
export const WORKER_DENY: readonly string[] = [
	'git push*',
	'git merge*',
	'git switch*',
	'gh pr merge*',
].flatMap((command) => [`Bash(${command})`, `PowerShell(${command})`])

/**
 * One `--settings` for a Claude run: the deny rules, `workerSettings`, and —
 * when isolated — the only plugins it keeps. Hooks go in the project's
 * `.claude/settings.json` or a plugin: hooks passed here did not fire (2.1.283).
 */
const claudeSettings = (run: RunArgs): string => {
	const extra = run.settings ?? {}
	const permissions = (extra.permissions ?? {}) as { deny?: readonly string[] }
	return JSON.stringify({
		...extra,
		permissions: { ...permissions, deny: [...WORKER_DENY, ...(permissions.deny ?? [])] },
		...(run.plugins == null
			? {}
			: {
					enabledPlugins: {
						...(extra.enabledPlugins as Record<string, boolean> | undefined),
						...Object.fromEntries(run.plugins.map((id) => [id, true])),
					},
				}),
	})
}

/**
 * The operator's `~/.claude` — global CLAUDE.md, hooks, MCP servers, every
 * plugin — cost a worker ~8k tokens on every turn and leaked into what it did:
 * a worker answered in the operator's language and could write to the board
 * through the sober MCP server. Project settings still load (ADR 0068).
 */
const ISOLATED = ['--strict-mcp-config', '--setting-sources', 'project,local'] as const

/**
 * One host, as an adapter (§2.9): how it is asked whether it can run, how it is
 * invoked for one node, and how the events it writes are read back.
 *
 * The interface is deliberately a table rather than a class. Everything a host
 * differs in is data — three argument lists, one sentence, one line renderer —
 * and DESIGN §5.1's contract for an adapter is "build an invocation, stream its
 * output, report how it exited". Anything larger is SOBER learning to be an
 * agent framework, which ADR 0009 already refused.
 *
 * Every flag and every event shape below was read off the installed CLI at
 * implementation time, never from memory (BUILD-PLAN §6). The recordings are in
 * `docs/testing/v1x-4-other-hosts.tdd.md`.
 */
export interface Adapter {
	readonly id: string
	/**
	 * A second name the host answers to, where the id is not what the installer
	 * puts on the PATH. Only Cursor needs one, and the reason is in its adapter.
	 */
	readonly alias?: string
	/**
	 * The program to spawn, where it is not the host's own name. `openrouter`
	 * is SOBER's own loop, so the run line names the host and this names the
	 * binary that runs it.
	 */
	readonly command?: string
	/** Args that ask the host whether it can run at all, before a worktree exists. */
	readonly probe: readonly string[]
	/**
	 * How to ask whether the host's own *account* is out of runway — Claude's
	 * five-hour/seven-day windows, Codex's usage limit, OpenRouter's free-request
	 * quota — as opposed to `probe`, which only asks whether the CLI is
	 * installed and signed in (`limit-detect`). Absent on `opencode` and
	 * `cursor`: there is nothing here that answers the question, so those two
	 * hosts are never filtered on it.
	 */
	readonly availability?: {
		readonly argv: readonly string[]
		/** The reason the limit is gone, read from the probe's output — or null when it isn't. */
		readonly spent: (output: string) => string | null
		/** How full each usage window is, read from the same output — null when it says nothing. */
		readonly windows?: (output: string) => LimitWindows | null
	}
	/** How the user signs in, in the words they have to type (§8.7). */
	readonly signIn: (host: string) => string
	/** True, false, or null when the answer cannot be read — never a silent pass. */
	readonly loggedIn: (stdout: string) => boolean | null
	/** Argv after the host command, for one run. */
	readonly argv: (prompt: string, attended: boolean, run?: RunArgs) => readonly string[]
	/** Whether a watching human can reply to this host mid-run (ADR 0046). */
	readonly attendable: boolean
	/** One raw event, rendered — or null when the event is not this host's shape. */
	readonly line: (event: Event) => LogLineInput | readonly LogLineInput[] | null
}

export class UnknownHostError extends SoberError {
	constructor(host: string) {
		super(
			'host',
			`SOBER has no adapter for \`${host}\`. The hosts it can launch are ${ADAPTERS.map(
				(adapter) => adapter.id,
			).join(', ')} — set \`dispatch.host\` in \`.sober/config.jsonc\` to one of them.`,
		)
	}
}

/** Claude's own name for a window, in the words a person reads (`limit-detect`). */
const CLAUDE_WINDOWS: Readonly<Record<string, string>> = {
	five_hour: 'five-hour',
	seven_day: 'seven-day',
}

/** An epoch-seconds `resetsAt` as a clock time, in UTC so a test is never timezone-dependent. */
export const resetTime = (epochSeconds: unknown): string => {
	if (typeof epochSeconds !== 'number') return 'an unknown time'
	const at = new Date(epochSeconds * 1000)
	return `${String(at.getUTCHours()).padStart(2, '0')}:${String(at.getUTCMinutes()).padStart(2, '0')}`
}

/** One usage window: how full it is, 0 to 1, and when it resets, in epoch seconds. */
export interface LimitWindow {
	readonly used: number
	readonly resetsAt: number | null
}

export type LimitWindows = Readonly<Record<string, LimitWindow>>

interface RateLimitInfo {
	readonly status?: string
	readonly resetsAt?: number
	readonly rateLimitType?: string
	readonly unifiedWindows?: Readonly<
		Record<string, { readonly utilization?: number; readonly resetsAt?: number } | undefined>
	>
}

/** The first `rate_limit_event` in a Claude run's output. */
const rateLimitInfo = (output: string): RateLimitInfo | null => {
	for (const rawLine of output.split('\n')) {
		const line = rawLine.trim()
		if (line.length === 0) continue
		let event: { type?: string; rate_limit_info?: RateLimitInfo }
		try {
			event = JSON.parse(line) as typeof event
		} catch {
			continue
		}
		if (event.type === 'rate_limit_event' && event.rate_limit_info !== undefined)
			return event.rate_limit_info
	}
	return null
}

/**
 * Claude Code emits `rate_limit_event` on every run (captured in
 * `.sober/local/runs/*.log`). `status` is `allowed` or `allowed_warning` on a
 * window with runway left; anything else, or a window at 100% utilization
 * even under `allowed`, is the account out of runway.
 *
 * ponytail: only `allowed` has ever been captured — the rejected shape is
 * built from it rather than seen, and is the one to replace when a real
 * rejected event turns up.
 */
const claudeSpent = (output: string): string | null => {
	const info = rateLimitInfo(output)
	if (info === null) return null
	const windows = info.unifiedWindows ?? {}
	const full = Object.entries(windows).find(([, window]) => (window?.utilization ?? 0) >= 1)
	const ready =
		(info.status === 'allowed' || info.status === 'allowed_warning') && full === undefined
	if (ready) return null

	const key = full?.[0] ?? info.rateLimitType
	const name = key === undefined ? 'usage' : (CLAUDE_WINDOWS[key] ?? key.replace(/_/g, '-'))
	return `${name} limit, resets ${resetTime(full?.[1]?.resetsAt ?? info.resetsAt)}`
}

/** Each of Claude's windows, with its own reset time (ADR 0069). */
const claudeWindows = (output: string): LimitWindows | null => {
	const info = rateLimitInfo(output)
	const entries = Object.entries(info?.unifiedWindows ?? {}).flatMap(([key, window]) =>
		typeof window?.utilization === 'number'
			? [
					[
						CLAUDE_WINDOWS[key] ?? key.replace(/_/g, '-'),
						{ used: window.utilization, resetsAt: window.resetsAt ?? null },
					] as const,
				]
			: [],
	)
	return entries.length === 0 ? null : Object.fromEntries(entries)
}

/**
 * Claude Code. The only host with a flag for the system prompt and the only one
 * that reads stdin while it runs, which is why it is the only attendable one.
 */
const claude: Adapter = {
	id: 'claude',
	probe: ['auth', 'status', '--json'],
	signIn: (host) => `${host} auth login`,
	loggedIn: (stdout) => {
		try {
			const status = JSON.parse(stdout) as { loggedIn?: boolean }
			return typeof status.loggedIn === 'boolean' ? status.loggedIn : null
		} catch {
			return null
		}
	},
	argv: (prompt, attended, run = {}) => [
		'-p',
		prompt,
		...(attended ? ATTENDED_ARGS : HOST_ARGS),
		...(run.plugins == null ? [] : ISOLATED),
		'--settings',
		claudeSettings(run),
		...(run.effort == null ? [] : ['--effort', run.effort]),
		...(run.resume == null ? [] : ['--resume', run.resume]),
	],
	// Stripped to nothing but the request: the default environment made this
	// ~26k tokens of context to read one `rate_limit_event`; this is ~400.
	availability: {
		argv: [
			'-p',
			'ok',
			'--model',
			'haiku',
			'--output-format',
			'stream-json',
			'--verbose',
			'--strict-mcp-config',
			'--setting-sources',
			'',
			'--tools',
			'',
			'--system-prompt',
			'Reply ok.',
			'--disable-slash-commands',
			'--no-session-persistence',
		],
		spent: claudeSpent,
		windows: claudeWindows,
	},
	attendable: true,
	line: (event) => {
		if (event.type === 'system' && event.subtype === 'init')
			return {
				kind: 'started',
				// An alias run (ADR 0063) names the host CLI's own id, not the
				// literal argument SOBER passed — the init event is the only place
				// that says which model actually answered.
				text:
					event.model === undefined || event.model === ''
						? 'session started'
						: `session started (${event.model})`,
				tool: null,
			}

		// A tool's result comes back as a `user` message, paired to its call by
		// `tool_use_id`. The result names no tool, so `tool` stays null; `at`
		// stays null on every Claude line, because stream-json carries no time.
		if (event.type === 'user') {
			const outputs = (event.message?.content ?? []).flatMap((part): LogLineInput[] => {
				if (part.type !== 'tool_result') return []
				const text = resultText(part.content)
				return [
					{
						kind: 'output',
						text: summarize(text, part.is_error === true),
						call: part.tool_use_id ?? null,
						body: capBody(text),
					},
				]
			})
			if (outputs.length > 0) return outputs
		}

		// What the human said, echoed back by the host under
		// `--replay-user-messages` (ADR 0046). It is in the log so the transcript
		// holds both halves: a conversation where only one side was recorded is
		// not one anybody can audit afterwards, and the answers are the part
		// nobody else can reconstruct.
		//
		// The session check is what keeps a machine out of that half. Cursor
		// emits this exact shape on every run, carrying the brief SOBER just
		// sent, and an answer line holding `NO_HUMAN` is a sentence nobody said.
		// What separates them is what SOBER writes: an answer goes to stdin as
		// `{type, message}` and comes back echoed, with no session on it, while a
		// host echoing its own prompt stamps the session it belongs to.
		if (event.type === 'user' && event.session_id === undefined) {
			const said = (event.message?.content ?? [])
				.map((part) => (part.type === 'text' ? part.text?.trim() : null))
				.filter((text): text is string => typeof text === 'string' && text.length > 0)
			return said.length > 0 ? { kind: 'answer', text: said.join(' · '), tool: null } : null
		}

		if (event.type === 'assistant') {
			const lines = (event.message?.content ?? []).flatMap((part): LogLineInput[] => {
				if (part.type === 'tool_use' && part.name !== undefined && part.name.length > 0) {
					const key = CLAUDE_DETAIL[part.name]
					return [
						{
							kind: 'tool',
							text: part.name,
							tool: part.name,
							call: part.id ?? null,
							detail: key === undefined ? null : oneLine(part.input?.[key]),
						},
					]
				}
				const kind = part.type === 'text' ? 'text' : part.type === 'thinking' ? 'thinking' : null
				const text = (part.type === 'thinking' ? part.thinking : part.text)?.trim()
				return kind !== null && text !== undefined && text.length > 0
					? [{ kind, text, tool: null }]
					: []
			})
			return lines.length > 0 ? lines : null
		}

		if (event.type === 'result')
			return {
				kind: 'result',
				text: event.is_error === true ? `failed: ${event.subtype ?? 'error'}` : 'finished',
				tool: null,
			}

		return null
	},
}

/**
 * Codex's own words for a spent account, captured verbatim in
 * `~/.codex/sessions/2026/09/15/…`:
 * `{"error":{"message":"You've hit your usage limit. Upgrade to Pro
 * (https://chatgpt.com/explore/pro), visit
 * https://chatgpt.com/codex/settings/usage to purchase more credits or try
 * again at 2:59 PM."}}`. The `try again at …` tail is carried into the reason
 * when the message has one.
 */
const codexSpent = (output: string): string | null => {
	const found = /You've hit your usage limit\.[^"]*/.exec(output)
	if (found === null) return null
	const tail = /try again at [^".]+/i.exec(found[0])
	return tail === null ? 'usage limit' : `usage limit, ${tail[0]}`
}

interface CodexWindow {
	readonly usedPercent?: number
	readonly windowDurationMins?: number
	readonly resetsAt?: number
}

/**
 * The spent reason in `account/rateLimits/read`'s answer from `codex
 * app-server`, or null when there is runway. Shape recorded off codex-cli
 * 0.156.1: `{ordinaryUsageAllowed, rateLimits: {primary, secondary,
 * rateLimitReachedType}}`, where primary is the 300-minute window and
 * secondary the 10080-minute one.
 */
export const codexRateLimitsSpent = (answer: {
	readonly ordinaryUsageAllowed?: boolean
	readonly rateLimits?: {
		readonly primary?: CodexWindow | null
		readonly secondary?: CodexWindow | null
		readonly rateLimitReachedType?: string | null
	}
}): string | null => {
	const limits = answer.rateLimits
	const full = [limits?.primary, limits?.secondary].find(
		(window): window is CodexWindow => (window?.usedPercent ?? 0) >= 100,
	)
	if (
		full === undefined &&
		answer.ordinaryUsageAllowed !== false &&
		limits?.rateLimitReachedType == null
	)
		return null
	const window = full ?? limits?.secondary ?? limits?.primary
	const name =
		window?.windowDurationMins === 300
			? 'five-hour'
			: window?.windowDurationMins === 10080
				? 'seven-day'
				: 'usage'
	return `${name} limit, resets ${resetTime(window?.resetsAt)}`
}

/** Codex's two windows from `account/rateLimits/read`, named by their length. */
export const codexWindows = (answer: {
	readonly rateLimits?: {
		readonly primary?: CodexWindow | null
		readonly secondary?: CodexWindow | null
	}
}): LimitWindows | null => {
	const entries = [answer.rateLimits?.primary, answer.rateLimits?.secondary].flatMap((window) =>
		typeof window?.usedPercent === 'number'
			? [
					[
						window.windowDurationMins === 300
							? 'five-hour'
							: window.windowDurationMins === 10080
								? 'seven-day'
								: `${window.windowDurationMins ?? '?'}-minute`,
						{ used: window.usedPercent / 100, resetsAt: window.resetsAt ?? null },
					] as const,
				]
			: [],
	)
	return entries.length === 0 ? null : Object.fromEntries(entries)
}

/**
 * Codex. `codex exec` takes the prompt as its last argument and has no flag for
 * the system prompt, so `NO_HUMAN` goes in front of the brief instead — the M2
 * gate's finding 1 is a fact about hosts, not about Claude Code.
 *
 * Two things about the invocation are not guesses a reader would make:
 *
 * - `--dangerously-bypass-approvals-and-sandbox` is the analogue of Claude
 *   Code's `bypassPermissions`. A node's agent writes files and commits; a
 *   sandboxed run does neither and finishes with an empty branch.
 * - stdin must be closed, and `startAgent` already closes it for a headless
 *   run. `codex exec` prints "Reading additional input from stdin..." and waits
 *   when stdin is a pipe nobody writes to.
 */
const codex: Adapter = {
	id: 'codex',
	probe: ['login', 'status'],
	signIn: (host) => `${host} login`,
	loggedIn: (stdout) => {
		if (/logged in/i.test(stdout)) return !/not logged in/i.test(stdout)
		return null
	},
	// Codex's effort scale stops at `xhigh`. Isolated, it skips the operator's
	// config.toml — MCP servers, plugins, default model — and keeps the login.
	argv: (prompt, _attended, run = {}) => [
		'exec',
		...(run.resume == null ? [] : ['resume']),
		...(run.plugins == null ? [] : ['--ignore-user-config']),
		...(run.effort == null
			? []
			: ['-c', `model_reasoning_effort=${run.effort === 'max' ? 'xhigh' : run.effort}`]),
		'--json',
		'--dangerously-bypass-approvals-and-sandbox',
		...(run.resume == null ? [] : [run.resume]),
		brief(prompt),
	],
	// A minimal call on Codex's default model — the limit is the account's,
	// not any one model's, so which model answers does not matter here.
	availability: {
		argv: ['exec', '--ignore-user-config', '--json', '--skip-git-repo-check', 'Reply with ok.'],
		spent: codexSpent,
	},
	attendable: false,
	line: (event) => {
		if (event.type === 'thread.started')
			return { kind: 'started', text: 'session started', tool: null }
		if (event.type === 'turn.completed') return { kind: 'result', text: 'finished', tool: null }

		if (event.type === 'item.completed') {
			const item = event.item
			if (item?.type === 'agent_message') {
				const text = item.text?.trim()
				return text !== undefined && text.length > 0 ? { kind: 'text', text, tool: null } : null
			}
			if (item?.type === 'command_execution') {
				const command = item.command?.trim()
				if (command === undefined || command.length === 0) return null
				const call = item.id ?? null
				const ran: LogLineInput = {
					kind: 'tool',
					text: command,
					tool: 'command',
					call,
					detail: command,
				}
				// The completed item carries the result with the call, so both lines come from it.
				if (typeof item.exit_code !== 'number' && typeof item.aggregated_output !== 'string')
					return ran
				const output = item.aggregated_output ?? ''
				return [
					ran,
					{
						kind: 'output',
						text: typeof item.exit_code === 'number' ? `exit ${item.exit_code}` : summarize(output),
						tool: 'command',
						call,
						body: capBody(output),
					},
				]
			}
			// Codex reports its own complaints as items rather than on stderr, and
			// they are the sentences that explain why a run behaved oddly.
			if (item?.type === 'error') {
				const message = item.message?.trim()
				return message !== undefined && message.length > 0
					? { kind: 'raw', text: message, tool: null }
					: null
			}
		}

		return null
	},
}

/**
 * OpenCode. `opencode run` also takes the message positionally and also has no
 * system-prompt flag, so the same sentence goes in front of the brief.
 *
 * `--auto` is its `bypassPermissions`: without it a headless run stops at the
 * first write and waits for an approval nobody is there to give.
 *
 * It emits no event for the end of a run — only the end of each step — so a
 * run's outcome is read from how the process exited, which is where
 * `startAgent` reads it anyway. Rendering a step's end as a result would tell
 * the person watching that the run finished several times.
 */
const opencode: Adapter = {
	id: 'opencode',
	probe: ['providers', 'list'],
	signIn: (host) => `${host} auth login`,
	loggedIn: (stdout) => {
		// The box is coloured, so the count has to be found through the escapes.
		const found = /(\d+)\s+credential/i.exec(stdout)
		return found === null ? null : Number(found[1]) > 0
	},
	argv: (prompt, _attended, run = {}) => [
		'run',
		'--format',
		'json',
		'--auto',
		...(run.resume == null ? [] : ['--session', run.resume]),
		brief(prompt),
	],
	attendable: false,
	line: (event) => {
		if (event.type === 'text') {
			const text = event.part?.text?.trim()
			return text !== undefined && text.length > 0 ? { kind: 'text', text, tool: null } : null
		}
		if (event.type === 'tool_use') {
			const tool = event.part?.tool?.trim()
			if (tool === undefined || tool.length === 0) return null
			const call = event.part?.callID ?? null
			const state = event.part?.state
			// Only `command` is in the recording; other tools' input keys are not,
			// so their detail stays null rather than guessed.
			const ran: LogLineInput = {
				kind: 'tool',
				text: tool,
				tool,
				call,
				detail: oneLine(state?.input?.command),
			}
			if (state?.status !== 'completed' || typeof state.output !== 'string') return ran
			return [
				ran,
				{ kind: 'output', text: summarize(state.output), tool, call, body: capBody(state.output) },
			]
		}
		return null
	},
}

/**
 * Cursor. `agent -p` takes the prompt positionally and has no flag for the
 * system prompt, so `NO_HUMAN` goes in front of the brief — the third host in a
 * row for which that is true, and the second half of the M2 gate's finding 1
 * being a fact about hosts rather than about Claude Code.
 *
 * Three things about the invocation are not guesses a reader would make:
 *
 * - `--force` is the analogue of `bypassPermissions`, and the CLI reference is
 *   blunt about what its absence costs: "without `--force`, changes are only
 *   proposed, not applied". The run would finish, describe the work, and leave
 *   an empty branch.
 * - `--trust` is Cursor's alone. A dispatch cuts a worktree the host has never
 *   seen, and an untrusted workspace stops for a prompt nobody is there to
 *   answer. It is documented as headless-only, which is exactly this case.
 * - `status` is asked in text, not `--format json`. The flag exists; the keys
 *   of the object it prints are not in the reference, and the sentence is.
 *
 * Unlike Codex and OpenCode, this host can put a question on screen: its MCP client
 * supports elicitation, so `decide` asks through `ask.ts` here rather than
 * refusing (ADR 0010, ADR 0048).
 */
const cursor: Adapter = {
	id: 'cursor',
	/**
	 * The installed binary is `agent` — the most generic word on anybody's
	 * PATH. Answering to it would make every wrapper script called `agent` a
	 * Cursor invocation by accident, which is the small version of the
	 * unknown-host default this file refuses. So the host answers to its own
	 * name and to the one the installer writes, and `agent` is refused by name.
	 */
	alias: 'cursor-agent',
	probe: ['status'],
	signIn: (host) => `${host} login`,
	loggedIn: (stdout) => {
		if (/authenticated/i.test(stdout)) return !/not authenticated/i.test(stdout)
		return null
	},
	argv: (prompt) => ['-p', '--output-format', 'stream-json', '--force', '--trust', brief(prompt)],
	attendable: false,
	line: (event) => {
		// `tool_call` is the only shape that is Cursor's own. `system`, `user`,
		// `assistant` and `result` are Claude Code's, key for key, so the
		// adapter above already renders them and a second copy here would be
		// two renderers for one shape, waiting to disagree.
		//
		// A call is reported twice, `started` then `completed`. One line, at the
		// start: somebody watching a run wants what is happening, and the pair
		// would double every tool in the log.
		if (event.type !== 'tool_call' || event.subtype !== 'started') return null
		const [name, call] = Object.entries(event.tool_call ?? {})[0] ?? []
		if (name === undefined) return null
		// `readToolCall` and `writeToolCall` name themselves and carry the path
		// they touch; anything else arrives under `function`, with its own name.
		const tool = name === 'function' ? (call?.name ?? 'tool') : name.replace(/ToolCall$/, '')
		const path = call?.args?.path
		// No `call`, `detail` or output line: the documented shape carries no
		// correlator between `started` and `completed`, and a wrong pairing is
		// worse than none.
		return { kind: 'tool', text: path === undefined ? tool : `${tool} ${path}`, tool }
	},
}

/**
 * Cline (ADR 0066). Every flag and event shape below was read off the
 * published npm `cline` CLI at v3.0.65 (`npm view cline version`, matching
 * `cline/cline`'s `main` at the time this was written) — the recordings are in
 * `docs/testing/v1x-4-other-hosts.tdd.md`, and two of them come from source
 * rather than from docs.cline.bot, because the site and the CLI disagree.
 *
 * **The probe has no lightweight surface, and that is not a guess.** `cline
 * auth` and `cline config` are the two commands a reader would reach for, and
 * both were read off `apps/cli/src/commands/auth.ts` and `config.ts`: bare
 * `auth` opens a TUI and, without a TTY, only checks *that* — "interactive
 * auth setup requires a TTY" — never whether credentials already exist; bare
 * `config` without `--json` does the same (`docs/usage/cli-overview.md` calls
 * it "the interactive config view"), and `config --json` prints workflows,
 * rules, skills, hooks, agents, plugins, MCP servers and tools — never
 * providers or auth. `cline doctor` diagnoses stale local processes, not
 * credentials. `--version` answers whether the binary exists, not whether
 * anyone is signed in. None of the five reports login without doing work, so
 * there is no no-task probe to wire — a gap named in ADR 0066 rather than
 * papered over with one of these four.
 *
 * What genuinely is documented, in `apps/cli/README.md` and the repo's own
 * `AGENTS.md`: a non-interactive run with no saved credentials "fails fast
 * with an authentication message" — `AGENTS.md` names it exactly, "the
 * default `cline` provider fails fast with an `Unauthorized` error" — instead
 * of opening a browser. That is the one real signal the CLI gives, and using
 * it costs a trivial turn ("Reply with ok.") rather than nothing, the same
 * trade Claude Code's own `availability` probe already makes in this file.
 * `loggedIn` reads it defensively: a `done` event is signed in, an `error`
 * event whose message names the failure is not, anything else is unread
 * rather than guessed at (§2.8).
 *
 * **The run.** `--json` is documented as non-interactive, needing "either a
 * prompt argument or piped stdin" (`README.md`), so the brief goes in as the
 * trailing positional argument, the same shape as Codex, OpenCode and Cursor.
 * `--auto-approve true` is the explicit form of the CLI's own default — spelled
 * out rather than relied on, the way `bypassPermissions` is spelled out for
 * Claude Code. The reference documents `-s, --system <prompt>` too, but it
 * *replaces* Cline's own system prompt rather than adding to it
 * (`cli-reference.md`: "Override the default system prompt") — losing
 * whatever Cline's default prompt does for tool use is a worse trade than the
 * one every other flagless host already makes, so `NO_HUMAN` goes in front of
 * the brief like it does for them, not into `--system`.
 *
 * **The events.** `--json` output on docs.cline.bot is stale: it documents
 * `{"type": "say"|"ask", "text", "ts", "say", "ask", "partial"}`, a shape
 * nothing in the installed source emits. The real wrapper
 * (`apps/cli/src/utils/events.ts`, `handleEvent`) writes
 * `{ts, type: "agent_event", event}` for every one of the CLI's own
 * `AgentEvent`s (`sdk/packages/shared/src/agents/types.ts`), which is also
 * what the README's own `jq` example filters on
 * (`select(.type == "agent_event" and .event.text)`). `content_start` fires on
 * every streamed chunk — rendering it for text or reasoning would print a
 * message once per token, so only `content_end`, which carries the whole
 * turn's final text, becomes a line; a tool call is the opposite, one
 * `content_start` to say what is running and one `content_end` to say how it
 * went, which is the same "start once, finish once" split Claude Code's own
 * `tool_use`/`tool_result` pair keeps. `input` on a tool call is typed
 * `unknown` in the source — no key is common enough to read a one-line detail
 * from the way `CLAUDE_DETAIL` does, so `detail` stays null rather than
 * guessed at, the same call Cursor's adapter makes for an unnamed tool.
 */
const cline: Adapter = {
	id: 'cline',
	probe: ['--json', '--auto-approve', 'true', 'Reply with ok.'],
	signIn: (host) => `${host} auth`,
	loggedIn: (stdout) => {
		for (const rawLine of stdout.split('\n')) {
			const line = rawLine.trim()
			if (line.length === 0) continue
			let parsed: { type?: string; event?: { type?: string; error?: unknown } }
			try {
				parsed = JSON.parse(line) as typeof parsed
			} catch {
				continue
			}
			if (parsed.type !== 'agent_event' || parsed.event === undefined) continue
			if (parsed.event.type === 'done') return true
			if (parsed.event.type === 'error') {
				const message =
					typeof parsed.event.error === 'object' && parsed.event.error !== null
						? ((parsed.event.error as { message?: string }).message ?? '')
						: ''
				return /unauthor|credential|authenticat/i.test(message) ? false : null
			}
		}
		return null
	},
	argv: (prompt) => ['--json', '--auto-approve', 'true', brief(prompt)],
	attendable: false,
	line: (event) => {
		if (event.event === undefined) return null
		const inner = event.event

		if (inner.type === 'content_end') {
			if (inner.contentType === 'text') {
				const text = inner.text?.trim()
				return text !== undefined && text.length > 0 ? { kind: 'text', text, tool: null } : null
			}
			if (inner.contentType === 'reasoning') {
				const text = inner.reasoning?.trim()
				return text !== undefined && text.length > 0 ? { kind: 'thinking', text, tool: null } : null
			}
			if (inner.contentType === 'tool') {
				const tool = inner.toolName ?? 'tool'
				const call = inner.toolCallId ?? null
				const failure = typeof inner.error === 'string' ? inner.error : undefined
				if (failure !== undefined)
					return {
						kind: 'output',
						text: `error: ${summarize(failure)}`,
						tool,
						call,
						body: capBody(failure),
					}
				const output =
					typeof inner.output === 'string'
						? inner.output
						: inner.output === undefined
							? ''
							: JSON.stringify(inner.output)
				return { kind: 'output', text: summarize(output), tool, call, body: capBody(output) }
			}
			return null
		}

		if (inner.type === 'content_start' && inner.contentType === 'tool') {
			const tool = inner.toolName ?? 'tool'
			return { kind: 'tool', text: tool, tool, call: inner.toolCallId ?? null, detail: null }
		}

		if (inner.type === 'done')
			return {
				kind: 'result',
				text: inner.reason === 'completed' ? 'finished' : `failed: ${inner.reason ?? 'stopped'}`,
				tool: null,
			}

		if (inner.type === 'error') {
			const runError =
				typeof inner.error === 'object' && inner.error !== null
					? (inner.error as { message?: string })
					: undefined
			const message = runError?.message?.trim()
			return message !== undefined && message.length > 0
				? { kind: 'raw', text: message, tool: null }
				: null
		}

		return null
	},
}

/**
 * The brief, for a host with nowhere else to put the system prompt. The
 * sentence goes first and is separated by a rule, so a model reading the two as
 * one document still reads them as two things.
 */
const brief = (prompt: string): string => `${NO_HUMAN}\n\n---\n\n${prompt}`

/**
 * OpenRouter, through SOBER's own tool loop (ADR 0062). There is no CLI: the
 * run line's own args come first, so the spawn is `sober --model <id>
 * [--base-url <u>] agent <brief>` and the probe is `sober agent --check`,
 * which reads `OPENROUTER_API_KEY` off the environment the dispatcher loaded
 * and asks the endpoint whether the key is accepted.
 */
/**
 * `sober agent --check` prints `spent: <reason>` itself, from the same
 * `/auth/key` body it already fetches (`data.free_model_daily_requests` and
 * `data.limit_remaining`, captured today), and a run prints it on stderr for a
 * 429 left after the loop's retries. This only reads the line the CLI already
 * classified, so the probe and a run's fall to its backup share one pattern.
 */
const openrouterSpent = (output: string): string | null => {
	const found = /^spent: (.+)$/m.exec(output)
	return found === null ? null : (found[1]?.trim() ?? null)
}

const openrouter: Adapter = {
	id: 'openrouter',
	command: 'sober',
	probe: ['agent', '--check'],
	signIn: () => 'set OPENROUTER_API_KEY in .sober/.env',
	loggedIn: (stdout) =>
		/^ok\b/m.test(stdout) ? true : /no key|401|unauthori[sz]ed/i.test(stdout) ? false : null,
	argv: (prompt) => ['agent', brief(prompt)],
	availability: {
		argv: ['agent', '--check'],
		spent: openrouterSpent,
	},
	attendable: false,
	line: (event) => {
		if (event.type !== 'sober') return null
		// The loop writes `LogLine`s already; the parse is what keeps a stray
		// line from crashing the reader rather than being dropped.
		const { type: _, ...line } = event
		const parsed = LogLine.safeParse(line)
		return parsed.success ? parsed.data : null
	},
}

export const ADAPTERS: readonly Adapter[] = [claude, codex, opencode, cursor, openrouter, cline]

/**
 * `dispatch.host` is a command line rather than a program name, so the adapter
 * is found by looking for a known host anywhere in it: `npx codex`,
 * `/opt/homebrew/bin/codex --model x` and a wrapper script called `codex.sh`
 * are all Codex. Directories and one extension are stripped, and nothing else —
 * a name has to *be* the host's, or the second one its adapter answers to, which
 * only Cursor has because its installed binary is not called `cursor`.
 *
 * An unknown host is refused rather than defaulted. Falling back to the Claude
 * Code invocation would send `--permission-mode` to a CLI with no such flag,
 * and the failure would arrive as an exit code nobody can read. The cost is
 * that a wrapper has to be named after what it wraps, which the refusal says.
 */
export const adapterFor = (host: string): Adapter => {
	const [command, args] = hostCommand(host)
	for (const word of [command, ...args]) {
		const name = (word.split(/[\\/]/).at(-1) ?? '').replace(/\.[^.]+$/, '')
		const found = ADAPTERS.find((adapter) => adapter.id === name || adapter.alias === name)
		if (found !== undefined) return found
	}
	throw new UnknownHostError(host)
}

/**
 * The reason a host's account is out of runway, read from its `availability`
 * probe's output — or null when it is ready, or when the host has no
 * `availability` table at all (`opencode`, `cursor`), which is what keeps
 * those two from ever being filtered on it.
 */
export const limitSpent = (host: string, output: string): string | null =>
	adapterFor(host).availability?.spent(output) ?? null

/** How full each of a host's usage windows is, from the same output as `limitSpent`. */
export const limitWindows = (host: string, output: string): LimitWindows | null =>
	adapterFor(host).availability?.windows?.(output) ?? null

/**
 * One raw event, whatever host wrote it. Read in order, and the first adapter
 * that recognises the shape owns the line — which is what lets a run started
 * under one host still render after `dispatch.host` changes.
 */
export const renderLine = (event: Event): readonly LogLine[] => {
	for (const adapter of ADAPTERS) {
		const result = adapter.line(event)
		if (result !== null)
			return ('kind' in result ? [result] : result).map((line) => LogLine.parse(line))
	}
	return []
}

/** What a run's events say about the session and its spend, folded one event at a time. */
export interface Tally {
	readonly session: string | null
	readonly turns: number | null
	readonly contextPeak: number | null
	readonly cost: number | null
}

export const EMPTY_TALLY: Tally = { session: null, turns: null, contextPeak: null, cost: null }

/**
 * Only Claude Code reports turns, context and cost; the other hosts give a
 * session id and nothing else here. The first session named wins: a resumed
 * Claude session keeps its id, and nothing later may swap it for another.
 */
export const tally = (sum: Tally, event: Event): Tally => {
	const session =
		sum.session ??
		(event.type === 'system' && event.subtype === 'init' ? event.session_id : undefined) ??
		(event.type === 'thread.started' ? event.thread_id : undefined) ??
		event.sessionID ??
		null
	const usage = event.type === 'assistant' ? event.message?.usage : undefined
	const context =
		usage === undefined
			? null
			: (usage.input_tokens ?? 0) +
				(usage.cache_read_input_tokens ?? 0) +
				(usage.cache_creation_input_tokens ?? 0)
	const result = event.type === 'result'
	return {
		session,
		turns: result && typeof event.num_turns === 'number' ? event.num_turns : sum.turns,
		contextPeak: context === null ? sum.contextPeak : Math.max(sum.contextPeak ?? 0, context),
		cost: result && typeof event.total_cost_usd === 'number' ? event.total_cost_usd : sum.cost,
	}
}

/** The skills a run was told to use that its host's `init` did not load. Null when the event does not say. */
export const missingSkills = (wanted: readonly string[], event: Event): string[] | null => {
	if (event.type !== 'system' || event.subtype !== 'init' || !Array.isArray(event.skills))
		return null
	const loaded = event.skills
	return wanted.filter(
		(name) => !loaded.some((skill) => skill === name || skill.endsWith(`:${name}`)),
	)
}

/** The union of what the five hosts write, read defensively at every level. */
export interface Event {
	readonly type?: string
	readonly subtype?: string
	readonly is_error?: boolean
	/** Stamped by a host on its own events, never on an answer SOBER wrote. */
	readonly session_id?: string
	/** Codex's `thread.started`. */
	readonly thread_id?: string
	/** OpenCode stamps its session on every event. */
	readonly sessionID?: string
	/** Claude Code's `system`/`init` event: the id an alias like `opus` resolved to. */
	readonly model?: string
	/** Claude Code's `system`/`init` event: the skills it loaded, a plugin's as `plugin:skill`. */
	readonly skills?: readonly string[]
	/** Claude Code's final `result` event. */
	readonly num_turns?: number
	readonly total_cost_usd?: number
	readonly result?: string
	readonly message?: {
		readonly usage?: {
			readonly input_tokens?: number
			readonly cache_read_input_tokens?: number
			readonly cache_creation_input_tokens?: number
		}
		readonly content?: readonly {
			readonly type?: string
			readonly text?: string
			readonly thinking?: string
			readonly name?: string
			/** A `tool_use` part's call id and arguments. */
			readonly id?: string
			readonly input?: Readonly<Record<string, unknown>>
			/** A `tool_result` part: the call it answers and what came back. */
			readonly tool_use_id?: string
			readonly content?: string | readonly { readonly type?: string; readonly text?: string }[]
			readonly is_error?: boolean
		}[]
	}
	/** Codex: one item in a turn. */
	readonly item?: {
		readonly id?: string
		readonly type?: string
		readonly text?: string
		readonly command?: string
		readonly message?: string
		readonly aggregated_output?: string
		readonly exit_code?: number
	}
	/** Cursor: one tool call, under a key that names the tool that made it. */
	readonly tool_call?: Readonly<
		Record<
			string,
			{ readonly name?: string; readonly args?: { readonly path?: string } } | undefined
		>
	>
	/** SOBER's own loop: a `LogLine`, stamped `type: 'sober'`. */
	readonly kind?: string
	readonly text?: string
	readonly tool?: string | null
	readonly at?: string | null
	readonly call?: string | null
	readonly detail?: string | null
	readonly body?: string | null
	/** OpenCode: one part of a step. */
	readonly part?: {
		readonly type?: string
		readonly text?: string
		readonly tool?: string
		readonly callID?: string
		readonly state?: {
			readonly status?: string
			readonly input?: Readonly<Record<string, unknown>>
			readonly output?: string
		}
	}
	/**
	 * Cline: one `AgentEvent`, wrapped as `{ts, type: 'agent_event', event}`
	 * (`apps/cli/src/utils/events.ts`). `error` is `string` on a tool's own
	 * `content_end` and the serialized `Error` (`{name, message, stack}`) on the
	 * run-level `error` event — one field name, two shapes, told apart by
	 * `inner.type` in `line`.
	 */
	readonly event?: {
		readonly type?: string
		readonly contentType?: string
		readonly text?: string
		readonly reasoning?: string
		readonly toolName?: string
		readonly toolCallId?: string
		readonly output?: unknown
		readonly error?: string | Readonly<Record<string, unknown>>
		readonly reason?: string
		readonly iterations?: number
		readonly iteration?: number
		readonly recoverable?: boolean
	}
}
