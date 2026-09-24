import { SoberError } from './errors.js'
import { loadBoard } from './graph.js'
import { appendEvent, appendRunInput } from './local.js'
import type { Paths } from './paths.js'
import { lastRun } from './status.js'

export interface Answering {
	/**
	 * End the conversation after saying this. An attended host exits when its
	 * input closes, so this is how a run finishes on its own rather than being
	 * killed by `stop` or outlived by the dispatch timeout.
	 */
	readonly done?: boolean
}

export interface Answered {
	readonly run: string
	readonly done: boolean
}

/**
 * Talking back to a run somebody is watching (ADR 0046, `SCOPE.md`'s "watching
 * a dispatched agent, answering its prompts").
 *
 * It writes to a file rather than to the host, and that is the whole design.
 * Answering is available from every surface (`PR-09-08`), so the caller is
 * usually not the process holding the host's stdin — it is the dashboard
 * server, or a second terminal. `stop` has the same shape for the same reason,
 * and it is the shape that works on all three platforms this ships to.
 *
 * The process that owns the run reads this file and relays it. Nothing here
 * reaches into another process, which is the property `c708806` was written to
 * protect: this product has already shipped one bug where a second process
 * acted on a pid it did not own.
 */
export const answerRun = async (
	paths: Paths,
	node: string,
	text: string,
	{ done = false }: Answering = {},
): Promise<Answered> => {
	const found = lastRun(await loadBoard(paths), node)

	if (found === null)
		throw new SoberError('no-run', `${node} has not run yet — there is nothing to answer`)

	if (found.run.exit !== null)
		throw new SoberError(
			'no-run',
			`${node} is not running — its last run ${found.run.exit}, and a finished session cannot be answered`,
		)

	// A headless run is told nobody is reading it and is given no stdin at all
	// (`host.ts`), so an answer would go nowhere. Saying that is better than
	// accepting the words and dropping them.
	if (!found.run.attended)
		throw new SoberError(
			'no-run',
			`${node} was started headless, so nothing is listening — run it from the dashboard to watch and answer it`,
		)

	await appendRunInput(paths, found.id, JSON.stringify({ text, done }))
	await appendEvent(paths, { action: 'run.answered', node, run: found.id })

	return { run: found.id, done }
}
