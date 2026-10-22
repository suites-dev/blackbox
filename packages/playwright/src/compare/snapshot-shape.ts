import {
  isCount,
  isFlag,
  isList,
  isObject,
  isText,
  listOf,
  shapeProblems,
  type Rules,
} from '../envelope/shape/fields.js';

const counts = Object.fromEntries(
  [
    'activities',
    'activityTraces',
    'diagnostics',
    'observations',
    'effects',
    'effectSources',
    'relations',
    'qualityReasons',
    'ownership',
    'owners',
  ].map((name) => [name, isCount]),
);

const admitted = {
  observations: {
    payloadCount: isCount,
    excerpts: listOf({ traceId: isText, spanId: isText, service: isText, kind: isText }),
  },
  projection: {
    effects: listOf({
      id: isText,
      kind: isText,
      operation: isText,
      target: isText,
      actor: isText,
      outcome: isText,
      source: listOf({ traceId: isText, spanId: isText }),
    }),
  },
  ownership: listOf({
    effectId: isText,
    observations: listOf({
      traceId: isText,
      spanId: isText,
      owners: listOf({ activityId: isText, purpose: isText }),
    }),
  }),
  omitted: counts,
} satisfies Rules;

/**
 * The fields the comparator reads from a final snapshot. A snapshot body is only checked against the digest the
 * envelope recorded, so a body of the right digest and the wrong shape must be refused before anything reads it.
 */
export function snapshotShapeProblems(value: unknown): string[] {
  const problems = shapeProblems(value, {
    schemaVersion: (v) => v === 1,
    kind: (v) => v === 'final-snapshot',
    attempt: { status: isText, retry: isCount },
    finalization: { collector: isObject },
    stimuli: { state: isText, activities: isList },
    observation: {
      state: isText,
      payloadCount: isCount,
      observedServices: listOf(isText),
      activatedWithoutObservation: listOf(isText),
    },
    completeness: { status: isText, closed: isFlag, reasons: listOf(isText) },
    evidence: { kind: isText },
  });
  if (problems.length > 0 || !isObject(value) || !isObject(value.evidence)) {
    return problems;
  }
  return value.evidence.kind === 'admitted'
    ? shapeProblems(value.evidence, admitted).map((path) => `evidence.${path}`)
    : [];
}
