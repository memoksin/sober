import { type Paths, runQueue, SoberError } from '@besober/core'
import { columns, cyan, dim, green, red, say, spinner, yellow } from './out.js'

/**
 * "Approve and queue" (D26, ADR 0017). The graph has just moved — a node was
 * accepted, or a decision was answered — so whatever was approved ahead of time
 * and is now ready starts, without asking again.
 *
 * It is loud on purpose. This is the one place SOBER spends money on a command
 * the user did not point at a node, so it says what it is starting before it
 * starts, and what happened after.
 */
export const drain = async (paths: Paths, base: string): Promise<void> => {
	const spin = spinner('the queue')
	const queued = await runQueue(paths, base, {
		onStart: (nodes) => {
			spin.clear()
			say()
			say(
				`${dim('·')} ${nodes.length} queued node${nodes.length === 1 ? '' : 's'} ${dim(`starting on ${base} — approved ahead of time`)}`,
			)
			say(dim(`  ${nodes.join(', ')}`))
		},
	}).finally(() => spin.stop())

	for (const [index, result] of queued.dispatched.entries()) {
		const node = queued.started[index] ?? ''
		if (result instanceof SoberError) {
			say(`${red('×')} ${node}: ${result.message}`)
			continue
		}
		say(
			result.exit === 'finished'
				? `${green('✓')} ${node} finished — review it with \`sober review ${node}\``
				: `${red('×')} ${node} ${result.exit}${result.error === null ? '' : `: ${result.error}`}`,
		)
	}
	if (queued.dispatched.length < queued.started.length)
		say(
			dim(
				'  the rest of the queue was not started — nothing is built on a result you have not seen',
			),
		)

	if (queued.held.length === 0) return
	say()
	say(
		`${yellow('·')} ${queued.held.length} queued node${queued.held.length === 1 ? '' : 's'} waiting for you`,
	)
	say(columns(queued.held.map((one) => [`  ${cyan(one.id)}`, dim(one.why)])).join('\n'))
	say(
		dim('  Start one yourself with `sober run <node>`, which says if anything else is in the way.'),
	)
}
