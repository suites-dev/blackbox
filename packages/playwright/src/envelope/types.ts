import type { EffectsRecord } from '@suites/blackbox-effects';

import type { RecordedStimulus } from '../stimulus/summary.js';
import type { Digest } from './canonical.js';

export const envelopeVersion = 2;

export type BehaviorBasis = 'declared' | 'derived';

/** Who the behavior is, independent of where its test lives, what it is titled, and which attempt ran it. */
export interface BehaviorIdentity {
  readonly id: string;
  readonly basis: BehaviorBasis;
  /** Always computed, so declaring an id later maps mechanically from the old derived one. */
  readonly derivedId: string;
  readonly declaration:
    | { readonly state: 'declared' | 'absent' }
    | { readonly state: 'rejected'; readonly reason: 'multiple-declarations' | 'invalid-id' };
}

/** The physical attempt. Unique per attempt; never part of a semantic fingerprint. */
export interface AttemptIdentity {
  readonly attemptId: string;
  readonly executionId: string;
  readonly sessionId: string;
  readonly retry: number;
  readonly retries: number;
}

export interface ParticipantExpectation {
  readonly id: string;
  readonly service: string;
  readonly role: string;
  readonly runtime: string;
  readonly instrumentation: 'configured' | 'unconfigured';
  readonly activationId: string | null;
}

export interface SystemSection {
  readonly catalogEntry: { readonly id: string; readonly kind: string };
  readonly participants: readonly ParticipantExpectation[];
  readonly observationPolicy: {
    readonly policyId: string;
    readonly requiredBoundaries: readonly string[];
  };
}

export type WorkingTree =
  | { readonly state: 'clean' }
  | {
      readonly state: 'dirty';
      readonly digest: Digest;
      readonly coverage: 'complete' | 'partial';
    }
  | { readonly state: 'unknown'; readonly reason: string };

export interface SourceSection {
  readonly state: 'captured' | 'unavailable';
  readonly repoId: string | null;
  readonly commit: string | null;
  readonly tree: string | null;
  readonly workingTree: WorkingTree;
  /** Digest of the identity fields above; `null` when the source could not be established. */
  readonly fingerprint: Digest | null;
  readonly reason: string | null;
}

export interface InputDigest {
  readonly role: 'config' | 'compose' | 'driver' | 'activation' | 'instrumentation-manifest';
  readonly path: string;
  readonly state: 'present' | 'missing' | 'unreadable';
  readonly digest: Digest | null;
}

export interface CatalogConfiguration {
  readonly entryId: string;
  readonly resolved: Digest;
  readonly inputs: readonly InputDigest[];
  readonly digest: Digest;
}

export interface InstrumentationConfiguration {
  readonly activations: readonly {
    readonly id: string;
    readonly adapter: string;
    readonly version: number;
  }[];
  readonly inputs: readonly InputDigest[];
  readonly digest: Digest;
}

export interface CaptureConfiguration {
  readonly collector: {
    readonly image: string | null;
    readonly limits: Readonly<Record<string, string>>;
  };
  readonly snapshot: { readonly schemaVersion: number; readonly selection: string };
  /** The allowlist that separates connection management spans from application observations. */
  readonly noiseProfile: string;
  readonly schemas: { readonly effectsGraph: string; readonly effectsRecord: number };
  readonly admission: Readonly<Record<string, number>>;
  readonly evidenceLimits: Readonly<Record<string, number>>;
  readonly state: 'captured' | 'collector-config-unavailable';
  readonly digest: Digest;
}

export interface EnvironmentConfiguration {
  readonly platform: string;
  readonly arch: string;
  readonly node: string;
  readonly docker: string;
  readonly playwright: string;
  readonly workers: number;
  readonly project: string;
  /** Non-credential variables as `name -> digest of name and value`; values are never stored. */
  readonly variables: Readonly<Record<string, Digest>>;
  /** Credential-named variables: the name only. Their values influence nothing here. */
  readonly secretVariableNames: readonly string[];
  readonly digest: Digest;
}

export interface ConfigurationSection {
  readonly catalog: CatalogConfiguration;
  readonly instrumentation: InstrumentationConfiguration;
  readonly capture: CaptureConfiguration;
  readonly environment: EnvironmentConfiguration;
  /** Digest of the four digests above: the conditions the experiment ran under. */
  readonly fingerprint: Digest;
}

export type ParticipantObservation =
  | 'observed'
  | 'activated-without-observation'
  | 'configured-not-activated'
  | 'unconfigured'
  | 'unknown';

export interface CoverageParticipant {
  readonly id: string;
  readonly service: string;
  readonly status: ParticipantObservation;
}

export interface ObservedSection {
  readonly finalSnapshot:
    | { readonly state: 'attached'; readonly evidence: Digest }
    | { readonly state: 'not-produced'; readonly reason: string };
  readonly observation: { readonly state: string; readonly payloadCount: number };
  readonly completeness: {
    readonly status: string;
    readonly closed: boolean;
    readonly reasons: readonly string[];
  };
  /** Expected versus activated versus observed. Facts only: a gap is never a failed assertion. */
  readonly coverage: {
    readonly participants: readonly CoverageParticipant[];
    readonly gaps: readonly string[];
  };
  /** The unchanged v0 record, or `null` with a reason when no admitted observation exists. */
  readonly effectsRecord: EffectsRecord | null;
  readonly effectsRecordReason: string | null;
}

/** Expectations are what someone authored or accepted. Observation never writes here. */
export interface ExpectationsSection {
  readonly acceptedBaselines: readonly never[];
  readonly acceptedContracts: readonly never[];
  readonly declaredInTest: readonly {
    readonly contractDigest: Digest;
    readonly assertions: number;
  }[];
}

export interface AssertionResult {
  readonly sequence: number;
  readonly outcome: string;
  readonly evaluation: string;
  readonly contractDigest: Digest;
  readonly evidence: Digest;
}

export interface VerificationSection {
  readonly testStatus: {
    readonly status: string;
    readonly expectedStatus: string;
    readonly errorCount: number;
  };
  readonly assertions: readonly AssertionResult[];
}

export interface EvidenceRef {
  readonly id: Digest;
  readonly kind:
    | 'assertion-evidence'
    | 'final-snapshot'
    | 'collector-lifecycle'
    | 'collector-fragments'
    | 'sandbox-record';
  readonly bytes: number;
  readonly locator:
    | { readonly type: 'attachment'; readonly name: string; readonly sequence: number }
    | { readonly type: 'file'; readonly root: 'test-output'; readonly path: string };
}

/**
 * What the test sent during its stimulus activities, reduced to digests. `reconstructed` is used only when
 * an envelope is rebuilt from old evidence and the requests are known from the test source.
 */
export interface StimulusSection {
  readonly state: 'recorded' | 'reconstructed' | 'none' | 'unavailable';
  readonly activities: readonly RecordedStimulus[];
  readonly unscopedRequests: number;
  readonly opaqueRequests: number;
  readonly fingerprint: Digest | null;
}

/** An authoritative read of system state that the test chose to report; identities are digests only. */
export interface StateRecord {
  readonly subject: string;
  readonly source: string;
  readonly count: number;
  readonly distinct: number;
  readonly identities: readonly Digest[];
  readonly digest: Digest;
}

export interface StateSection {
  readonly records: readonly StateRecord[];
  readonly rejected: number;
}

/** Everything volatile or local: kept for investigation, excluded from every fingerprint. */
export interface Provenance {
  readonly capturedAt: string;
  readonly test: {
    readonly file: string;
    readonly titlePath: readonly string[];
    readonly project: string;
    readonly runnerTestId: string;
  };
  readonly source: { readonly branch: string | null; readonly changedPaths: readonly string[] };
  readonly ci: Readonly<Record<string, string>>;
  readonly packageVersion: string;
}

export interface BehaviorEnvelope {
  readonly envelopeVersion: typeof envelopeVersion;
  readonly kind: 'behavior-envelope';
  readonly canonicalization: 'bb-jcs-1';
  readonly digest: Digest;
  readonly identity: {
    readonly behavior: BehaviorIdentity;
    readonly attempt: AttemptIdentity;
    /** Digest of the behavior and the configuration fingerprint: what makes two runs the same experiment. */
    readonly experiment: Digest;
    /** Digest of the requests the stimulus sent; `null` when none were recorded. */
    readonly stimulus: Digest | null;
    /** Digest of what was observed and how completely; `null` when nothing was admitted. */
    readonly observation: Digest | null;
  };
  readonly system: SystemSection;
  readonly source: SourceSection;
  readonly configuration: ConfigurationSection;
  readonly stimulus: StimulusSection;
  readonly observed: ObservedSection;
  readonly state: StateSection;
  readonly expectations: ExpectationsSection;
  readonly verification: VerificationSection;
  readonly evidence: readonly EvidenceRef[];
  readonly provenance: Provenance;
}

/** The version 1 shape: no stimulus, no reported state, no noise profile. Still readable and verifiable. */
export type LegacyBehaviorEnvelope = Omit<
  BehaviorEnvelope,
  'envelopeVersion' | 'identity' | 'configuration' | 'stimulus' | 'state'
> & {
  readonly envelopeVersion: 1;
  readonly identity: Omit<BehaviorEnvelope['identity'], 'stimulus'>;
  readonly configuration: Omit<ConfigurationSection, 'capture'> & {
    readonly capture: Omit<CaptureConfiguration, 'noiseProfile'>;
  };
};
