import type { Pool, PoolClient } from 'pg';

import { seedUsers } from '../domain.js';
import type { CreatedSubscription, UserRecord } from './subscriptions.js';

export interface SubscriptionRow extends CreatedSubscription {
  readonly userId: string;
  readonly tier: string;
  readonly paymentIntentId: string | null;
  readonly orderId: string | null;
}

export interface FraudAuditRow {
  readonly id: string;
  readonly userId: string;
  readonly decision: string;
  readonly hintProfile: string;
}

export class DatabaseRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async ready(): Promise<void> {
    await this.#pool.query('SELECT 1');
  }

  async findUser(userId: string): Promise<UserRecord | null> {
    const result = await this.#pool.query<UserRecord>(
      'SELECT u.user_id AS "userId", u.tier, u.execution_path AS "executionPath", EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.user_id) AS "hasSubscription" FROM users u WHERE u.user_id = $1',
      [userId],
    );
    return result.rows[0] ?? null;
  }

  async insertSubscription(input: {
    readonly id: string;
    readonly userId: string;
    readonly tier: string;
    readonly paymentIntentId: string | null;
    readonly orderId: string | null;
  }): Promise<CreatedSubscription> {
    const result = await this.#pool.query<CreatedSubscription>(
      'INSERT INTO subscriptions (id, user_id, tier, status, payment_intent_id, order_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, status',
      [input.id, input.userId, input.tier, 'active', input.paymentIntentId, input.orderId],
    );
    const row = result.rows.at(0);
    if (row === undefined) {
      throw new Error('subscription insert returned no row');
    }
    return row;
  }

  async reset(): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('TRUNCATE subscriptions, fraud_audit RESTART IDENTITY');
      await client.query('DELETE FROM users');
      await seedDatabaseUsers(client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async inspect(): Promise<{
    readonly subscriptions: readonly SubscriptionRow[];
    readonly fraudAudit: readonly FraudAuditRow[];
  }> {
    const subscriptions = await this.#pool.query<SubscriptionRow>(
      'SELECT id, user_id AS "userId", tier, status, payment_intent_id AS "paymentIntentId", order_id AS "orderId" FROM subscriptions ORDER BY user_id',
    );
    const fraudAudit = await this.#pool.query<FraudAuditRow>(
      'SELECT id::text, user_id AS "userId", decision, hint_profile AS "hintProfile" FROM fraud_audit ORDER BY id',
    );
    return { subscriptions: subscriptions.rows, fraudAudit: fraudAudit.rows };
  }
}

async function seedDatabaseUsers(client: PoolClient): Promise<void> {
  for (const user of seedUsers) {
    await client.query('INSERT INTO users (user_id, tier, execution_path) VALUES ($1, $2, $3)', [
      user.userId,
      user.tier,
      user.executionPath,
    ]);
  }
}
