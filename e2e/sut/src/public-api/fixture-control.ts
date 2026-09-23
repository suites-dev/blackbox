import type { SQSClient } from '@aws-sdk/client-sqs';

import { drainQueue, queueDepth } from '../lib/queue.js';
import type { DatabaseRepository } from './database-repository.js';
import type { DownstreamClients } from './downstream-clients.js';
import type { RedisRepository } from './redis-repository.js';

export type ResetProfile = 'fresh' | 'comparison-absent' | 'comparison-returning';

export class FixtureControl {
  readonly #database: DatabaseRepository;
  readonly #redis: RedisRepository;
  readonly #queue: SQSClient;
  readonly #queueUrl: string;
  readonly #downstream: DownstreamClients;

  constructor(input: {
    readonly database: DatabaseRepository;
    readonly redis: RedisRepository;
    readonly queue: SQSClient;
    readonly queueUrl: string;
    readonly downstream: DownstreamClients;
  }) {
    this.#database = input.database;
    this.#redis = input.redis;
    this.#queue = input.queue;
    this.#queueUrl = input.queueUrl;
    this.#downstream = input.downstream;
  }

  async reset(profile: ResetProfile): Promise<void> {
    await this.#database.reset();
    await this.#redis.reset(profile);
    await drainQueue(this.#queue, this.#queueUrl);
    await this.#downstream.resetPayment();
  }

  async inspect(): Promise<Record<string, unknown>> {
    const [database, redis, payment, depth] = await Promise.all([
      this.#database.inspect(),
      this.#redis.inspect(),
      this.#downstream.inspectPayment(),
      queueDepth(this.#queue, this.#queueUrl),
    ]);
    return {
      fraudAudit: database.fraudAudit,
      payment,
      queueDepth: depth,
      redis,
      subscriptions: database.subscriptions,
    };
  }

  drain(): Promise<readonly Record<string, unknown>[]> {
    return drainQueue(this.#queue, this.#queueUrl);
  }
}
