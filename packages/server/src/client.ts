/** One built file, as the server hands it over. */
export interface Asset {
	readonly type: string
	readonly body: string
}

/**
 * The built dashboard, keyed by the path it is served at — `/index.html`,
 * `/assets/…`. It is a value rather than a directory on purpose: the server
 * never opens a file, so `only-core-touches-the-machine` stays a rule with no
 * exceptions, and `sober dashboard` works the same from wherever it was
 * installed. The CLI's bundler is what fills it in (ADR 0007 inlines
 * everything anyway).
 */
export type Client = Readonly<Record<string, Asset>>
