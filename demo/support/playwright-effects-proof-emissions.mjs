const verdict = (matcher, status, negated = false) => ({
  matcher,
  evaluation: status,
  negated,
  outcome:
    status === 'inconclusive' ? status : (status === 'pass') !== negated ? 'passed' : 'failed',
});
const emitted = () => verdict('toHaveEmitted', 'pass');
const payload = () => verdict('toHaveEmittedWith', 'pass');
const unknown = (matcher = 'toHaveEmitted', negated = false) =>
  verdict(matcher, 'inconclusive', negated);

export const expectedEmissionVerdicts = {
  'PostgreSQL activity is observed while its operation remains unknown': [
    emitted(),
    payload(),
    verdict('toHaveEmitted', 'pass', true),
    unknown(),
    unknown('toHaveEmitted', true),
    unknown(),
  ],
  'forbidden database activity produces a definite matcher failure': [
    emitted(),
    verdict('toHaveEmittedTimes', 'fail'),
    verdict('toHaveEmitted', 'pass', true),
    unknown('toHaveEmittedTimes'),
    unknown('toHaveEmittedTimes', true),
  ],
  'database activity remains observable after rollback while state is absent': [
    payload(),
    unknown('toHaveEmittedBefore'),
    unknown('toHaveEmittedBefore', true),
    unknown('toHaveNthEmittedWith'),
  ],
  'RabbitMQ activity is observed while send remains unknown': [
    payload(),
    unknown('toHaveEmittedWith'),
    unknown(),
    unknown('toHaveEmitted', true),
  ],
  '@isolation alpha attempt cannot use the other destination': [payload(), unknown()],
  '@isolation beta attempt cannot use the other destination': [payload(), unknown()],
  'inspection database activity cannot satisfy a stimulus database contract': [
    emitted(),
    unknown(),
    unknown('toHaveEmitted', true),
  ],
  '@withheld successful action stays inconclusive under positive and negated matchers': [
    unknown(),
    unknown('toHaveEmitted', true),
    unknown('toHaveEmittedTimes'),
  ],
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(attachment) {
  assert(typeof attachment.body === 'string', 'Emission assertion omitted its report body');
  return JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8'));
}

export function proveEmissionReports(title, attachments) {
  const reports = attachments.filter(({ name }) => name === 'blackbox-emissions').map(read);
  const expected = expectedEmissionVerdicts[title];
  const actual = reports.map(({ assertion }) => {
    const { matcher, evaluation, negated, outcome } = assertion;
    return { matcher, evaluation, negated, outcome };
  });
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `Emission semantic verdicts changed: ${title}`,
  );
  let sequence = 0;
  const captures = new Set();
  const sessions = new Set();
  const executions = new Set();
  for (const report of reports) {
    const { assertion, assessment, evidence } = report;
    const { identity, coverage } = assessment;
    assert(report.schemaVersion === 1, 'Emission report schema changed');
    assert(
      Number.isInteger(assertion.sequence) && assertion.sequence > sequence,
      'Emission assertion sequence was reused',
    );
    sequence = assertion.sequence;
    assert(
      assessment.status === assertion.evaluation,
      'Emission assessment disagrees with matcher',
    );
    for (const key of ['captureId', 'scopeId', 'sessionId', 'executionId']) {
      assert(
        typeof identity[key] === 'string' && identity[key].length > 0,
        `Emission ${key} is missing`,
      );
    }
    assert(
      Array.isArray(identity.activityIds) && identity.activityIds.length > 0,
      'Emission stimulus ownership is missing',
    );
    assert(
      coverage.closed === false && coverage.coverage !== 'complete',
      'Real OTLP capture claimed complete coverage',
    );
    captures.add(identity.captureId);
    sessions.add(identity.sessionId);
    executions.add(identity.executionId);
    if (evidence.kind === 'admitted') {
      assert(
        evidence.selection.sessionId === identity.sessionId &&
          evidence.selection.executionId === identity.executionId,
        'Emission evidence belongs to another attempt',
      );
      assert(
        evidence.projection.scope.id === identity.scopeId,
        'Emission evidence belongs to another scope',
      );
      const known = new Set(evidence.projection.effects.map(({ id }) => id));
      const references = [...assessment.evidence, ...assessment.possibleEvidence];
      assert(
        references.every((id) => known.has(id)),
        'Emission verdict references an unknown occurrence',
      );
    } else {
      assert(
        assessment.status === 'inconclusive',
        'Missing emission evidence received a definite verdict',
      );
    }
    if (assessment.status === 'pass') {
      assert(assessment.evidence.length > 0, 'Positive emission verdict has no witness');
    }
  }
  assert(
    captures.size === 1 && sessions.size === 1 && executions.size === 1,
    'Emission assertions mixed capture or attempt identities',
  );
  return {
    assertions: reports.length,
    executionId: [...executions][0],
    captureId: [...captures][0],
  };
}

export function proveObservedSnapshot(attachments, expected) {
  const values = attachments.filter(({ name }) => name === 'blackbox-observed-effects.yaml');
  assert(
    values.length === 1 && typeof values[0].body === 'string',
    'Observed effects YAML evidence missing',
  );
  const actual = Buffer.from(values[0].body, 'base64').toString('utf8');
  assert(
    typeof expected === 'string' && expected.length > 0 && actual === expected,
    'Observed effects YAML differs from the reviewed baseline',
  );
  return { name: 'request-observations.yaml', bytes: Buffer.byteLength(actual) };
}
