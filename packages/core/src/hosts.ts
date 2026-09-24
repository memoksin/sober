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
	}
	/** How the user signs in, in the words they have to type (§8.7). */
	readonly signIn: (host: string) => string
	/** True, false, or null when the answer cannot be read — never a silent pass. */
	readonly loggedIn: (stdout: string) => boolean | null
	/** Argv after the host command, for one run. */
	readonly argv: (prompt: string, attended: boolean) => readonly string[]
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
const resetTime = (epochSeconds: unknown): string => {
	if (typeof epochSeconds !== 'number') return 'an unknown time'
	const at = new Date(epochSeconds * 1000)
	return `${String(at.getUTCHours()).padStart(2, '0')}:${String(at.getUTCMinutes()).padStart(2, '0')}`
}

interface RateLimitInfo {
	readonly status?: string
	readonly resetsAt?: number
	readonly rateLimitType?: string
	readonly unifiedWindows?: Readonly<Record<string, { readonly utilization?: number }>>
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
	for (const rawLine of output.split('\n')) {
		const line = rawLine.trim()
		if (line.length === 0) continue
		let event: { type?: string; rate_limit_info?: RateLimitInfo }
		try {
			event = JSON.parse(line) as typeof event
		} catch {
			continue
		}
		if (event.type !== 'rate_limit_event' || event.rate_limit_info === undefined) continue

		const info = event.rate_limit_info
		const windows = info.unifiedWindows ?? {}
		const full = Object.entries(windows).find(([, window]) => (window?.utilization ?? 0) >= 1)
		const ready =
			(info.status === 'allowed' || info.status === 'allowed_warning') && full === undefined
		if (ready) return null

		const key = full?.[0] ?? info.rateLimitType
		const name = key === undefined ? 'usage' : (CLAUDE_WINDOWS[key] ?? key.replace(/_/g, '-'))
		return `${name} limit, resets ${resetTime(info.resetsAt)}`
	}
	return null
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
	argv: (prompt, attended) => ['-p', prompt, ...(attended ? ATTENDED_ARGS : HOST_ARGS)],
	availability: {
		argv: [
			'-p',
			'Reply with ok.',
			'--model',
			'haiku',
			'--output-format',
			'stream-json',
			'--verbose',
		],
		spent: claudeSpent,
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
	argv: (prompt) => ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', brief(prompt)],
	// A minimal call on Codex's default model — the limit is the account's,
	// not any one model's, so which model answers does not matter here.
	availability: {
		argv: ['exec', '--json', '--skip-git-repo-check', 'Reply with ok.'],
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
	argv: (prompt) => ['run', '--format', 'json', '--auto', brief(prompt)],
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
 * `data.limit_remaining`, captured today). A 429 on one free model is that
 * model's own upstream pool, not the host — this only reads the line the CLI
 * already classified.
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

export const ADAPTERS: readonly Adapter[] = [claude, codex, opencode, cursor, openrouter]

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

/** The union of what the five hosts write, read defensively at every level. */
export interface Event {
	readonly type?: string
	readonly subtype?: string
	readonly is_error?: boolean
	/** Stamped by a host on its own events, never on an answer SOBER wrote. */
	readonly session_id?: string
	/** Claude Code's `system`/`init` event: the id an alias like `opus` resolved to. */
	readonly model?: string
	readonly message?: {
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
}
