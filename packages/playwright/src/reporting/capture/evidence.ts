import type { TestInfo } from '@playwright/test';
import { evidenceForClaim, linkClaim } from '../../assertions/claims/context.js';
import type { CaptureLease } from '../../capture/operations.js';
import type { EffectAssertionReport, EmissionAssertionReport } from '../../effects/runtime.js';
import { digestBytes, digestOf, type Digest } from '../../envelope/index.js';
import { effectAttachment, effectAttachmentBody } from '../effects/attachment.js';
import { emissionAttachment, emissionAttachmentBody } from '../effects/emissions.js';
import { reportText, reportTextLimit } from '../text.js';
import { attachExecutionArtifact, type AttachedEvidence, type ExecutionArtifactKind } from './execution-artifact.js';

export type { AttachedEvidence, ExecutionArtifactKind } from './execution-artifact.js';

function assertionFields(body: string): Pick<AttachedEvidence, 'outcome' | 'evaluation' | 'contractDigest'> {
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

/** Allocates attachment identities and registers only evidence whose attachment completed. */
export class AttemptEvidence {
  private assertionSequence = 0;
  private executionSequence = 0;
  private readonly evidence: AttachedEvidence[] = [];

  constructor(private readonly input: {
    readonly owner: object;
    readonly testInfo: TestInfo;
    readonly redact: (text: string) => string;
    readonly redactData: (text: string) => string;
  }) {}

  attached(): readonly AttachedEvidence[] { return this.evidence; }
  register(item: AttachedEvidence): void { this.evidence.push(item); }
  forClaim(claimId: string): readonly Digest[] { return evidenceForClaim(this.input.owner, claimId); }

  execution(kind: ExecutionArtifactKind, value: unknown, lease: CaptureLease | undefined): Promise<Digest> {
    if (lease !== undefined) { lease.check(); }
    return attachExecutionArtifact({ testInfo: this.input.testInfo, kind, value, sequence: ++this.executionSequence,
      lease, sanitize: this.input.redactData, register: (item) => { this.register(item); } });
  }

  effect(report: EffectAssertionReport): Promise<void> {
    // An allocation is never reused, even when attachment fails while another call is still pending.
    const sequence = ++this.assertionSequence;
    const body = effectAttachmentBody({ sequence, report, sanitize: (text) => this.display(text) });
    return this.attachAssertion(effectAttachment, sequence, body, undefined);
  }

  emission(report: EmissionAssertionReport, lease: CaptureLease | undefined): Promise<void> {
    if (lease !== undefined) { lease.check(); }
    const sequence = ++this.assertionSequence;
    const body = emissionAttachmentBody({ sequence, report, sanitize: (text) => this.display(text) });
    return this.attachAssertion(emissionAttachment, sequence, body, lease);
  }

  private display(text: string): { readonly text: string; readonly truncated: boolean } {
    const redacted = this.input.redact(text);
    return { text: reportText(redacted), truncated: redacted.length > reportTextLimit };
  }

  private async attachAssertion(name: string, sequence: number, body: string, lease: CaptureLease | undefined): Promise<void> {
    await this.input.testInfo.attach(name, { contentType: 'application/json', body });
    if (lease !== undefined) { lease.check(); }
    const digest = digestBytes(body);
    this.register({ kind: 'assertion-evidence', name, sequence,
      digest, bytes: Buffer.byteLength(body), ...assertionFields(body) });
    linkClaim(this.input.owner, digest);
  }
}
