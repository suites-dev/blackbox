import { hintProfileFor } from '../domain.js';

export interface FraudAuditWriter {
  record(input: {
    readonly userId: string;
    readonly decision: 'approved';
    readonly hintProfile: 'short' | 'long';
  }): Promise<void>;
}

export class FraudAssessmentService {
  readonly #audit: FraudAuditWriter;

  constructor(audit: FraudAuditWriter) {
    this.#audit = audit;
  }

  async assess(userId: string): Promise<Record<string, unknown>> {
    const hintProfile = hintProfileFor(userId);
    await this.#audit.record({ userId, decision: 'approved', hintProfile });
    return { decision: 'approved', hintProfile, userId };
  }
}
