// The published surface of `core`, kept small on purpose (BUILD-PLAN §10). A
// name goes in when a consumer needs it, not when it is written: every module
// here is importable from inside the package, and re-exporting one is a
// one-line diff the day something outside asks for it.

export { archiveDecision, archiveNode } from './archive.js'
export {
	createBoardBranch,
	detectSetup,
	type InitResult,
	initBoard,
} from './board.js'
export { renderBrief } from './brief.js'
export { applySetting, type Config, type ReadConfig, readConfig, setSetting } from './config.js'
export {
	ARCHIVE_FIELD,
	type Choices,
	type Conflict,
	type Side,
} from './conflict.js'
export {
	addContributor,
	readContributors,
	removeContributor,
} from './contributors.js'
export {
	AnswerLockedError,
	answerDecision,
	approveBrief,
	NoBriefError,
	NoSuchOptionError,
	writeBrief,
} from './decide.js'
export { dispatch, dispatchWave, SetupFailedError, stopRun } from './dispatch.js'
export { bind, unbound } from './edges.js'
export { SoberError } from './errors.js'
export { currentBranch, isRepo, showFromRef, whoami } from './git.js'
export { type Board, findCycle, loadBoard } from './graph.js'
export { checkHost, HostError } from './host.js'
export { newId } from './id.js'
export {
	type Feedback,
	readFeedback,
	readRunOutput,
	readRuns,
	runLog,
	wasStopped,
	writeRun,
	writeRunPid,
} from './local.js'
export { type Merged, MergeRefusedError, mergeNode } from './merge.js'
export { type Migrated, migrateBoard, needsMigration } from './migrate.js'
export { findRoot, type Paths, paths } from './paths.js'
export {
	type Checks,
	checksOf,
	type Published,
	type PullRequest,
	publish,
	pullRequestOf,
} from './pr.js'
export { type Queued, runQueue } from './queue.js'
export type { BrokenRecord } from './read.js'
export {
	readArchivedNodes,
	readNodes,
	readProject,
	writeDecision,
	writeNode,
} from './records.js'
export {
	acceptWork,
	type Green,
	greenNodes,
	type Landed,
	type Review,
	rejectWork,
	reviewNode,
} from './review.js'
export { acceptNode, finishRun, recordOutcome, startRun } from './run.js'
export { type Finding, type ScanReport, scanNode } from './scan.js'
export {
	type Flags,
	flagsOf,
	lastRun,
	openDecisions,
	ready,
	statusOf,
} from './status.js'
export {
	adoptBoard,
	boardTravels,
	type OpenConflict,
	openConflicts,
	type Resolution,
	resolveConflict,
	type SyncResult,
	sync,
} from './sync.js'
export { tail } from './tail.js'
export {
	assignNode,
	type Claimed,
	claimNode,
	type Overlap,
	OverlapError,
	releaseNode,
} from './team.js'
export {
	addWorktree,
	DirtyWorktreeError,
	listWorktrees,
	removeWorktree,
	resetToBase,
	type Worktree,
	worktreeOf,
} from './worktree.js'
