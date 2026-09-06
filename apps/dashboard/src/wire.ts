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
}

/**
 * One route per read (ADR 0036). Errors come back as `{ error }` and are worth
 * more than the status code: the server writes them for a person to act on.
 */
export const wire = (token: string, fetcher: typeof fetch = fetch): Wire => ({
	read: async <T>(name: string, params: Readonly<Record<string, string>> = {}): Promise<T> => {
		// Relative, so the page's own origin is the server by construction and
		// this module never reads `location`. There is no second origin to reach:
		// the client is served by the thing it talks to.
		const query = new URLSearchParams(params).toString()
		const url = `/read/${name}${query === '' ? '' : `?${query}`}`

		let response: Response
		try {
			response = await fetcher(url, { headers: { authorization: `Bearer ${token}` } })
		} catch {
			// `sober dashboard` runs in the foreground, so Ctrl-C is how it
			// ordinarily ends and this tab is what finds out. "Failed to fetch" is
			// the browser's problem; the person's is that the command stopped.
			throw new Error('the dashboard server has stopped — `sober dashboard` is no longer running')
		}

		if (!response.ok) throw new Error(await refusal(response))
		return (await response.json()) as T
	},
})

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
