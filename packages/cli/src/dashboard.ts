import { serve } from '@besober/server'
import { openBoard } from './board.js'
import { bold, cyan, dim, green, say } from './out.js'

/**
 * The dashboard's server, in the foreground (ADR 0037). It does not fork, it
 * does not write a pid file, and closing the browser stops nothing: the
 * lifetime of this process is the lifetime of the server, and of every run
 * started from the screen.
 *
 * ADR 0008's original wording had the server dying with the dashboard. That
 * sentence was written to say "not hosted, no account", and read literally
 * after ADR 0036 put `run` on the screen it would tie the most expensive
 * operation in the product to closing a tab. 0037 corrected it; this is the
 * correction in code.
 *
 * The token is printed rather than hidden. It is a loopback credential that
 * lives as long as this process, the person reading it is the person it
 * belongs to, and a credential nobody can see is a credential nobody can use
 * from `curl` when the screen is the thing that is broken.
 */
export const dashboard = async (port?: number): Promise<void> => {
	const paths = await openBoard()
	const served = await serve({ paths, port })

	say(`${green('✓')} the board is served at ${cyan(bold(served.url))}`)
	say()
	// The token sits alone on its line. It was printed as `token <value>` for
	// one commit, and the first person to use it copied the label with the
	// value and got a 401 that blamed the token. A line whose whole content is
	// the thing to copy cannot be copied wrong.
	say(dim('  token, for a client that is not the browser:'))
	say(`  ${served.token}`)
	say()
	say(dim('  A new token is minted every time this starts. The old one stops working.'))
	say(dim('  Ctrl-C stops it, and stops any run it started. Closing the browser does not.'))

	// Two signals, one exit. Without this the process leaves a listening socket
	// behind on a terminal that has already gone.
	const stop = (): void => {
		void served.close().then(() => {
			say()
			say(dim('the board is no longer served'))
			process.exit(0)
		})
	}
	process.on('SIGINT', stop)
	process.on('SIGTERM', stop)

	// Nothing to await: the server holds the loop open, which is the point.
	await new Promise<never>(() => {})
}
