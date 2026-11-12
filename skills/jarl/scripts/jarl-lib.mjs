// jarl-lib.mjs — the implementation behind jarl.mjs and record.mjs. Internal: its exports are not a contract and
// change without notice. The stable surface other tools may vendor is record.mjs (RECORD_API), and only that;
// the command line is jarl.mjs, a CLI over this module.
//
// Markdown is the source of truth: the loop's goal and decisions, the dated log and one
// .jarl/issues/NNN-slug.md per issue. This module only reads and writes those files, so anything
// it does can be checked by opening them. Zero dependencies, Node 22+.
//
// The code lives in lib/, one module per part of the record, each importing only what it uses; this file is
// the one surface over them that jarl.mjs, record.mjs and the tests import.

export { fieldText, STATUSES, KINDS, PRIORITIES, TIERS, TIER_DEFAULT, ASK_KINDS, CI_STATES, ROUNDS_BEFORE_TAKEOVER, LIVENESS_MINUTES, HANDOFF_STALE_MS, slugify, need, noSeparators, refuse, Refusal, isFix, isExternal, isPlaceholder, PLACEHOLDERS, hole, HOLE, commandOf, printedLine, afterView, commandLine, commandWords, readyText, breaksLine, escapedEchoes, echoWord, shellOf, printable, printCommand, MUTATING, writes, signedWords, printingFor, jarlLine, globalWords, rootPrintable } from './lib/base.mjs';
export { findRoot, LOOP_WALK_DEPTH, LOOP_WALK_DIRS, loopsUnder, discoverLoop, cmdUse, renderUse, jarlDir, issuesDir, portablePath, canonical } from './lib/where.mjs';
export { readText, RENAME_RETRY_MS, renameRetry, writeAtomic } from './lib/files.mjs';
export { ID_SRC, idKey, cmpId, writtenForms, writtenId, newNumber, expandIds, idsNamed } from './lib/ids.mjs';
export { STATUS_FLAGS, flagWord, BUILTIN_STATUSES, PROFILE_VERSION, PARENT_FIELD, PROFILE_KEYS, PROFILE_FIELD_KEYS, PROFILE_STATUS_KEYS, SET_BY, LIFECYCLE_KEYS, LIFECYCLE_OPS, DEFAULT_LIFECYCLE, DONE_GATE_KEYS, SLOT_KEYS, ATTACH_MAX_BYTES, DONE_GATE_APPROVE, DEFAULT_DONE_GATE, TOOL_FIELDS, BUILTIN_SECTIONS, PROFILE_FIELD_RE, PROFILE_STATUS_RE, RESERVED_STATUS_NAMES, profilePath, validateProfile, DEFAULT_PROFILE, loadProfile, profileAt, readProfileFile, describeProfile, renderProfile, cmdProfile } from './lib/profile.mjs';
export { RECORD_FORMAT, FORMAT_MARK, CONVERSION_FILE, UNRECORDED, needRecordFormat, logPath, appendLog, writeWhole, appendLogLines, withWriter, firstLine, SLUG_RE, loadDecisions, appendDecision, goalLines, goalLineOf, goalWithLine, cmdGoal, cmdGoalSet } from './lib/journal.mjs';
export { JARL_GITIGNORE, JARL_GITIGNORE_COMMITTED, outOfGit, decisionsDriverCommand, JARL_SCRIPT, JARL_GITATTRIBUTES, ensureLoopMerge } from './lib/loop-git.mjs';
export { LOCK_STALE_MS, LOCK_REUSED_PID_MS, LOCK_EMPTY_MS, LOCK_BREAK_STALE_MS, LOCK_WAIT_MS, withLock, isEntry } from './lib/lock.mjs';
export { leaseOfMove, attachmentOf, parseEvent, appendNote, loopEvents, eventsById, journalById, issueState, mergeLineOf } from './lib/log.mjs';
export { parseIssue, loadIssues, parentCycle, waitCycle, fieldValue, findIssue, sharedNumbers, sharedNumberText, bodyText, needNoFieldTags, describeNew, renderNewReply, acceptanceText, CHANGELOG_SECTIONS, changelogText, changelogEntries, renderIssue, mergedOf, alignRows, evidenceTable, evidenceRows, isUnsplit, placeEvidence, PROPOSED, acceptanceLineCount, acceptanceLines, reviewEntries } from './lib/issues.mjs';
export { mainCheckoutOf, worktreeState, fileAt, reposNamed, refsIn, REPOS_FILE, repoValueKind, repoPlace, repoOf, branchTip, originSpelling, repoFromInput, REPOS_HEADER, REPOS_DECLARED_IN, declaredNames, declaredRepos, cmdRepoBase, repoIdentity, needRightCheckouts, whyNotDeletable, whereOf, whereLines, reposWhere, reposWhereLines } from './lib/repositories.mjs';
export { RULE_ROLES, RULE_MOMENTS, RULE_SELECTORS, BUILTIN_RULES, parseScope, parseUntil, readAppliesTo, ruleMatches, rulesFor, readsAsInstruction } from './lib/rules.mjs';
export { needLoop, readLoop } from './lib/loop.mjs';
export { recordDisagreements, disagreementText } from './lib/disagreements.mjs';
export { BASE_COORDINATORS, reviewerKind, coordinatorNames, sliceOf, coordinatorOf } from './lib/slices.mjs';
export { carriesCode, inFlightMark, gateState, gateWindow, gateOf, wholeOf, reviewSplit } from './lib/gate.mjs';
export { declaredChecksByRepo, declaredChecks, checkState, checkLines, mergeCheckLines, FOLLOW_UP_DAYS, loopMetrics, metricsOf, renderMetrics } from './lib/metrics.mjs';
export { MODEL_MIN_N, modelLines, cmdModels, renderModels, modelMarks, needKnownModels } from './lib/models.mjs';
export { roundsOf, cmdRound, renderCheckNotes, cmdCheck, cmdBranches, renderBranches, ago, leaseProblems } from './lib/rounds.mjs';
export { requiredSlots, slotProblems, attachmentStates } from './lib/attachments.mjs';
export { TIPS_RECENT_MS, resetCaches, ciOf, cmdTips, renderTips } from './lib/tips.mjs';
export { PERMANENT_MARKER, cmdInit, cmdArchive, claimFile, TEMPLATE_RE, templatesDir, readTemplate } from './lib/init.mjs';
export { hasLiveLoop, eachIssue, reasonWord, SET_CALLERS, setRouteOf, shellWord, needLifecycle } from './lib/shared.mjs';
export { sourceList, waitingOn, waitsOf } from './lib/after.mjs';
export { editorOf, cmdBody, cmdSource, cmdAfter } from './lib/body.mjs';
export { TIER_CRITERIA, cmdNew, cmdRenumber } from './lib/new.mjs';
export { cmdList } from './lib/list.mjs';
export { cmdTag, cmdPrio, cmdFiles, cmdRepo } from './lib/tags.mjs';
export { cmdSplit } from './lib/split.mjs';
export { cmdExtend, cmdField } from './lib/field.mjs';
export { cmdSetStatus, cmdSetField, cmdSet } from './lib/set.mjs';
export { doneRefusal } from './lib/done-gate.mjs';
export { cmdMerged, workEvidence } from './lib/merged.mjs';
export { loadAsks, cmdAsk, RATIFY_WORDS, REJECT_WORDS, AMBIGUOUS_WORDS, cmdAnswer, cmdAnswerMany, recordTypeLog, recordRuleLog, cmdDecide, cmdWithdrawSupersession, renderWithdrawn, questionFor, issuesNaming, AREA_RE, RULE_RE, RATIFY_BATCH, ratificationBatch, PROMOTION_OPTIONS, promotionBatch, cmdDecisions, renderDecide, renderDecisions, handoffAge } from './lib/questions.mjs';
export { cmdEvidence, issueView, workerEvidence, NEXT_GROUPS, cmdNext, modelsTableBuilds, nextRowsBuilds, renderNext, nextRows, uncommittedLoopFiles, cmdStatus, STATUS_BY, IN_FLIGHT_MARKS, inFlightRows, parentChecks, cmdMode, cmdClose, closedGateFlags } from './lib/evidence.mjs';
export { METHODS, LINE_FORM, readLine, lineDigest, needMarkedLines, lineStates, lineCounts, linesAtLease, atLeaseText, issueLinesAtLease } from './lib/lines.mjs';
export { cmdQueue, renderQueue } from './lib/queue.mjs';
export { OWNER_HOLDER, JARL_HOLDER, BALL_SHOWN, holderOf, ROW_SOURCES, ballRows, cmdNextAs, renderNextAs, askerSection } from './lib/ball.mjs';
export { cmdReview, ARTIFACT_MOST, artifactValue } from './lib/review.mjs';
export { BRIEF_ROLES, cmdBrief, renderBrief } from './lib/brief.mjs';
export { OWNER_LINE_SHAPE, needOwnerLine, ownerLines, ownerLineStates, ownerLineRefusal, ownerLineNotes, cmdTick, cmdRetractTick } from './lib/owner-lines.mjs';
export { cmdChangelog } from './lib/changelog.mjs';
export { findingsOf, reportDirOf, cmdImport, cmdSources, renderStatus, renderImport, renderSources, renderList } from './lib/import.mjs';
export { RESUME_LOG_LINES, RESUME_READY, cmdResume, renderResume, cmdHandoffRead, HANDOFF_TEXT, cmdHandoffWrite, cmdReport } from './lib/resume.mjs';
export { VERIFY_SHOWN, cmdVerify, renderVerify } from './lib/verify.mjs';
export { mergeDecisionsTexts, mergeFlags, runDecisionsDriver } from './lib/merge-driver.mjs';
