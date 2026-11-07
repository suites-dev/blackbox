import { realpathSync } from 'node:fs';
import { relative } from 'node:path';

import type { TestInfo } from '@playwright/test';
import type { RecordedStimuli } from '../effects/attempt-effects.js';
import type { EffectAssertionReport, EmissionAssertionReport } from '../effects/runtime.js';
import { emissionAttachment, emissionAttachmentBody, attachExecutionArtifact, evidenceForClaim, linkClaim, type AttachedEvidence, type ExecutionArtifactKind } from './effects/emissions.js';
import { redactEffectSnapshot } from './effects/snapshot-redaction.js';
import type { BlackboxSandbox, BlackboxTelemetry } from '../types.js';

import { effectAttachment, effectAttachmentBody } from './effects/attachment.js';
import { finalSnapshotAttachment, type FinalSnapshotDocument } from '../effects/final-snapshot.js';
import { digestBytes, digestOf, type Digest } from '../envelope/index.js';
import {
  attemptAttachment,
  progressAttachment,
  type AttemptEvent,
  type AttemptProgress,
} from './events.js';
import { SecretValues } from './redaction/secret-environment.js';
import { reportText, reportTextLimit } from './text.js';
import { sandboxLifecycleEnabled } from './options.js';

export type { AttachedEvidence } from './effects/emissions.js';

function assertionFields(
  body: string,
): Pick<AttachedEvidence, 'outcome' | 'evaluation' | 'contractDigest'> {
  try {
    const { assertion } = JSON.parse(body) as {
      assertion: { outcome: string; evaluation: string; contract: unknown };
    };
    return {
      outcome: assertion.outcome,
      evaluation: assertion.evaluation,
      contractDigest: assertion.contract === undefined ? null : digestOf(assertion.contract),
    };
  } catch {
    return { outcome: 'unknown', evaluation: 'unknown', contractDigest: null };
  }
}

/** Attachments use Playwright's worker transport and remain available to other reporters. */
export class AttemptReport implements AttemptProgress {
  private readonly started = Date.now();
  private readonly events: AttemptEvent[] = [];
  private readonly secrets = new SecretValues();
  private pending = Promise.resolve();
  private attachmentFailure: unknown = null;
  private dropped = 0;
  private effectAssertionSequence = 0;
  private executionSequence = 0;
  private executedStimulus = false;
  private readonly evidence: AttachedEvidence[] = [];
  private closed = false;
  private identity:
    | { readonly kind: 'not-ready' }
    | {
        readonly kind: 'acquired';
        readonly sandboxId: string;
        readonly executionId: string;
        readonly sessionId: string;
        readonly catalogEntry: BlackboxSandbox['catalogEntry'];
      } = { kind: 'not-ready' };

  constructor(private readonly testInfo: TestInfo) {}

  acquired(sandbox: BlackboxSandbox, telemetry: BlackboxTelemetry): void {
    this.identity = {
      kind: 'acquired',
      sandboxId: sandbox.sandboxId,
      executionId: sandbox.executionId,
      sessionId: telemetry.sessionId,
      catalogEntry: sandbox.catalogEntry,
    };
  }

  /** The sandbox that owns this attempt, once acquisition has named it. */
  sandboxId(): string | null {
    return this.identity.kind === 'acquired' ? this.identity.sandboxId : null;
  }

  /**
   * The recorded stimuli with known secrets removed from titles, request paths and origins. A request whose path held a
   * secret is counted as unestablished: the redacted path or origin cannot show that two runs sent the same input.
   */
  redactStimuli(recorded: RecordedStimuli): RecordedStimuli {
    let redactedRequests = 0;
    const stimuli = recorded.stimuli.map(({ title, requests }) => ({
      title: this.secrets.redact(title),
      requests: requests.map((request) => {
        const path = this.secrets.redact(request.path);
        const origin = request.origin === null ? null : this.secrets.redact(request.origin);
        redactedRequests += path === request.path && origin === request.origin ? 0 : 1;
        return { ...request, path, origin };
      }),
    }));
    return { ...recorded, stimuli, opaque: recorded.opaque + redactedRequests };
  }

  protect(environment: Readonly<Record<string, string>>): void {
    this.secrets.protect(environment);
  }

  lifecycle(
    status: 'ready' | 'cleaned up' | 'cleanup failed',
    catalog: BlackboxSandbox['catalogEntry'],
  ): void {
    if (sandboxLifecycleEnabled(this.testInfo.config)) {
      // Worker stdout is attributed to this attempt by Playwright and rendered
      // by its native reporter, including cursor handling and parallel output.
      process.stdout.write(
        `${this.sanitize(`Blackbox: sandbox ${status} for ${catalog.kind} ${JSON.stringify(catalog.id)}`)}\n`,
      );
    }
  }

  private sanitize(detail: string): string {
    return reportText(this.secrets.redact(detail));
  }

  redact(text: string): string { return this.sanitize(text); }
  markStimulus(): void { this.executedStimulus = true; }
  hasStimulus(): boolean { return this.executedStimulus; }
  evidenceForClaim(claimId: string): readonly Digest[] { return evidenceForClaim(this, claimId); }
  executionArtifact(kind: ExecutionArtifactKind, value: unknown): Promise<Digest> {
    return attachExecutionArtifact({ testInfo: this.testInfo, kind, value, sequence: ++this.executionSequence,
      sanitize: (text) => this.sanitize(text), register: (item) => { this.evidence.push(item); } });
  }

  async effectAssertion(report: EffectAssertionReport): Promise<void> {
    const sequence = ++this.effectAssertionSequence;
    const body = effectAttachmentBody({
      sequence,
      report,
      sanitize: (value) => {
        const redacted = this.secrets.redact(value);
        return { text: reportText(redacted), truncated: redacted.length > reportTextLimit };
      },
    });
    // An allocation is never reused, even when attachment fails while another call is still pending.
    await this.testInfo.attach(effectAttachment, { contentType: 'application/json', body });
    this.evidence.push({
      kind: 'assertion-evidence',
      name: effectAttachment,
      sequence,
      digest: digestBytes(body),
      bytes: Buffer.byteLength(body),
      ...assertionFields(body),
    });
    linkClaim(this, digestBytes(body));
  }

  async emissionAssertion(report: EmissionAssertionReport): Promise<void> {
    const sequence = ++this.effectAssertionSequence;
    const body = emissionAttachmentBody({ sequence, report, sanitize: (text) => {
      const redacted = this.secrets.redact(text);
      return { text: reportText(redacted), truncated: redacted.length > reportTextLimit };
    } });
    await this.testInfo.attach(emissionAttachment, { contentType: 'application/json', body });
    this.evidence.push({
      kind: 'assertion-evidence', name: emissionAttachment, sequence,
      digest: digestBytes(body), bytes: Buffer.byteLength(body), ...assertionFields(body),
    });
    linkClaim(this, digestBytes(body));
  }

  redactEffectSnapshot(yaml: string): string {
    return redactEffectSnapshot(yaml, (text) => this.secrets.redact(text));
  }

  /** The phase of the last progress event, which names where an attempt that failed to start was. */
  lastPhase(): string {
    const last = this.events.at(-1);
    return last === undefined ? 'start' : last.phase;
  }

  /** An error as one redacted, bounded line. */
  describe(error: unknown): string {
    return this.sanitize(error instanceof Error ? error.message : String(error));
  }

  /** What this attempt attached as evidence, with the digest of each exact body. */
  attachedEvidence(): readonly AttachedEvidence[] {
    return this.evidence;
  }

  /**
   * Attaches the final snapshot with the same redaction and truncation accounting as an assertion, and returns the
   * document exactly as attached, so anything derived from it (the envelope) holds the redacted content and the
   * same identity as the attachment.
   */
  async finalSnapshot(snapshot: FinalSnapshotDocument): Promise<FinalSnapshotDocument> {
    let truncatedStrings = 0;
    const render = (display: number): string =>
      JSON.stringify(
        { ...snapshot, display: { stringLimit: reportTextLimit, truncatedStrings: display } },
        (_key, value: unknown) => {
          if (typeof value !== 'string') {
            return value;
          }
          const redacted = this.secrets.redact(value);
          if (redacted.length > reportTextLimit) {
            truncatedStrings++;
          }
          return reportText(redacted);
        },
      );
    render(0);
    const counted = truncatedStrings;
    truncatedStrings = 0;
    const body = render(counted);
    // Registered only once attached: the envelope must never reference a document that was not produced.
    await this.testInfo.attach(finalSnapshotAttachment, { contentType: 'application/json', body });
    this.evidence.push({
      kind: 'final-snapshot',
      name: finalSnapshotAttachment,
      sequence: 1,
      digest: digestBytes(body),
      bytes: Buffer.byteLength(body),
      outcome: snapshot.attempt.status,
      evaluation: snapshot.observation.state,
      contractDigest: null,
    });
    return JSON.parse(body) as FinalSnapshotDocument;
  }

  emit(phase: string, status: AttemptEvent['status'], detail: string): void {
    if (this.closed) {
      return;
    }
    // Bound repeated startup observations, but always retain phase transitions.
    if (status === 'info' && this.events.length >= 200) {
      this.dropped++;
      return;
    }
    const event = {
      schemaVersion: 1,
      sequence: this.events.length + 1,
      elapsedMs: Date.now() - this.started,
      phase,
      status,
      detail: this.sanitize(detail),
    } satisfies AttemptEvent;
    this.events.push(event);
    this.pending = this.pending
      .then(async () => {
        await this.testInfo.attach(progressAttachment, {
          contentType: 'application/json',
          body: JSON.stringify(event),
        });
      })
      .catch((error: unknown) => {
        this.attachmentFailure = error;
      });
  }

  async flush(): Promise<void> {
    await this.pending;
    if (this.attachmentFailure !== null) {
      throw new Error('Blackbox progress attachment failed', { cause: this.attachmentFailure });
    }
  }

  /** Attach the final attempt document and return the attached body. */
  async finish(): Promise<string> {
    const output = realpathSync(this.testInfo.outputPath());
    const path = relative(realpathSync(process.cwd()), output);
    this.emit('artifacts', 'info', path.startsWith('..') ? output : path);
    this.closed = true;
    await this.flush();
    const document = JSON.stringify({
      schemaVersion: 1,
      owner: {
        testId: this.testInfo.testId,
        retry: this.testInfo.retry,
        workerIndex: this.testInfo.workerIndex,
        parallelIndex: this.testInfo.parallelIndex,
        outputDirectory: output,
      },
      identity: this.identity,
      events: this.events,
      omittedObservations: this.dropped,
    });
    await this.testInfo.attach(attemptAttachment, {
      contentType: 'application/json',
      body: document,
    });
    return document;
  }
}
