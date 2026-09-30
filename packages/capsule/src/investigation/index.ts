export { observationCompleteness, type ObservationCompleteness } from './completeness.js';
export {
  buildSpanTree,
  compareSpans,
  walkSpanTree,
  type OrphanMark,
  type SpanTreeNode,
} from './span-tree.js';
export {
  earliestStart,
  isoToUnixNano,
  placeTraces,
  type CausalityActivity,
  type CausalityTrace,
  type TracePlacement,
} from './causality.js';
export { investigationAttributeKeys, spanResult, spanTitle } from './span-title.js';
export { projectInvestigationSpans } from './spans.js';
export type { CapsuleReportSpan } from '../reporting/telemetry-types.js';
export { activityContext, type ActivityContext } from './context.js';
export {
  isUnstartedProcess,
  type CapsuleUnstartedProcessOutcome,
} from '../execution/unstarted-process.js';
