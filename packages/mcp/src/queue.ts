import { type Paths, runQueue, SoberError } from '@besober/core'

/**
 * "Approve and queue" (D26, ADR 0017): accepting a node and answering a
 * decision are the two things that make a node ready, so they are the two
 * places the queue is read. It is appended to whatever the tool was going to
 * say — a run that started without being asked for is never silent.
 */
export const drained = async (paths: Paths, base: string): Promise<string> => {
	const queued = await runQueue(paths, base)
	const lines: string[] = []

	for (const [index, result] of queued.dispatched.entries()) {
		const node = queued.started[index] ?? ''
		lines.push(
			result instanceof SoberError
				? `${node}: ${result.message}`
				: `${node} ${result.exit}${result.error === null ? '' : ` — ${result.error}`}`,
		)
	}
	if (queued.dispatched.length < queued.started.length)
		lines.push(
			'The rest of the queue was not started: nothing is built on a result nobody has seen.',
		)
	for (const one of queued.held) lines.push(`${one.id} was not started — ${one.why}`)

	return lines.length === 0
		? ''
		: `\n\nThe queue moved:\n${lines.map((line) => `- ${line}`).join('\n')}`
}
