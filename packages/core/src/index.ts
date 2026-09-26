// The published surface of `core`, kept small on purpose (BUILD-PLAN §10). A
// name goes in when a consumer needs it, not when it is written: every module
// here is importable from inside the package, and re-exporting one is a
// one-line diff the day something outside asks for it.

export { type LoopOptions, runAgent } from './agent.js'
export { answerRun } from './answer.js'
export { archiveDecision, archiveNode } from './archive.js'
export { type Audited, auditNode } from './audit.js'
export {
	AutoRefusedError,
	autoAccept,
	autoApprove,
	autoDispatch,
	autoGate,
} from './auto.js'
export {
	createBoardBranch,
	detectSetup,
	type InitResult,
	initBoard,
} from './board.js'
export { type DecisionMatch, renderBrief, renderPlain, searchDecisions } from './brief.js'
export {
	applySetting,
	type Config,
	DEFAULT_CONFIG,
	type Model,
	modelForScore,
	modelsFor,
	type ReadConfig,
	readConfig,
	setSetting,
} from './config.js'
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
	sameHandle,
} from './contributors.js'
export {
	AcceptedAlreadyError,
	AnswerLockedError,
	answerDecision,
	approveBrief,
	NoBriefError,
	NoSuchOptionError,
	queueByDefault,
	writeBrief,
} from './decide.js'
export { digest } from './digest.js'
export { dispatch, dispatchWave, SetupFailedError, stopRun } from './dispatch.js'
export {
	acceptDistribution,
	dropDistribution,
	proposeDistribution,
	readDistribution,
} from './distribute.js'
export { bind, unbound } from './edges.js'
export { loadEnv } from './env.js'
// `NotOnBoardError` came off this barrel in ADR 0033's deletion pass and comes
// back here, which is the shape that ADR predicted: a name returns in the pull
// request that needs it. `packages/server` needs it to answer a 409 rather than
// a 500 when a route names a node that is not there.
export { NotOnBoardError, SoberError } from './errors.js'
export {
	type Correction,
	correctNode,
	createNode,
	type Dismissing,
	dismissFlag,
	type Opening,
	reopenNode,
} from './flag.js'
export { currentBranch, isRepo, showFromRef, whoami } from './git.js'
export { type Board, findCycle, loadBoard } from './graph.js'
export { checkHost, HostError, knownAvailability } from './host.js'
export { newId } from './id.js'
export { type Editing, editDecision, ImpactError, impactOf } from './impact.js'
export {
	askJev,
	type JevAsk,
	type JevDecision,
	JevError,
	jevChoice,
	jevDecision,
	jevQuestions,
	modelQuestion,
} from './jev.js'
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
export { acquire, LockBusyError } from './lock.js'
export { type Merged, MergeRefusedError, mergeNode } from './merge.js'
export { type Migrated, migrateBoard, needsMigration } from './migrate.js'
export {
	type BuiltModels,
	type Candidate,
	type Catalogues,
	candidatesFor,
	claudeModels,
	codexModels,
	installed,
	type LiveModelsDeps,
	liveModels,
	openRouterModels,
} from './models.js'
export { findRoot, type Paths, paths } from './paths.js'
export {
	checksOf,
	type Published,
	publish,
	pullRequestOf,
} from './pr.js'
export { plan, type Queued, runQueue } from './queue.js'
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
	rejectWork,
	reviewNode,
} from './review.js'
export { acceptNode, finishRun, recordOutcome, startRun } from './run.js'
export { scanNode } from './scan.js'
export {
	type EffortSpend,
	type Flags,
	flagsOf,
	lastRun,
	openDecisions,
	ready,
	spendByEffort,
	statusOf,
	waitingOn,
} from './status.js'
export {
	adoptBoard,
	type BoardDistance,
	boardDistance,
	boardTravels,
	type OpenConflict,
	openConflicts,
	type Resolution,
	resolveConflict,
	type SyncResult,
	sync,
} from './sync.js'
export { followRun, tail } from './tail.js'
export {
	assignNode,
	type Chained,
	type Claimed,
	claimChain,
	claimNode,
	type Overlap,
	OverlapError,
	releaseChain,
	releaseNode,
	unlinked,
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
