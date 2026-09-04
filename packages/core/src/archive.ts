import { rm } from 'node:fs/promises'
import { Decision, decisionState, Node } from '@besober/schema'
import { AnsweredDecisionError, NotOnBoardError, StillReferencedError } from './errors.js'
import { dependents, loadBoard } from './graph.js'
import { withLock } from './lock.js'
import type { Paths } from './paths.js'
import { recordFile } from './paths.js'
import { readRecord } from './read.js'
import { writeRecord } from './write.js'

/**
 * Archive is the normal way to remove something (DESIGN §8.3): the record moves
 * to `.sober/archive/`, keeps its history, and can come back. Permanent
 * deletion is refused while anything still references it.
 *
 * Nodes and decisions archive into their own subdirectory. The layout in §1.1
 * shows one flat `archive/`, written before §8.3 decided that decisions archive
 * too — one directory holding two record shapes would report every archived
 * decision as a broken node (§8.4).
 */
const move = async (from: string, to: string, record: unknown): Promise<void> => {
	await writeRecord(to, record)
	await rm(from)
}

/** Archiving a referenced node is allowed: it is how a referenced node is removed at all. */
export const archiveNode = (paths: Paths, id: string): Promise<void> =>
	withLock(paths, 'archive', async () => {
		const record = await readRecord(recordFile(paths.nodes, id), Node)
		if (record.kind !== 'ok') throw new NotOnBoardError('node', id)
		await move(record.file, recordFile(paths.archivedNodes, id), record.value)
	})

export const restoreNode = (paths: Paths, id: string): Promise<void> =>
	withLock(paths, 'restore', async () => {
		const record = await readRecord(recordFile(paths.archivedNodes, id), Node)
		if (record.kind !== 'ok') throw new NotOnBoardError('node', id)
		await move(record.file, recordFile(paths.nodes, id), record.value)
	})

/**
 * An answered decision is never deleted (§8.3, ADR 0006): the binding is the
 * record of why the nodes it holds are shaped as they are. It archives, and the
 * nodes that bound it keep pointing at it and keep reading it.
 */
export const archiveDecision = (paths: Paths, id: string): Promise<void> =>
	withLock(paths, 'archive', async () => {
		const record = await readRecord(recordFile(paths.decisions, id), Decision)
		if (record.kind !== 'ok') throw new NotOnBoardError('decision', id)
		await move(record.file, recordFile(paths.archivedDecisions, id), record.value)
	})

export const restoreDecision = (paths: Paths, id: string): Promise<void> =>
	withLock(paths, 'restore', async () => {
		const record = await readRecord(recordFile(paths.archivedDecisions, id), Decision)
		if (record.kind !== 'ok') throw new NotOnBoardError('decision', id)
		await move(record.file, recordFile(paths.decisions, id), record.value)
	})

/** Refused while anything still references it, and the referencing nodes are named (D41). */
export const deleteNode = (paths: Paths, id: string): Promise<void> =>
	withLock(paths, 'delete', async () => {
		const board = await loadBoard(paths)
		if (!board.nodes.has(id)) throw new NotOnBoardError('node', id)
		const referencing = dependents(board.nodes, id)
		if (referencing.length > 0) throw new StillReferencedError(id, referencing)
		await rm(recordFile(paths.nodes, id))
	})

/**
 * Only an unanswered decision nothing binds is deletable (§2.4): it binds
 * nothing, explains nothing, and holds no answer, so there is nothing to
 * preserve. Everything else archives.
 */
export const deleteDecision = (paths: Paths, id: string): Promise<void> =>
	withLock(paths, 'delete', async () => {
		const board = await loadBoard(paths)
		const decision = board.decisions.get(id)
		if (decision === undefined) throw new NotOnBoardError('decision', id)
		if (decisionState(decision) === 'answered') throw new AnsweredDecisionError(id)

		const binding = [...board.nodes]
			.filter(([, node]) => node.decisions.includes(id))
			.map(([node]) => node)
		if (binding.length > 0) throw new StillReferencedError(id, binding)
		await rm(recordFile(paths.decisions, id))
	})
