import {
  isCount,
  isDigest,
  isDigestOrNull,
  isFlag,
  isList,
  isObject,
  isText,
  isTextOrNull,
  listOf,
  oneOf,
  shapeProblems,
  type Rules,
} from './fields.js';

const inputs = listOf({ role: isText, path: isText, state: isText, digest: isDigestOrNull });

/** Sections every envelope version has. Version 2 adds `stimulus` and `state` and `identity.stimulus`. */
const common = {
  canonicalization: isText,
  digest: isDigest,
  identity: {
    behavior: {
      id: isText,
      basis: oneOf('declared', 'derived'),
      derivedId: isText,
      declaration: { state: isText },
    },
    attempt: {
      attemptId: isText,
      executionId: isText,
      sessionId: isText,
      retry: isCount,
      retries: isCount,
    },
    experiment: isDigest,
    observation: isDigestOrNull,
  },
  system: {
    catalogEntry: { id: isText, kind: isText },
    participants: listOf({
      id: isText,
      service: isText,
      role: isText,
      runtime: isText,
      instrumentation: isText,
      activationId: isTextOrNull,
    }),
    observationPolicy: { policyId: isText, requiredBoundaries: listOf(isText) },
  },
  source: {
    state: isText,
    repoId: isTextOrNull,
    commit: isTextOrNull,
    tree: isTextOrNull,
    workingTree: { state: isText },
    fingerprint: isDigestOrNull,
    reason: isTextOrNull,
  },
  configuration: {
    catalog: { entryId: isText, resolved: isDigest, inputs, digest: isDigest },
    instrumentation: { activations: isList, inputs, digest: isDigest },
    capture: { collector: isObject, digest: isDigest },
    environment: {
      platform: isText,
      variables: isObject,
      secretVariableNames: listOf(isText),
      digest: isDigest,
    },
    fingerprint: isDigest,
  },
  observed: {
    finalSnapshot: { state: isText },
    observation: { state: isText, payloadCount: isCount },
    completeness: { status: isText, closed: isFlag, reasons: listOf(isText) },
    coverage: {
      participants: listOf({ id: isText, service: isText, status: isText }),
      gaps: listOf(isText),
    },
    effectsRecordReason: isTextOrNull,
  },
  expectations: { declaredInTest: listOf({ contractDigest: isDigest, assertions: isCount }) },
  verification: {
    testStatus: { status: isText, expectedStatus: isText, errorCount: isCount },
    assertions: listOf({
      sequence: isCount,
      outcome: isText,
      evaluation: isText,
      contractDigest: isDigest,
      evidence: isDigest,
    }),
  },
  evidence: listOf({ id: isDigest, kind: isText, bytes: isCount, locator: isObject }),
  provenance: {
    capturedAt: isText,
    test: { file: isText, titlePath: listOf(isText), project: isText, runnerTestId: isText },
    source: { branch: isTextOrNull, changedPaths: listOf(isText) },
    ci: isObject,
    packageVersion: isText,
  },
} satisfies Rules;

const versionTwo = {
  stimulus: {
    state: isText,
    activities: isList,
    unscopedRequests: isCount,
    opaqueRequests: isCount,
    fingerprint: isDigestOrNull,
  },
  state: {
    records: listOf({
      subject: isText,
      source: isText,
      count: isCount,
      distinct: isCount,
      identities: listOf(isText),
      digest: isDigest,
    }),
    rejected: isCount,
  },
} satisfies Rules;

/**
 * The fields the index, the queries and the comparator read, with their types. A digest only shows that the
 * bytes did not change after someone computed it; it says nothing about whether the sections are there.
 */
export function envelopeShapeProblems(value: unknown, version: 1 | 2): string[] {
  const rules =
    version === 2
      ? {
          ...common,
          ...versionTwo,
          identity: { ...common.identity, stimulus: isDigestOrNull },
        }
      : common;
  return shapeProblems(value, rules).map((path) => `shape: ${path}`);
}
