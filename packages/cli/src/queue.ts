import {
	acquire,
	type Config,
	LockBusyError,
	lastRun,
	loadBoard,
	type Paths,
	plan,
	runQueue,
	SoberError,
	whoami,
} from '@besober/core'
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
export const drain = async (
	paths: Paths,
	base: string,
	options: { readonly quietWhenIdle?: boolean } = {},
): Promise<{ readonly failed: boolean }> => {
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
	if (options.quietWhenIdle === true && queued.started.length === 0) return { failed: false }

	let failed = false

	for (const [index, result] of queued.dispatched.entries()) {
		const node = queued.started[index] ?? ''
		if (result instanceof SoberError) {
			say(`${red('×')} ${node}: ${result.message}`)
			failed = true
			continue
		}
		if (result.exit !== 'finished') failed = true
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

	if (queued.held.length === 0) return { failed }
	say()
	say(
		`${yellow('·')} ${queued.held.length} queued node${queued.held.length === 1 ? '' : 's'} waiting for you`,
	)
	say(heldLines(queued.held))
	say(
		dim('  Start one yourself with `sober run <node>`, which says if anything else is in the way.'),
	)
	return { failed }
}

const heldLines = (held: readonly { readonly id: string; readonly why: string }[]): string =>
	columns(held.map((one) => [`  ${cyan(one.id)}`, dim(one.why)])).join('\n')

/**
 * A reader beside the dispatcher: what it is holding and why, what it started
 * and how that ended, and whether one is draining at all. It starts nothing, so
 * closing it leaves the dispatcher running. The held list comes from core's
 * `plan`, the same author `drain` prints from.
 */
export const queue = async (
	paths: Paths,
	options: {
		readonly config: Config
		readonly watch?: boolean
		/** Injected so a test drives the cycle instead of sleeping through it. */
		readonly wait?: (ms: number) => Promise<void>
	},
): Promise<void> => {
	const wait = options.wait ?? ((ms) => new Promise<void>((done) => setTimeout(done, ms)))
	for (;;) {
		if (options.watch === true) process.stdout.write('\x1b[2J\x1b[H')
		say(await liveness(paths, options.config))
		const board = await loadBoard(paths)
		const { start, held } = plan(board, await whoami(paths.root))
		for (const id of start) say(`  ${cyan(id)} ${dim('ready — the next cycle starts it')}`)
		if (held.length > 0) say(heldLines(held))
		const ran = [...board.nodes]
			.filter(
				([id, node]) =>
					node.brief?.approval?.queue === true &&
					node.accepted === null &&
					lastRun(board, id) !== null,
			)
			.map(([id]) => id)
			.sort()
		for (const id of ran) {
			const last = lastRun(board, id)
			if (last === null) continue
			say(
				last.run.endedAt === null
					? `  ${cyan(id)} ${yellow('running')} ${dim(last.id)}`
					: `  ${cyan(id)} ${last.run.exit === 'finished' ? green('finished') : red(last.run.exit ?? 'ended')} ${dim(last.id)}`,
			)
		}
		if (start.length + held.length + ran.length === 0) say(dim('  nothing is queued'))
		if (options.watch !== true) return
		await wait(options.config.dispatch.pollSeconds * 1000)
	}
}

// The dispatcher holds the ADR 0025 lock for its whole life, so a lock we cannot
// take is a dispatcher draining; one we can take is released straight away.
const liveness = async (paths: Paths, config: Config): Promise<string> => {
	const probe = await acquire({ ...paths, lock: `${paths.lock}-dispatch` }, 'queue', {
		staleSeconds: config.lock.staleSeconds,
		waitSeconds: 0,
	}).catch((error: unknown) => {
		if (error instanceof LockBusyError) return error
		throw error
	})
	if (probe instanceof LockBusyError)
		return `${green('✓')} a dispatcher is draining this board: ${probe.action} on ${probe.host}`
	await probe.release()
	return `${yellow('·')} nothing is draining — start one with \`sober dispatch\``
}

/**
 * The long-lived half of the queue: `drain` on a cycle instead of on an event,
 * so a node made ready by a run finishing at 02:00, a teammate's accept or a
 * decision answered in another clone still starts. It calls `drain`, and so
 * `runQueue`, so every ADR 0017 rule is inherited rather than repeated.
 *
 * It does not start a ready node whose brief was approved without `queue:
 * true`. ADR 0017 rejected "dispatch every ready node automatically": it removes
 * the approval, the last thing a human sees before an agent starts working. That
 * is one predicate away in core's `queued()` and deliberately not taken — wanting
 * it is an ADR superseding 0017, not a quiet line change.
 *
 * Liveness is the process. Twice-started is caught through the ADR 0025 lock
 * machinery on its own file beside the writer lock — not the writer lock itself,
 * which every dispatch inside the drain takes and would deadlock on — so a
 * crashed dispatcher goes stale by heartbeat, never a file left behind.
 */
export const dispatcher = async (
	paths: Paths,
	base: string,
	options: {
		readonly config: Config
		/** Injected so a test drives the cycle instead of sleeping through it. */
		readonly wait?: (ms: number) => Promise<void>
		readonly tick?: (paths: Paths, base: string) => Promise<{ readonly failed: boolean }>
	},
): Promise<number> => {
	const wait = options.wait ?? ((ms) => new Promise<void>((done) => setTimeout(done, ms)))
	const tick = options.tick ?? ((p, b) => drain(p, b, { quietWhenIdle: true }))
	const held = await acquire({ ...paths, lock: `${paths.lock}-dispatch` }, 'dispatch', {
		staleSeconds: options.config.lock.staleSeconds,
		waitSeconds: 1,
	}).catch((error: unknown) => {
		if (error instanceof LockBusyError) return error
		throw error
	})
	if (held instanceof LockBusyError) {
		say(
			`${red('×')} a dispatcher is already draining this board: ${held.action} on ${held.host} — not starting a second`,
		)
		return 1
	}

	const stop = (): void => {
		void held.release().then(() => process.exit(130))
	}
	process.once('SIGINT', stop)
	process.once('SIGTERM', stop)
	say(`${green('✓')} draining the queue on ${cyan(base)} ${dim('— Ctrl-C stops it')}`)
	try {
		for (;;) {
			const { failed } = await tick(paths, base)
			// ADR 0017: a queued chain stops at the first failure. Carrying on next
			// tick would turn "stop" into "stop until the next tick".
			if (failed) {
				say()
				say(
					`${red('×')} the dispatcher stopped — a queued node failed, and a human has to look before anything more is built`,
				)
				return 1
			}
			await wait(options.config.dispatch.pollSeconds * 1000)
		}
	} finally {
		process.off('SIGINT', stop)
		process.off('SIGTERM', stop)
		await held.release()
	}
}
