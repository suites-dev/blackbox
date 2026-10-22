import { canonicalization } from './canonical.js';
import { envelopeDigest, experimentDigest } from './build.js';
import {
  captureDigest,
  catalogDigest,
  configurationFingerprint,
  environmentDigest,
  instrumentationDigest,
  sourceFingerprint,
} from './fingerprints.js';
import { stateRecordDigest } from './state.js';
import { stimulusFingerprint } from '../stimulus/summary.js';
import type { BehaviorEnvelope, LegacyBehaviorEnvelope } from './types.js';

export type EnvelopeVerification =
  { readonly ok: true } | { readonly ok: false; readonly problems: readonly string[] };

type AnyEnvelope = BehaviorEnvelope | LegacyBehaviorEnvelope;
type Check = (name: string, ok: boolean) => void;

/** A shallow guard; anything deeper that is malformed is reported by the checks below. */
function isEnvelope(value: unknown): value is AnyEnvelope {
  return (
    value !== null &&
    typeof value === 'object' &&
    'kind' in value &&
    value.kind === 'behavior-envelope' &&
    'envelopeVersion' in value &&
    (value.envelopeVersion === 1 || value.envelopeVersion === 2) &&
    'canonicalization' in value &&
    value.canonicalization === canonicalization
  );
}

function configurationChecks(envelope: AnyEnvelope, check: Check): void {
  const { catalog, instrumentation, capture, environment } = envelope.configuration;
  check('configuration.catalog.digest', catalog.digest === catalogDigest(catalog));
  check(
    'configuration.instrumentation.digest',
    instrumentation.digest === instrumentationDigest(instrumentation),
  );
  const { digest: _captureDigest, ...captureBody } = capture;
  check('configuration.capture.digest', capture.digest === captureDigest(captureBody));
  const { digest: _environmentDigest, ...environmentBody } = environment;
  check(
    'configuration.environment.digest',
    environment.digest === environmentDigest(environmentBody),
  );
  check(
    'configuration.fingerprint',
    envelope.configuration.fingerprint === configurationFingerprint(envelope.configuration),
  );
  check(
    'identity.experiment',
    envelope.identity.experiment ===
      experimentDigest(
        envelope.identity.behavior.id,
        envelope.configuration.fingerprint,
        envelope.envelopeVersion === 1 ? 'not-recorded' : envelope.identity.stimulus,
      ),
  );
  check('source.fingerprint', envelope.source.fingerprint === sourceFingerprint(envelope.source));
}

function inputChecks(envelope: BehaviorEnvelope, check: Check): void {
  const { stimulus } = envelope;
  const recorded = stimulus.state === 'recorded' || stimulus.state === 'reconstructed';
  check(
    'stimulus.fingerprint',
    stimulus.fingerprint ===
      (recorded ? stimulusFingerprint(stimulus.activities, stimulus.opaqueRequests) : null),
  );
  check('identity.stimulus', envelope.identity.stimulus === stimulus.fingerprint);
  for (const record of envelope.state.records) {
    check(
      `state.${record.subject}`,
      record.digest === stateRecordDigest(record) && record.distinct === record.identities.length,
    );
  }
}

function invariantChecks(envelope: AnyEnvelope, check: Check): void {
  if (envelope.envelopeVersion === 1) {
    check('expectations.acceptedBaselines', envelope.expectations.acceptedBaselines.length === 0);
  }
  check('expectations.acceptedContracts', envelope.expectations.acceptedContracts.length === 0);
  check(
    'observed.effectsRecord',
    (envelope.observed.effectsRecord === null) === (envelope.observed.effectsRecordReason !== null),
  );
  check(
    'observed.effectsRecord.completeness',
    envelope.observed.effectsRecord === null ||
      envelope.observed.effectsRecord.completeness.status !== 'complete',
  );
  const ids = envelope.evidence.map(({ kind, id }) => `${kind}:${id}`);
  check('evidence.unique', new Set(ids).size === ids.length);
  for (const assertion of envelope.verification.assertions) {
    check(
      `verification.evidence:${String(assertion.sequence)}`,
      envelope.evidence.some(({ id }) => id === assertion.evidence),
    );
  }
}

/**
 * Recomputes every digest and checks the invariants a reader may rely on. It never trusts a stored digest,
 * and a failure names what disagrees so a tampered or mixed-up document is identifiable.
 */
export function verifyEnvelope(value: unknown): EnvelopeVerification {
  if (!isEnvelope(value)) {
    return {
      ok: false,
      problems: ['not a supported behavior envelope (kind, version or canonicalization)'],
    };
  }
  const problems: string[] = [];
  const check: Check = (name, ok) => {
    if (!ok) {
      problems.push(name);
    }
  };
  try {
    const { digest, ...rest } = value;
    check('digest', digest === envelopeDigest(rest));
    configurationChecks(value, check);
    if (value.envelopeVersion === 2) {
      inputChecks(value, check);
    }
    invariantChecks(value, check);
  } catch (error) {
    problems.push(`malformed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}
