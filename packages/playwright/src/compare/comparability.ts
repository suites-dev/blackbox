import type {
  CheckEffect,
  CheckResult,
  ComparabilityCheck,
  Comparability,
  ComparableEnvelope,
  ComparisonSide,
} from './types.js';

function check(
  name: string,
  result: CheckResult,
  effect: CheckEffect,
  detail: string,
): ComparabilityCheck {
  return { name, result, effect: result === 'equal' ? 'none' : effect, detail };
}

function systemAndBehavior(a: ComparableEnvelope, b: ComparableEnvelope): ComparabilityCheck[] {
  const system = a.system.catalogEntry.id === b.system.catalogEntry.id;
  const sameBehavior = a.identity.behavior.id === b.identity.behavior.id;
  const hint =
    !sameBehavior && a.identity.behavior.derivedId === b.identity.behavior.derivedId
      ? ' (same derived id: one side declares an id the other does not; not merged without an alias)'
      : '';
  return [
    check(
      'system',
      system ? 'equal' : 'differs',
      'invalidates',
      `${a.system.catalogEntry.id} vs ${b.system.catalogEntry.id}`,
    ),
    check(
      'behavior',
      sameBehavior ? 'equal' : 'differs',
      'invalidates',
      `${a.identity.behavior.id} vs ${b.identity.behavior.id}${hint}`,
    ),
  ];
}

function stimulus(a: ComparableEnvelope, b: ComparableEnvelope): ComparabilityCheck {
  const left = a.stimulus.fingerprint;
  const right = b.stimulus.fingerprint;
  if (left === null || right === null) {
    return check(
      'stimulus',
      'unknown',
      'limits-conclusions',
      `inputs not established (reference ${a.stimulus.state}, head ${b.stimulus.state}); identical inputs are never assumed`,
    );
  }
  return check(
    'stimulus',
    left === right ? 'equal' : 'differs',
    'invalidates',
    left === right
      ? `same requests (${a.stimulus.state} and ${b.stimulus.state})`
      : 'the requests sent to the system differ, so a difference cannot be attributed to the system',
  );
}

function measurementBasis(a: ComparableEnvelope, b: ComparableEnvelope): ComparabilityCheck[] {
  const left = a.configuration;
  const right = b.configuration;
  const capture = left.capture.digest === right.capture.digest;
  const noise = left.capture.noiseProfile === right.capture.noiseProfile;
  const instrumentation = left.instrumentation.digest === right.instrumentation.digest;
  const parts = [
    ...(capture ? [] : ['collector or capture configuration']),
    ...(noise
      ? []
      : [`infrastructure profile ${left.capture.noiseProfile} vs ${right.capture.noiseProfile}`]),
    ...(instrumentation ? [] : ['instrumentation']),
  ];
  return [
    check(
      'measurement-basis',
      capture && noise && instrumentation ? 'equal' : 'differs',
      'limits-conclusions',
      parts.length === 0
        ? 'same collector, capture configuration, infrastructure profile and instrumentation'
        : `changed: ${parts.join(', ')}; telemetry drift cannot be told from behavior drift`,
    ),
  ];
}

function conditions(a: ComparableEnvelope, b: ComparableEnvelope): ComparabilityCheck[] {
  const catalog = a.configuration.catalog.digest === b.configuration.catalog.digest;
  const environment = a.configuration.environment.digest === b.configuration.environment.digest;
  const source = a.source.fingerprint !== null && a.source.fingerprint === b.source.fingerprint;
  return [
    check(
      'catalog',
      catalog ? 'equal' : 'differs',
      'condition-changed',
      catalog
        ? 'same effective catalog entry and referenced files'
        : 'the effective catalog configuration changed',
    ),
    check(
      'environment',
      environment ? 'equal' : 'differs',
      'condition-changed',
      environment
        ? 'same platform, runtime and non-secret variables'
        : 'platform, runtime or variables changed',
    ),
    check(
      'source',
      source ? 'equal' : 'compatible',
      'none',
      source
        ? 'same source fingerprint'
        : 'source differs or is unknown; a revision difference is what a comparison is for',
    ),
  ];
}

function evidence(reference: ComparisonSide, head: ComparisonSide): ComparabilityCheck {
  const problems = [
    ...(reference.snapshot === null
      ? [`reference: ${reference.snapshotProblem ?? 'no snapshot'}`]
      : []),
    ...(head.snapshot === null ? [`head: ${head.snapshotProblem ?? 'no snapshot'}`] : []),
  ];
  return check(
    'evidence',
    problems.length === 0 ? 'equal' : 'unknown',
    'limits-conclusions',
    problems.length === 0
      ? 'both final snapshots present and matching their recorded digests'
      : problems.join('; '),
  );
}

function level(checks: readonly ComparabilityCheck[]): Comparability['level'] {
  if (checks.some(({ effect }) => effect === 'invalidates')) {
    return 'incomparable';
  }
  if (checks.some(({ effect }) => effect === 'limits-conclusions')) {
    return 'limited';
  }
  if (checks.some(({ effect }) => effect === 'condition-changed')) {
    return 'compatible';
  }
  return checks.every(({ result }) => result === 'equal') ? 'identical-experiment' : 'compatible';
}

export function assessComparability(
  reference: ComparisonSide,
  head: ComparisonSide,
): Comparability {
  const a = reference.envelope;
  const b = head.envelope;
  const checks = [
    ...systemAndBehavior(a, b),
    stimulus(a, b),
    ...measurementBasis(a, b),
    ...conditions(a, b),
    evidence(reference, head),
  ];
  return { level: level(checks), checks };
}
