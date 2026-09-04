import type { CommandResult, Node, Run, RunExit } from '@besober/schema'
import { NotOnBoardError } from './errors.js'
import { whoami } from './git.js'
import { newId } from './id.js'
import { appendEvent, readRun, writeRun } from './local.js'
import { withLock } from './lock.js'
import type { Paths } from './paths.js'
import { readNode, writeNode } from './records.js'
import { branchOf, worktreeOf } from './worktree.js'

/**
 * The run record is local and disposable (DESIGN §5.5): a teammate needs to
 * know a node is finished, not how many times someone's laptop tried. What does
 * sync is the node's `outcome`, written when a run finishes.
 */
export interface StartedRun {
	readonly id: string
	readonly run: Run
}

export const startRun = (paths: Paths, node: string, host: string): Promise<StartedRun> =>
	withLock(paths, 'run', async () => {
		const record = await readNode(paths, node)
		if (record.kind !== 'ok') throw new NotOnBoardError('node', node)

		// Claim is a fact: whoever actually starts it (DESIGN §3.3). Written here
		// so a run started from a session and one started from the CLI say the
		// same thing about who is on the node.
		await writeNode(paths, node, {
			...record.value,
			claim: { by: await whoami(paths.root), at: new Date().toISOString() },
		})

		const id = newId(node)
		const run: Run = {
			node,
			host,
			branch: branchOf(node),
			worktree: worktreeOf(paths, node),
			startedAt: new Date().toISOString(),
			endedAt: null,
			exit: null,
			error: null,
			verify: null,
			acceptance: [],
		}
		await writeRun(paths, id, run)
		await appendEvent(paths, { action: 'run.started', node, run: id, host })
		return { id, run }
	})

export interface RunResult {
	readonly exit: RunExit
	readonly error?: string
	/** `null` means the command did not run — never that it passed (ADR 0021). */
	readonly verify?: CommandResult | null
	/** Parallel to the brief's criteria, by index (ADR 0027). */
	readonly acceptance?: readonly (CommandResult | null)[]
}

export const finishRun = (paths: Paths, id: string, result: RunResult): Promise<Run> =>
	withLock(paths, 'run', async () => {
		const record = await readRun(paths, id)
		if (record.kind !== 'ok') throw new NotOnBoardError('node', id)

		const run: Run = {
			...record.value,
			endedAt: new Date().toISOString(),
			exit: result.exit,
			error: result.error ?? null,
			verify: result.verify ?? null,
			acceptance: [...(result.acceptance ?? [])],
		}
		await writeRun(paths, id, run)
		await appendEvent(paths, { action: 'run.finished', node: run.node, run: id, exit: run.exit })
		return run
	})

/**
 * The finishing agent's summary of what it did (§3.7). Board state, not local:
 * downstream briefs carry it, which is what lets them execute cold without the
 * agent reading upstream code to find out what happened.
 */
export const recordOutcome = (paths: Paths, node: string, outcome: string): Promise<Node> =>
	withLock(paths, 'outcome', async () => {
		const record = await readNode(paths, node)
		if (record.kind !== 'ok') throw new NotOnBoardError('node', node)

		const updated: Node = { ...record.value, outcome }
		await writeNode(paths, node, updated)
		return updated
	})

/**
 * Accepting is what makes a node `done` (§3.2): there is no boolean to forget
 * to set, and `flagged` and `scan` are recorded as they were at the moment a
 * human accepted, not looked up later.
 */
export const acceptNode = (
	paths: Paths,
	node: string,
	accepted: NonNullable<Node['accepted']>,
): Promise<Node> =>
	withLock(paths, 'accept', async () => {
		const record = await readNode(paths, node)
		if (record.kind !== 'ok') throw new NotOnBoardError('node', node)

		const updated: Node = { ...record.value, accepted }
		await writeNode(paths, node, updated)
		await appendEvent(paths, {
			action: 'node.accepted',
			node,
			by: accepted.by,
			scan: accepted.scan,
		})
		return updated
	})
