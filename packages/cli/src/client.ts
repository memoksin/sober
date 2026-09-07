import type { Client } from '@besober/server'

/**
 * The built dashboard, substituted by the bundler (`build.mjs`). It is a
 * literal in the binary rather than a directory beside it, which is what lets
 * the server hand assets over without ever opening a file — see
 * `packages/server/src/client.ts`.
 */
declare const __SOBER_CLIENT__: Client

export const built = (): Client | undefined => {
	try {
		return __SOBER_CLIENT__
	} catch {
		// Unbundled — the source run has no built dashboard, and `/` says so.
		return undefined
	}
}
