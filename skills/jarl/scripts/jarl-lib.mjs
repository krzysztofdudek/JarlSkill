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

export { STATUSES, KINDS, PRIORITIES, TIERS, TIER_DEFAULT, ASK_KINDS, CI_STATES, ROUNDS_BEFORE_TAKEOVER, LIVENESS_MINUTES, HANDOFF_STALE_MS, slugify, need, noSeparators, refuse, Refusal, isFix, isExternal, isPlaceholder, PLACEHOLDERS, hole, HOLE, commandOf, printedLine, afterView, commandLine, commandWords, readyText, breaksLine, escapedEchoes, echoWord, shellOf, printable, printCommand, printingFor, jarlLine, globalWords, rootPrintable } from './lib/base.mjs';
export { findRoot, jarlDir, issuesDir, portablePath, canonical } from './lib/where.mjs';
export { readText, RENAME_RETRY_MS, renameRetry, writeAtomic } from './lib/files.mjs';
export { ID_SRC, idKey, cmpId, needsRaisedFormat, writtenForms, writtenId, newNumber, expandIds, idsNamed } from './lib/ids.mjs';
export { STATUS_FLAGS, flagWord, BUILTIN_STATUSES, PROFILE_VERSION, PARENT_FIELD, PROFILE_KEYS, PROFILE_FIELD_KEYS, PROFILE_STATUS_KEYS, SET_BY, LIFECYCLE_KEYS, LIFECYCLE_OPS, DEFAULT_LIFECYCLE, RECORD_FORMAT, RECORD_FORMATS, RECORD_FORMAT_RAISED, FORMAT_LINES, formatState, DONE_GATE_KEYS, SLOT_KEYS, ATTACH_MAX_BYTES, DONE_GATE_APPROVE, DEFAULT_DONE_GATE, TOOL_FIELDS, BUILTIN_SECTIONS, PROFILE_FIELD_RE, PROFILE_STATUS_RE, RESERVED_STATUS_NAMES, profilePath, validateProfile, DEFAULT_PROFILE, loadProfile, profileAt, readProfileFile, describeProfile, renderProfile, cmdProfile } from './lib/profile.mjs';
export { logPath, appendLog, writeWhole, appendLogLines, withWriter, firstLine, SLUG_RE, loadDecisions, appendDecision, goalLines, goalLineOf, goalWithLine, cmdGoal, cmdGoalSet } from './lib/journal.mjs';
export { JARL_GITIGNORE, JARL_GITIGNORE_COMMITTED, outOfGit, decisionsDriverCommand, JARL_SCRIPT, JARL_GITATTRIBUTES, ensureLoopMerge } from './lib/loop-git.mjs';
export { LOCK_STALE_MS, LOCK_REUSED_PID_MS, LOCK_EMPTY_MS, LOCK_BREAK_STALE_MS, LOCK_WAIT_MS, withLock, isEntry } from './lib/lock.mjs';
export { leaseOfMove, attachmentOf, parseEvent, appendNote, mapMergeRepos, loopEvents, eventsById, journalById, issueState, mergeLineOf } from './lib/log.mjs';
export { parseIssue, loadIssues, parentCycle, waitCycle, fieldValue, findIssue, sharedNumbers, sharedNumberText, bodyText, needNoFieldTags, describeNew, renderNewReply, acceptanceText, CHANGELOG_SECTIONS, changelogText, changelogEntries, renderIssue, mergedOf, alignRows, evidenceTable, evidenceRows, isUnsplit, placeEvidence, PROPOSED, acceptanceLineCount, acceptanceLines, reviewEntries } from './lib/issues.mjs';
export { raiseFormat, needFormat, mainCheckoutOf, worktreeState, fileAt, reposNamed, refsIn, REPOS_FILE, repoValueKind, repoPlace, repoOf, branchTip, originSpelling, repoFromInput, REPOS_HEADER, REPOS_DECLARED_IN, declaredNames, declaredRepos, cmdRepoBase, repoIdentity, needRightCheckouts, whyNotDeletable, whereOf, whereLines, reposWhere, reposWhereLines } from './lib/repositories.mjs';
export { RULE_ROLES, RULE_MOMENTS, RULE_SELECTORS, BUILTIN_RULES, parseScope, parseUntil, readAppliesTo, ruleMatches, rulesFor } from './lib/rules.mjs';
export { needLoop, readLoop, recordDisagreements, disagreementText, BASE_COORDINATORS, reviewerKind, coordinatorNames, carriesCode, inFlightMark, gateState, gateWindow, gateOf, wholeOf, sliceOf, coordinatorOf, reviewSplit } from './lib/loop.mjs';
export { declaredChecksByRepo, declaredChecks, checkState, checkLines, mergeCheckLines, FOLLOW_UP_DAYS, loopMetrics, metricsOf, renderMetrics } from './lib/metrics.mjs';
export { MODEL_MIN_N, modelLines, cmdModels, renderModels, modelMarks } from './lib/models.mjs';
export { roundsOf, cmdRound, renderCheckNotes, cmdCheck, cmdBranches, renderBranches, ago, leaseProblems } from './lib/rounds.mjs';
export { requiredSlots, slotProblems, attachmentStates } from './lib/attachments.mjs';
export { TIPS_RECENT_MS, resetCaches, ciOf, cmdTips, renderTips } from './lib/tips.mjs';
export { PERMANENT_MARKER, editorOf, cmdInit, hasLiveLoop, cmdArchive, claimFile, TEMPLATE_RE, templatesDir, readTemplate, TIER_CRITERIA, cmdNew, cmdRenumber, sourceList, waitingOn, waitsOf, cmdSplit, cmdBody, cmdSource, cmdAfter, cmdList, eachIssue, reasonWord, SET_CALLERS, setRouteOf, cmdField, cmdSetStatus, cmdSetField, cmdSet, doneRefusal, cmdMerged, shellWord, cmdTag, cmdPrio, cmdFiles, cmdRepo, workEvidence, needLifecycle } from './lib/commands.mjs';
export { loadAsks, cmdAsk, RATIFY_WORDS, REJECT_WORDS, AMBIGUOUS_WORDS, cmdAnswer, cmdAnswerMany, recordTypeLog, recordRuleLog, cmdDecide, questionFor, issuesNaming, AREA_RE, RULE_RE, RATIFY_BATCH, ratificationBatch, PROMOTION_OPTIONS, promotionBatch, cmdDecisions, renderDecide, renderDecisions, handoffAge } from './lib/questions.mjs';
export { cmdEvidence, issueView, workerEvidence, schedulerNote, NEXT_GROUPS, cmdNext, modelsTableBuilds, nextRowsBuilds, renderNext, nextRows, uncommittedLoopFiles, cmdStatus, STATUS_BY, IN_FLIGHT_MARKS, inFlightRows, parentChecks, cmdMode, cmdClose, closedGateFlags } from './lib/evidence.mjs';
export { cmdQueue, renderQueue } from './lib/queue.mjs';
export { OWNER_HOLDER, JARL_HOLDER, BALL_SHOWN, holderOf, ROW_SOURCES, ballRows, cmdNextAs, renderNextAs, askerSection } from './lib/ball.mjs';
export { cmdReview } from './lib/review.mjs';
export { BRIEF_ROLES, cmdBrief, renderBrief } from './lib/brief.mjs';
export { OWNER_LINE_SHAPE, needOwnerLines, ownerLines, ownerLineStates, ownerLineRefusal, ownerLineNotes, cmdTick, cmdRetractTick } from './lib/owner-lines.mjs';
export { cmdChangelog } from './lib/changelog.mjs';
export { findingsOf, reportDirOf, cmdImport, cmdSources, renderStatus, renderImport, renderSources, renderList } from './lib/import.mjs';
export { RESUME_LOG_LINES, RESUME_READY, cmdResume, renderResume, cmdHandoffRead, HANDOFF_TEXT, cmdHandoffWrite, cmdReport } from './lib/resume.mjs';
export { VERIFY_SHOWN, cmdVerify, renderVerify } from './lib/verify.mjs';
export { mergeDecisionsTexts, mergeFlags, runDecisionsDriver } from './lib/merge-driver.mjs';
