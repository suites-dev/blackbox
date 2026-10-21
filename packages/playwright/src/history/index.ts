/**
 * The local behavioral history: append-only, content-addressed records of what each attempt did, with a
 * rebuildable index and evidence-linked queries. Library only; it needs no service and writes only under the
 * directory it is opened on.
 */
export { BehaviorHistory, HistoryError } from './history.js';
export type { EvidenceCheck, ExecutionDetail, IngestResult, StoreReport } from './history.js';
export { ConflictError } from './store.js';
export { ingestPlaywrightResults, type IngestSummary } from './playwright-results.js';
export type { AliasBody, BehaviorAlias } from './alias.js';
export type { AttemptReceipt } from './receipt.js';
export type { BehaviorSummary, HistoryEntry } from './queries.js';
export type { Findings } from './findings.js';
export type { HistoryIndex } from './index-build.js';
export type { AtMostClaim, BehavioralDelta } from '../compare/types.js';
