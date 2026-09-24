import { runAgent } from '@besober/core'
import { fail } from './out.js'

const DEFAULT_BASE = 'https://openrouter.ai/api/v1'

/**
 * The `openrouter` host's process (ADR 0062). The adapter spawns
 * `sober --model <id> [--base-url <u>] agent <brief>` for a run and
 * `sober agent --check` for the probe.
 *
 * The key is read off `process.env`: the dispatcher already ran `loadEnv` on
 * the board's `.sober/.env`, and `spawn` inherits the environment, so the
 * worktree needs no `.env` of its own.
 */
export interface AgentCommand {
	readonly check: boolean
	readonly prompt?: string
	readonly model?: string
	readonly baseUrl?: string
	readonly fetch?: typeof fetch
}

/**
 * `/auth/key`'s body, captured today:
 * `{"data":{"limit":null,"limit_remaining":null,…,"is_free_tier":false,
 * "free_model_daily_requests":{"used":0,"limit":50,"remaining":50},…}}`.
 * Zero of either remaining is the account out of runway, not a bad key — the
 * 200 already said the key was accepted.
 */
const spentReason = async (response: Response): Promise<string | null> => {
	let body: {
		data?: {
			limit_remaining?: number | null
			free_model_daily_requests?: { remaining?: number }
		}
	}
	try {
		body = (await response.json()) as typeof body
	} catch {
		return null
	}
	if (body.data?.free_model_daily_requests?.remaining === 0)
		return 'the free-model daily quota is used up'
	if (body.data?.limit_remaining === 0) return 'the account request quota is used up'
	return null
}

/** Exit code; the caller decides what to do with the process. */
export const agent = async (options: AgentCommand): Promise<number> => {
	const key = process.env.OPENROUTER_API_KEY
	const base = (options.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '')
	const fetchFn = options.fetch ?? fetch

	if (options.check) {
		if (key === undefined || key.length === 0) {
			process.stdout.write('no key: set OPENROUTER_API_KEY in .sober/.env\n')
			return 1
		}
		// OpenRouter's `/models` is public, so it accepts any key; `/auth/key`
		// is what refuses a bad one. Another endpoint behind `--base-url` has no
		// `/auth/key`, and its `/models` does want the bearer.
		const headers = { authorization: `Bearer ${key}` }
		let response = await fetchFn(`${base}/auth/key`, { headers })
		let viaModels = false
		if (response.status === 404) {
			viaModels = true
			response = await fetchFn(`${base}/models`, { headers })
		}
		if (response.status === 200) {
			// `/models` has no usage fields, so a fallback endpoint is read as
			// `ok` — there is nothing here to classify from (`limit-detect`).
			const spent = viaModels ? null : await spentReason(response)
			process.stdout.write(spent === null ? 'ok\n' : `spent: ${spent}\n`)
			return 0
		}
		process.stdout.write(
			response.status === 401 ? '401: the key was refused\n' : `${response.status}\n`,
		)
		return 1
	}

	const model = options.model ?? fail('which model? sober --model <id> agent <prompt>')
	const prompt = options.prompt ?? fail('sober --model <id> agent <prompt>')
	if (key === undefined || key.length === 0)
		return fail('no key: set OPENROUTER_API_KEY in .sober/.env')

	// `sober stop` sends SIGTERM to this pid; the loop reads the signal
	// between turns, so the run ends as `stopped` rather than mid-write.
	const controller = new AbortController()
	for (const signal of ['SIGTERM', 'SIGINT'] as const)
		process.once(signal, () => controller.abort())

	const exit = await runAgent({
		model,
		baseUrl: base,
		apiKey: key,
		cwd: process.cwd(),
		prompt,
		signal: controller.signal,
		fetch: fetchFn,
		onLine: (line) => process.stdout.write(`${JSON.stringify({ type: 'sober', ...line })}\n`),
	})
	if (exit.kind === 'failed') {
		process.stderr.write(`${exit.reason}\n`)
		return 1
	}
	return 0
}
