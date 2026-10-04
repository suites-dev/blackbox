import { join } from 'node:path';

function assert(value, message) {
  if (!value) throw new Error(message);
}

const effectExpectations = new Map([
  [
    'Scenario: a valid payment method creates a payment intent',
    [{ evaluation: 'satisfied', outcome: 'passed', negated: false }],
  ],
  [
    'PostgreSQL INSERT is observed and persisted state is checked separately',
    [{ evaluation: 'satisfied', outcome: 'passed', negated: false }],
  ],
  [
    'RabbitMQ send is observed and broker delivery is checked separately',
    [{ evaluation: 'satisfied', outcome: 'passed', negated: false }],
  ],
  [
    'an observed forbidden INSERT produces a definite matcher failure',
    [{ evaluation: 'unsatisfied', outcome: 'failed', negated: false }],
  ],
  [
    'inspection SELECT cannot satisfy a stimulus SELECT contract',
    [
      { evaluation: 'satisfied', outcome: 'passed', negated: false },
      { evaluation: 'inconclusive', outcome: 'inconclusive', negated: false },
    ],
  ],
  ...['alpha', 'beta'].map((destination) => [
    `@isolation ${destination} attempt cannot use the other destination`,
    [
      { evaluation: 'satisfied', outcome: 'passed', negated: false },
      { evaluation: 'inconclusive', outcome: 'inconclusive', negated: false },
    ],
  ]),
  [
    'a rolled-back INSERT remains an observed operation while state is absent',
    [{ evaluation: 'satisfied', outcome: 'passed', negated: false }],
  ],
  [
    'browser stimulus propagates ownership to a PostgreSQL INSERT',
    [{ evaluation: 'satisfied', outcome: 'passed', negated: false }],
  ],
  [
    'plain browser work cannot satisfy a later stimulus contract',
    [
      { evaluation: 'satisfied', outcome: 'passed', negated: false },
      { evaluation: 'inconclusive', outcome: 'inconclusive', negated: false },
    ],
  ],
  [
    '@withheld successful action stays inconclusive under positive and negated matchers',
    [
      { evaluation: 'inconclusive', outcome: 'inconclusive', negated: false },
      { evaluation: 'inconclusive', outcome: 'inconclusive', negated: true },
    ],
  ],
]);

function expectedContract(title, index) {
  if (title === 'Scenario: a valid payment method creates a payment intent') {
    return {
      operator: 'atLeast',
      count: 1,
      selector: { node: 'selector', kind: 'http', operation: 'POST' },
    };
  }
  if (title === 'RabbitMQ send is observed and broker delivery is checked separately') {
    return {
      operator: 'atLeast',
      count: 1,
      selector: {
        node: 'selector',
        kind: 'message',
        operation: 'send',
        target: 'acceptance.alpha',
      },
    };
  }
  if (title === 'an observed forbidden INSERT produces a definite matcher failure') {
    return {
      operator: 'exactly',
      count: 0,
      selector: { node: 'selector', kind: 'db', operation: 'INSERT' },
    };
  }
  if (title === 'inspection SELECT cannot satisfy a stimulus SELECT contract') {
    return index === 0
      ? {
          operator: 'atLeast',
          count: 1,
          selector: {
            node: 'selector',
            kind: 'message',
            operation: 'send',
            target: 'acceptance.alpha',
          },
        }
      : {
          operator: 'atLeast',
          count: 1,
          selector: { node: 'selector', kind: 'db', operation: 'SELECT' },
        };
  }
  if (title.startsWith('@isolation ')) {
    const own = title.includes(' alpha ') ? 'alpha' : 'beta';
    const target = index === 0 ? own : own === 'alpha' ? 'beta' : 'alpha';
    return {
      operator: 'atLeast',
      count: 1,
      selector: {
        node: 'selector',
        kind: 'message',
        operation: 'send',
        target: `acceptance.${target}`,
      },
    };
  }
  if (title === 'plain browser work cannot satisfy a later stimulus contract' && index === 0) {
    return {
      operator: 'atLeast',
      count: 1,
      selector: { node: 'selector', kind: 'message', operation: 'send', target: 'acceptance.beta' },
    };
  }
  return {
    operator: 'atLeast',
    count: 1,
    selector: { node: 'selector', kind: 'db', operation: 'INSERT' },
  };
}

function verifyContract(contract, expected) {
  exactKeys(contract, ['schemaVersion', 'constraints', 'omitted'], 'Effects contract');
  assert(contract.schemaVersion === 1, 'Unexpected effects contract schema');
  assert(contract.constraints.length === 1, 'Effects contract changed its constraint count');
  assert(
    contract.omitted.constraints === 0 && contract.omitted.selectorWhereEntries === 0,
    'Effects contract evidence was omitted',
  );
  const constraint = contract.constraints[0];
  exactKeys(constraint, ['node', 'operator', 'count', 'selector'], 'Effects constraint');
  assert(constraint.node === 'constraint', 'Effects contract omitted the constraint node');
  assert(
    constraint.operator === expected.operator && constraint.count === expected.count,
    'Effects contract changed its operator or count',
  );
  exactKeys(constraint.selector, Object.keys(expected.selector), 'Effects selector');
  assert(
    Object.entries(expected.selector).every(([key, value]) => constraint.selector[key] === value),
    'Effects contract changed its selector',
  );
}

function decode(attachment, name) {
  assert(typeof attachment?.body === 'string', `Missing ${name} attachment body`);
  return JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8'));
}

function exactKeys(value, keys, label) {
  assert(value !== null && typeof value === 'object', `${label} is not an object`);
  assert(
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort()),
    `${label} exposed an unexpected schema`,
  );
}

const semanticFields = new Set([
  'db.collection.name',
  'db.name',
  'db.namespace',
  'db.operation',
  'db.operation.name',
  'db.sql.table',
  'db.system',
  'db.system.name',
  'http.method',
  'http.request.method',
  'http.route',
  'messaging.destination',
  'messaging.destination.name',
  'messaging.operation',
  'messaging.operation.type',
  'rpc.method',
  'rpc.service',
]);

const omissionNames = [
  'activities',
  'activityTraces',
  'diagnostics',
  'observations',
  'effects',
  'effectSources',
  'relations',
  'qualityReasons',
  'findings',
  'findingEvidence',
  'ownership',
  'owners',
];

function observationKey({ traceId, spanId }) {
  return `${traceId}:${spanId}`;
}

function witnessedOperation(excerpt, selector) {
  const keys = {
    cache: new Set(['db.operation', 'db.operation.name']),
    db: new Set(['db.operation', 'db.operation.name']),
    http: new Set(['http.method', 'http.request.method']),
    message: new Set(['messaging.operation', 'messaging.operation.type']),
    rpc: new Set(['rpc.method']),
  }[selector.kind];
  const values =
    selector.kind === 'message' && selector.operation === 'send'
      ? new Set(['send', 'publish'])
      : new Set([selector.operation.toLowerCase()]);
  return excerpt.fields.some(
    ({ key, value }) =>
      keys?.has(key) && typeof value === 'string' && values.has(value.toLowerCase()),
  );
}

function verifyWithheldEvidence(evidence, identity, assertionDiagnostic) {
  exactKeys(
    evidence,
    ['kind', 'observations', 'selection', 'projection', 'assessment', 'ownership', 'omitted'],
    'Withheld effects evidence',
  );
  assert(evidence.kind === 'admitted', 'Withheld effects scope was not admitted');
  const { observations, selection, projection, assessment, ownership, omitted } = evidence;
  exactKeys(
    observations,
    ['scopeId', 'payloadCount', 'diagnostics', 'excerpts'],
    'Withheld observations',
  );
  exactKeys(
    selection,
    ['scopeId', 'sessionId', 'executionId', 'kind', 'activities'],
    'Withheld selection',
  );
  assert(
    selection.sessionId === identity.sessionId && selection.executionId === identity.executionId,
    'Withheld effects evidence changed its attempt identity',
  );
  assert(
    selection.kind === 'stimulus' && selection.activities.length === 1,
    'Withheld effects evidence changed its stimulus selection',
  );
  const [activity] = selection.activities;
  exactKeys(activity, ['activityId', 'purpose', 'traceIds'], 'Withheld activity');
  assert(
    typeof activity.activityId === 'string' &&
      activity.activityId.length > 0 &&
      activity.purpose === 'stimulus' &&
      activity.traceIds.length === 1 &&
      typeof activity.traceIds[0] === 'string' &&
      activity.traceIds[0].length > 0,
    'Withheld effects evidence changed its owned trace',
  );
  const missingTrace = `activity-trace-not-received:${activity.activityId}:${activity.traceIds[0]}`;
  const missingTraceDiagnostics = observations.diagnostics.filter((diagnostic) =>
    diagnostic.startsWith('activity-trace-not-received:'),
  );
  assert(
    observations.diagnostics.includes('explicit-activity-trace-admission') &&
      missingTraceDiagnostics.length === 1 &&
      missingTraceDiagnostics[0] === missingTrace &&
      assertionDiagnostic.includes(missingTrace),
    'Withheld effects evidence omitted its exact selected-trace diagnostic',
  );
  assert(
    observations.scopeId === selection.scopeId &&
      projection.scope?.id === selection.scopeId &&
      assessment.scope === selection.scopeId,
    'Withheld effects evidence combined different scopes',
  );
  assert(
    observations.payloadCount === 0 && observations.excerpts.length === 0,
    'Withheld effects evidence fabricated telemetry observations',
  );
  exactKeys(
    projection,
    ['schemaVersion', 'scope', 'quality', 'effects', 'relations'],
    'Withheld projection',
  );
  exactKeys(projection.scope, ['id', 'closed'], 'Withheld projection scope');
  exactKeys(
    projection.quality,
    ['coverage', 'orderCoverage', 'reasons', 'attestation'],
    'Withheld projection quality',
  );
  assert(projection.schemaVersion === '0.1.1', 'Unexpected withheld projection schema');
  assert(
    projection.scope.closed === false &&
      projection.quality.coverage === 'unknown' &&
      projection.quality.orderCoverage === 'unknown' &&
      projection.quality.attestation === 'none' &&
      projection.quality.reasons.length === 1 &&
      projection.quality.reasons[0] === 'no-harness-completeness-attestation',
    'Withheld effects evidence falsely claimed graph completeness',
  );
  assert(
    projection.effects.length === 0 && projection.relations.length === 0 && ownership.length === 0,
    'Withheld effects evidence fabricated projected evidence',
  );
  exactKeys(assessment, ['status', 'findings', 'scope', 'semanticsVersion'], 'Withheld assessment');
  assert(
    assessment.status === 'inconclusive' &&
      assessment.semanticsVersion === '0.1.0' &&
      assessment.findings.length === 1,
    'Withheld effects assessment was not inconclusive',
  );
  const [finding] = assessment.findings;
  exactKeys(finding, ['index', 'status', 'reason', 'evidence'], 'Withheld finding');
  assert(
    finding.index === 0 &&
      finding.status === 'inconclusive' &&
      typeof finding.reason === 'string' &&
      finding.reason.length > 0 &&
      finding.evidence.length === 0,
    'Withheld effects finding fabricated a definite result',
  );
  exactKeys(omitted, omissionNames, 'Withheld omission counts');
  assert(
    omissionNames.every((name) => omitted[name] === 0),
    'Withheld effects evidence omitted report data',
  );
}

function verifyAdmittedEvidence(evidence, identity, contract) {
  exactKeys(
    evidence,
    ['kind', 'observations', 'selection', 'projection', 'assessment', 'ownership', 'omitted'],
    'Admitted effects evidence',
  );
  assert(evidence.kind === 'admitted', 'Expected admitted effects evidence');
  const { observations, selection, projection, assessment, ownership, omitted } = evidence;
  assert(selection.kind === 'stimulus', 'Effects evidence did not select stimulus activities');
  assert(
    selection.sessionId === identity.sessionId,
    'Effects evidence changed the session identity',
  );
  assert(
    selection.executionId === identity.executionId,
    'Effects evidence changed the execution identity',
  );
  assert(selection.activities.length > 0, 'Effects evidence omitted stimulus activities');
  assert(
    selection.activities.every(
      (activity) => activity.purpose === 'stimulus' && activity.traceIds.length > 0,
    ),
    'Effects evidence admitted a non-stimulus or untraced activity',
  );
  assert(
    observations.scopeId === selection.scopeId &&
      projection.scope.id === selection.scopeId &&
      assessment.scope === selection.scopeId,
    'Effects evidence combined different scopes',
  );
  assert(observations.payloadCount > 0, 'Effects evidence admitted no telemetry payloads');
  assert(observations.excerpts.length > 0, 'Effects evidence omitted raw observation excerpts');
  const excerptIds = new Set();
  for (const excerpt of observations.excerpts) {
    exactKeys(
      excerpt,
      ['traceId', 'spanId', 'service', 'kind', 'status', 'fields'],
      'Observation excerpt',
    );
    assert(
      [excerpt.traceId, excerpt.spanId, excerpt.service, excerpt.kind, excerpt.status].every(
        (value) => typeof value === 'string' && value.length > 0,
      ),
      'Observation excerpt omitted its safe identity',
    );
    for (const field of excerpt.fields) {
      exactKeys(field, ['key', 'value'], 'Observation semantic field');
      assert(semanticFields.has(field.key), 'Observation excerpt exposed an unsafe field');
    }
    excerptIds.add(observationKey(excerpt));
  }
  assert(projection.schemaVersion === '0.1.1', 'Unexpected effects projection schema');
  assert(projection.effects.length > 0, 'Effects evidence projected no effects');
  assert(
    projection.effects.every(({ source }) =>
      source.every((item) => excerptIds.has(observationKey(item))),
    ),
    'Projected effects do not join to raw observation excerpts',
  );
  assert(
    projection.effects.every((effect) =>
      effect.kind === 'unknown'
        ? effect.operation === 'unknown' && effect.target === 'unknown'
        : effect.source.some((item) => {
            const excerpt = observations.excerpts.find(
              (candidate) => observationKey(candidate) === observationKey(item),
            );
            return excerpt !== undefined && witnessedOperation(excerpt, effect);
          }),
    ),
    'Effects evidence omitted a classified operation field or invented an unknown effect',
  );
  const effectIds = new Set(projection.effects.map(({ id }) => id));
  for (const finding of assessment.findings) {
    for (const effectId of finding.evidence) {
      const effect = projection.effects.find(({ id }) => id === effectId);
      assert(effect !== undefined, 'Effects finding references an unprojected effect');
      const selector = contract.selector;
      assert(
        effect.kind !== 'unknown' &&
          ['kind', 'operation', 'target'].every(
            (key) => selector[key] === undefined || selector[key] === effect[key],
          ),
        'Effects finding evidence does not satisfy its reported selector',
      );
    }
  }
  const activityIds = new Set(selection.activities.map(({ activityId }) => activityId));
  const selectedTraceIds = new Set(selection.activities.flatMap(({ traceIds }) => traceIds));
  const owners = ownership.flatMap(({ effectId, observations: ownedObservations }) => {
    assert(effectIds.has(effectId), 'Effects ownership references an unprojected effect');
    assert(
      ownedObservations.every(
        (observation) =>
          selectedTraceIds.has(observation.traceId) && excerptIds.has(observationKey(observation)),
      ),
      'Effects ownership does not join to selected raw observations',
    );
    return ownedObservations.flatMap((observation) => observation.owners);
  });
  assert(owners.length > 0, 'Effects evidence omitted activity ownership');
  assert(
    owners.every(
      ({ activityId, purpose }) => purpose === 'stimulus' && activityIds.has(activityId),
    ),
    'Effects ownership references an unselected activity',
  );
  exactKeys(omitted, omissionNames, 'Effects omission counts');
  assert(
    omissionNames.every((name) => Number.isInteger(omitted[name]) && omitted[name] >= 0),
    'Effects omission counts are invalid',
  );
}

export function verifyEffectReports(attempts) {
  let assertions = 0;
  for (const attempt of attempts) {
    const expected = effectExpectations.get(attempt.title);
    const attachments = attempt.attachments.filter(({ name }) => name === 'blackbox-effects');
    if (expected === undefined) {
      assert(attachments.length === 0, `Unexpected effects evidence for ${attempt.title}`);
      continue;
    }
    assert(
      attachments.length === expected.length,
      `Expected ${expected.length} effects assertions for ${attempt.title}, received ${attachments.length}`,
    );
    const identity = decode(
      attempt.attachments.find(({ name }) => name === 'blackbox-attempt'),
      'blackbox-attempt',
    ).identity;
    attachments.forEach((attachment, index) => {
      const document = decode(attachment, 'blackbox-effects');
      exactKeys(document, ['schemaVersion', 'assertion', 'display', 'evidence'], 'Effects report');
      assert(document.schemaVersion === 1, 'Unexpected effects report schema version');
      exactKeys(
        document.assertion,
        ['sequence', 'negated', 'outcome', 'evaluation', 'diagnostic', 'contract'],
        'Effects assertion',
      );
      assert(document.assertion.sequence === index + 1, 'Effects assertion sequence is not stable');
      const contract = expectedContract(attempt.title, index);
      verifyContract(document.assertion.contract, contract);
      for (const [key, value] of Object.entries(expected[index])) {
        assert(document.assertion[key] === value, `Unexpected effects ${key} for ${attempt.title}`);
      }
      assert(
        document.display.stringLimit === 1000 &&
          Number.isInteger(document.display.truncatedStrings) &&
          document.display.truncatedStrings >= 0,
        'Effects report omitted bounded display evidence',
      );
      if (attempt.title.startsWith('@withheld ')) {
        verifyWithheldEvidence(document.evidence, identity, document.assertion.diagnostic);
      } else {
        verifyAdmittedEvidence(document.evidence, identity, contract);
      }
      const expectedStatus = {
        satisfied: 'pass',
        unsatisfied: 'fail',
        inconclusive: 'inconclusive',
      }[document.assertion.evaluation];
      if (document.evidence.kind === 'admitted') {
        assert(
          document.evidence.assessment.status === expectedStatus,
          'Effects assessment disagrees with the assertion',
        );
      }
    });
    assertions += attachments.length;
  }
  assert(assertions === 16, `Expected 16 effects assertion reports, received ${assertions}`);
  return { kind: 'playwright-effects-reporting-proof', assertions };
}

export function verifyParallelAcquisition({ attempts }) {
  const overlaps = attempts.flatMap((first, index) =>
    attempts
      .slice(index + 1)
      .filter(
        (second) =>
          first.workerIndex !== second.workerIndex &&
          [first, second].every(
            (attempt) =>
              Number.isFinite(attempt.acquisitionStartedAt) &&
              Number.isFinite(attempt.acquisitionCompletedAt) &&
              attempt.acquisitionStartedAt < attempt.acquisitionCompletedAt,
          ) &&
          Math.max(first.acquisitionStartedAt, second.acquisitionStartedAt) <
            Math.min(first.acquisitionCompletedAt, second.acquisitionCompletedAt),
      )
      .map((second) => [first, second]),
  );
  assert(
    overlaps.some(([first, second]) => first.file === second.file),
    'No concurrent sandbox acquisition within a test file',
  );
  assert(
    overlaps.some(([first, second]) => first.file !== second.file),
    'No concurrent sandbox acquisition across test files',
  );
}

function verifyNativeLifecycle(liveAttempt) {
  assert(
    Array.isArray(liveAttempt.lifecycleSteps),
    'Live report omitted native sandbox lifecycle steps',
  );
  assert(
    liveAttempt.lifecycleSteps.length === 2,
    'Live report duplicated or omitted native sandbox lifecycle steps',
  );
  const [start, cleanup] = liveAttempt.lifecycleSteps;
  assert(
    start.title === 'Start sandbox' && cleanup.title === 'Clean up sandbox',
    'Native sandbox lifecycle steps are missing or out of order',
  );
  for (const step of [start, cleanup]) {
    exactKeys(
      step,
      [
        'title',
        'sequence',
        'startedAt',
        'startedAtMonotonic',
        'completedAtMonotonic',
        'duration',
        'status',
        'error',
      ],
      'Native sandbox lifecycle step',
    );
    assert(
      Number.isInteger(step.sequence) &&
        Number.isFinite(step.startedAtMonotonic) &&
        Number.isFinite(step.completedAtMonotonic) &&
        Number.isFinite(step.duration) &&
        step.duration >= 0 &&
        step.completedAtMonotonic >= step.startedAtMonotonic &&
        Number.isFinite(Date.parse(step.startedAt)),
      'Native sandbox lifecycle step has invalid timings',
    );
    assert(
      step.status === 'completed' && step.error === null,
      'Native sandbox lifecycle step failed or did not complete',
    );
  }
  assert(
    start.sequence === 0 &&
      cleanup.sequence === 1 &&
      start.completedAtMonotonic <= cleanup.startedAtMonotonic,
    'Native sandbox lifecycle steps are missing or out of order',
  );
  assert(
    start.startedAtMonotonic <= liveAttempt.acquisitionStartedAt &&
      liveAttempt.acquisitionStartedAt < liveAttempt.acquisitionCompletedAt &&
      liveAttempt.acquisitionCompletedAt <= start.completedAtMonotonic,
    'Sandbox acquisition timings fall outside the native Start sandbox step',
  );
}

export function verifyAttemptReports({ attempts, records, live, text }) {
  assert(live.errors.length === 0, `Live reporting failed: ${live.errors.join('; ')}`);
  assert(live.attempts.length === attempts.length, 'Live report omitted attempts');
  const identities = [];
  for (const attempt of attempts) {
    const attachment = attempt.attachments.find(({ name }) => name === 'blackbox-attempt');
    assert(typeof attachment?.body === 'string', 'Missing Blackbox attempt attachment');
    const document = JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8'));
    assert(
      document.schemaVersion === 1 && document.identity?.kind === 'acquired',
      'Missing acquired identity',
    );
    const { sandboxId, executionId, sessionId, catalogEntry } = document.identity;
    const owner = document.owner;
    assert(
      owner !== undefined &&
        ['testId', 'retry', 'workerIndex', 'parallelIndex'].every(
          (key) => owner[key] !== undefined && owner[key] === attempt[key],
        ),
      'Report belongs to a different Playwright attempt',
    );
    const liveAttempts = live.attempts.filter(
      (item) => item.testId === attempt.testId && item.retry === attempt.retry,
    );
    assert(
      liveAttempts.length === 1 &&
        liveAttempts[0].workerIndex === attempt.workerIndex &&
        liveAttempts[0].parallelIndex === attempt.parallelIndex &&
        liveAttempts[0].sandboxId === sandboxId,
      'Live report belongs to a different Playwright attempt or sandbox',
    );
    verifyNativeLifecycle(liveAttempts[0]);
    assert(
      sandboxId === executionId && typeof sessionId === 'string',
      'Invalid report execution identity',
    );
    const record = records.find(({ value }) => value.sandboxId === sandboxId);
    assert(
      record !== undefined && record.value.cleanup === 'complete',
      'Report has no matching cleaned Sandbox',
    );
    assert(
      catalogEntry.id === attempt.expectedCatalog.id &&
        catalogEntry.kind === attempt.expectedCatalog.kind,
      'Report catalog does not match its scenario',
    );
    assert(
      typeof owner.outputDirectory === 'string' &&
        record.recordDirectory === join(owner.outputDirectory, 'blackbox'),
      'Sandbox record is outside its owning attempt output directory',
    );
    const events = document.events;
    const completed = (phase) =>
      events.findIndex((event) => event.phase === phase && event.status === 'completed');
    const phases = [
      'catalog',
      'acquisition',
      'instrumentation',
      'readiness',
      'sandbox',
      'teardown',
      'collector',
    ];
    let previous = -1;
    for (const phase of phases) {
      const current = completed(phase);
      assert(current > previous, `Missing or out-of-order phase: ${phase}`);
      previous = current;
    }
    assert(
      !events.some((event) => event.status === 'failed'),
      'Passed attempt has failed report phase',
    );
    const withheldTitle = attempt.title?.startsWith('@withheld ') ?? false;
    const withheldCatalog =
      attempt.expectedCatalog.kind === 'system' &&
      attempt.expectedCatalog.id === 'effects-withheld';
    assert(
      withheldTitle === withheldCatalog,
      'Withheld attempt title and catalog do not identify the same scenario',
    );
    const observationEvents = events.filter(
      (event) => event.phase === 'observations' && event.status === 'info',
    );
    assert(observationEvents.length === 1, 'Report has an unexpected observations summary');
    if (withheldCatalog) {
      assert(
        observationEvents[0].detail === '0 requests; 0 spans',
        'Withheld report claimed received telemetry',
      );
    } else {
      assert(
        /[1-9]\d* spans/u.test(observationEvents[0].detail),
        'Report has no received telemetry',
      );
    }
    const stdout = (attempt.stdout ?? [])
      .map(
        ({ text, buffer }) =>
          text ??
          (typeof buffer === 'string' ? Buffer.from(buffer, 'base64').toString('utf8') : ''),
      )
      .join('');
    assert(
      !/Blackbox: sandbox (?:ready|cleaned up|cleanup failed)\b/u.test(`${stdout}\n${text}`),
      'Legacy Blackbox lifecycle stdout was emitted',
    );
    assert(
      attempt.attachments.some(({ name }) => name === 'blackbox-diagnostics'),
      'Missing retained Blackbox diagnostics',
    );
    identities.push({ sandboxId, sessionId, catalogEntry });
  }
  assert(
    new Set(identities.map(({ sandboxId }) => sandboxId)).size === attempts.length,
    'Report reused a Sandbox',
  );
  assert(text.includes('Then') && text.includes('And'), 'Text report omitted business steps');
  assert(/\b\d+ passed\b/u.test(text), 'Text report omitted native Playwright summary');
  assert(
    !text.includes('Blackbox ·') && !/^\[\d+\]\s+[·✓→]/mu.test(text),
    'Custom reporter replaced native output',
  );
  assert(
    !text.includes('waiting for Compose') && !text.includes('Docker health:'),
    'Text report streamed internal polling',
  );
  assert(
    !text.includes('playwright-e2e-token') &&
      !JSON.stringify(live).includes('playwright-e2e-token'),
    'Playwright reporting leaked the fixture token',
  );
  return { kind: 'playwright-reporting-proof', attempts: identities, live: true };
}
