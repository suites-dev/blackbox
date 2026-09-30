import type { TraceFragment } from '@suites/blackbox-otel-collector';

import { createRedactionContext } from '../reporting/redaction.js';
import { projectTraceSpans } from '../reporting/telemetry.js';
import type { CapsuleReportSpan } from '../reporting/telemetry-types.js';
import { investigationAttributeKeys } from './span-title.js';

/**
 * The bounded span projection of one trace's retained fragments, with the
 * attributes titles and results read. Text passes through the report's
 * redaction (credentials, private paths), exactly as report spans do.
 */
export function projectInvestigationSpans(input: {
  readonly fragments: readonly TraceFragment[];
  readonly traceId: string;
}): readonly CapsuleReportSpan[] {
  return projectTraceSpans(
    { fragments: input.fragments, traceId: input.traceId, context: createRedactionContext() },
    investigationAttributeKeys,
  );
}
