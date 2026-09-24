/** Where the token is kept between loads. `sessionStorage` in a browser. */
export interface TokenStore {
	getItem(key: string): string | null
	setItem(key: string, value: string): void
}

const KEY = 'sober.token'

/**
 * The token reaches the browser in the fragment, and nowhere else.
 *
 * `/` has to answer an unauthenticated GET — a browser opening a printed
 * address sends no `Authorization` header — so the token cannot be served in
 * the page: any process on this machine that guessed the port would read it,
 * and stopping exactly that is what the token is for. A query string would put
 * it in the server's log line and in `Referer`. A fragment is the one part of a
 * URL a browser keeps to itself.
 *
 * It is put away because the caller strips it from the address bar straight
 * after, and a reload has to find it again. The port changes on every start, so
 * a stale token is left behind on an origin nothing will visit twice.
 */
export const claimToken = (hash: string, store: TokenStore): string | null => {
	const given = hash.replace(/^#/, '').trim()
	if (given === '') return store.getItem(KEY)
	store.setItem(KEY, given)
	return given
}

export interface Wire {
	read<T>(name: string, params?: Readonly<Record<string, string>>): Promise<T>
	op<T>(name: string, body: unknown): Promise<T>
	/**
	 * A channel that stays open, one message at a time (ADR 0046). Resolves when
	 * the server hangs up — which it does the moment the thing being watched
	 * cannot change again — or when `signal` is aborted.
	 */
	watch<T>(
		name: string,
		params: Readonly<Record<string, string>>,
		onMessage: (message: T) => void,
		signal?: AbortSignal,
	): Promise<void>
}

/**
 * One route per read and one per operation (ADR 0036). Errors come back as
 * `{ error }` and are worth more than the status code: the server writes them
 * for a person to act on.
 *
 * Every URL is relative, so the page's own origin is the server by
 * construction and this module never reads `location`. There is no second
 * origin to reach: the client is served by the thing it talks to.
 */
export const wire = (token: string, fetcher: typeof fetch = fetch): Wire => {
	const send = async <T>(url: string, init: RequestInit): Promise<T> => {
		let response: Response
		try {
			response = await fetcher(url, {
				...init,
				headers: { ...init.headers, authorization: `Bearer ${token}` },
			})
		} catch {
			// `sober dashboard` runs in the foreground, so Ctrl-C is how it
			// ordinarily ends and this tab is what finds out. "Failed to fetch" is
			// the browser's problem; the person's is that the command stopped.
			throw new Error('the dashboard server has stopped — `sober dashboard` is no longer running')
		}

		if (!response.ok) throw new Error(await refusal(response))
		return (await response.json()) as T
	}

	return {
		read: <T>(name: string, params: Readonly<Record<string, string>> = {}): Promise<T> => {
			const query = new URLSearchParams(params).toString()
			return send<T>(`/read/${name}${query === '' ? '' : `?${query}`}`, {})
		},

		op: <T>(name: string, body: unknown): Promise<T> =>
			send<T>(`/op/${name}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
			}),

		/**
		 * A streaming `fetch` rather than an `EventSource`, and the difference is
		 * the header. `EventSource` cannot set one, which is why ADR 0036 priced
		 * this work at moving the loopback token into the URL; a reader over
		 * `response.body` keeps `Authorization` and ADR 0008's rule with it.
		 *
		 * The refusal path is the one every other route uses, because the server
		 * refuses before it writes a status: once the channel is open there is no
		 * status left to send, so a watch that gets past this line is a watch that
		 * was accepted.
		 */
		watch: async <T>(
			name: string,
			params: Readonly<Record<string, string>>,
			onMessage: (message: T) => void,
			signal?: AbortSignal,
		): Promise<void> => {
			const query = new URLSearchParams(params).toString()
			let response: Response
			try {
				response = await fetcher(`/watch/${name}?${query}`, {
					headers: { authorization: `Bearer ${token}` },
					signal,
				})
			} catch (error) {
				// An abort is the caller closing the screen, not a failure to report.
				if (signal?.aborted === true) return
				throw error instanceof Error && error.name === 'AbortError'
					? error
					: new Error('the dashboard server has stopped — `sober dashboard` is no longer running')
			}

			if (!response.ok || response.body === null) throw new Error(await refusal(response))

			const reader = response.body.getReader()
			const decoder = new TextDecoder()
			// Messages are newline-delimited, and a chunk boundary is not a message
			// boundary: the tail of a partial line is carried to the next chunk
			// rather than parsed as its own broken one.
			let rest = ''
			try {
				for (;;) {
					const { done, value } = await reader.read()
					if (done) break
					rest += decoder.decode(value, { stream: true })
					const parts = rest.split('\n')
					rest = parts.pop() ?? ''
					for (const part of parts) if (part.trim() !== '') onMessage(JSON.parse(part) as T)
				}
			} catch (error) {
				// The server going away mid-stream is how this ordinarily ends when
				// someone presses Ctrl-C, and the screen has already shown
				// everything up to that point.
				if (signal?.aborted !== true) throw error
			} finally {
				await reader.cancel().catch(() => {})
			}
		},
	}
}

/** A proxy or a crash can answer in HTML, and then the status is all there is. */
const refusal = async (response: Response): Promise<string> => {
	const said = await response.text()
	try {
		const { error } = JSON.parse(said) as { error?: unknown }
		if (typeof error === 'string' && error !== '') return error
	} catch {
		// Not JSON. The status carries the whole message.
	}
	return `the server answered ${response.status} and said nothing a client can read`
}
