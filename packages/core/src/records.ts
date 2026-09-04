import { Decision, Node, Project } from '@besober/schema'
import type { Paths } from './paths.js'
import { recordFile } from './paths.js'
import type { ReadRecord, ReadRecords } from './read.js'
import { readRecord, readRecords } from './read.js'
import { writeRecord } from './write.js'

export const readProject = (paths: Paths): Promise<ReadRecord<Project>> =>
	readRecord(paths.project, Project)

export const writeProject = (paths: Paths, project: Project): Promise<void> =>
	writeRecord(paths.project, project)

export const readNode = (paths: Paths, id: string): Promise<ReadRecord<Node>> =>
	readRecord(recordFile(paths.nodes, id), Node)

export const writeNode = (paths: Paths, id: string, node: Node): Promise<void> =>
	writeRecord(recordFile(paths.nodes, id), node)

export const readNodes = (paths: Paths): Promise<ReadRecords<Node>> =>
	readRecords(paths.nodes, Node)

export const readDecision = (paths: Paths, id: string): Promise<ReadRecord<Decision>> =>
	readRecord(recordFile(paths.decisions, id), Decision)

export const writeDecision = (paths: Paths, id: string, decision: Decision): Promise<void> =>
	writeRecord(recordFile(paths.decisions, id), decision)

export const readDecisions = (paths: Paths): Promise<ReadRecords<Decision>> =>
	readRecords(paths.decisions, Decision)

/** Archived nodes keep the node shape — archiving is a file move (DESIGN §8.3). */
export const readArchived = (paths: Paths): Promise<ReadRecords<Node>> =>
	readRecords(paths.archive, Node)
