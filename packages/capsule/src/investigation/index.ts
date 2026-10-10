export {
  observationCompleteness,
  sessionCompleteness,
  type ObservationCompleteness,
} from './completeness.js';
export {
  statusDocument,
  treeDocument,
  type SpanNodeDocument,
  type StatusDocument,
} from './tree-document.js';
export {
  buildSpanTree,
  compareSpans,
  walkSpanTree,
  type OrphanMark,
  type SpanTreeNode,
} from './span-tree.js';
export {
  ACTIVITY_WINDOW_GRACE_MS,
  activityWindowEndMs,
  earliestStart,
  isoToUnixNano,
  placeTraces,
  type CausalityActivity,
  type CausalityTrace,
  type TracePlacement,
} from './causality.js';
export {
  investigationAttributeKeys,
  rawPathText,
  spanFailure,
  spanResult,
  spanTitle,
} from './span-title.js';
export { projectInvestigationSpans } from './spans.js';
export type { CapsuleReportSpan } from '../reporting/telemetry-types.js';
export { activityContext, type ActivityContext } from './context.js';
export {
  isUnstartedProcess,
  type CapsuleUnstartedProcessOutcome,
} from '../execution/unstarted-process.js';
