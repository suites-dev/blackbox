import type { Pool } from 'pg';

import type { FraudAuditWriter } from './assessment.js';

export class FraudAuditRepository implements FraudAuditWriter {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async ready(): Promise<void> {
    await this.#pool.query('SELECT 1');
  }

  async record(input: {
    readonly userId: string;
    readonly decision: 'approved';
    readonly hintProfile: 'short' | 'long';
  }): Promise<void> {
    await this.#pool.query(
      'INSERT INTO fraud_audit (user_id, decision, hint_profile) VALUES ($1, $2, $3)',
      [input.userId, input.decision, input.hintProfile],
    );
  }
}
