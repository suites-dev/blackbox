import {
  CreateQueueCommand,
  DeleteMessageBatchCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { setTimeout as delay } from 'node:timers/promises';

import { requiredEnvironment } from './config.js';

export interface QueueMessage {
  readonly body: string;
  readonly receiptHandle: string;
}

export interface QueueCounts {
  readonly delayed: number;
  readonly inFlight: number;
  readonly visible: number;
}

export interface QueueDeleteEntry {
  readonly id: string;
  readonly receiptHandle: string;
}

export interface QueueDeleteFailure {
  readonly code: string;
  readonly id: string;
}

export interface QueueCleanupPort {
  receive(): Promise<readonly QueueMessage[]>;
  deleteBatch(entries: readonly QueueDeleteEntry[]): Promise<readonly QueueDeleteFailure[]>;
  counts(): Promise<QueueCounts>;
}

export interface QueueCleanupClock {
  now(): number;
  sleep(milliseconds: number): Promise<void>;
}

export class QueueCleanupError extends Error {
  readonly code:
    | 'queue-delete-failed'
    | 'queue-message-invalid'
    | 'queue-not-empty-before-deadline';

  constructor(code: QueueCleanupError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

export function createQueueClient(): SQSClient {
  return new SQSClient({
    endpoint: requiredEnvironment('SQS_ENDPOINT'),
    region: process.env.AWS_REGION ?? 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
    },
  });
}

export async function ensureQueue(client: SQSClient): Promise<string> {
  const queueName = process.env.SQS_QUEUE_NAME ?? 'subscription-orders';
  try {
    const result = await client.send(new GetQueueUrlCommand({ QueueName: queueName }));
    if (result.QueueUrl !== undefined) {
      return result.QueueUrl;
    }
  } catch {
    // Creation is idempotent for an existing queue with the same attributes.
  }
  const created = await client.send(new CreateQueueCommand({ QueueName: queueName }));
  if (created.QueueUrl === undefined) {
    throw new Error(`queue ${queueName} has no URL`);
  }
  return created.QueueUrl;
}

export async function queueCounts(client: SQSClient, queueUrl: string): Promise<QueueCounts> {
  const result = await client.send(
    new GetQueueAttributesCommand({
      QueueUrl: queueUrl,
      AttributeNames: [
        'ApproximateNumberOfMessages',
        'ApproximateNumberOfMessagesNotVisible',
        'ApproximateNumberOfMessagesDelayed',
      ],
    }),
  );
  const attributes = result.Attributes ?? {};
  return {
    delayed: parseCount(attributes.ApproximateNumberOfMessagesDelayed),
    inFlight: parseCount(attributes.ApproximateNumberOfMessagesNotVisible),
    visible: parseCount(attributes.ApproximateNumberOfMessages),
  };
}

export async function queueDepth(client: SQSClient, queueUrl: string): Promise<number> {
  return countTotal(await queueCounts(client, queueUrl));
}

export async function drainQueue(
  client: SQSClient,
  queueUrl: string,
): Promise<readonly Record<string, unknown>[]> {
  return drainQueueWithPort(createSqsCleanupPort(client, queueUrl), {
    clock: { now: Date.now, sleep: delay },
    deadlineMs: 10_000,
    pollIntervalMs: 50,
    stableEmptyMs: 300,
  });
}

export async function drainQueueWithPort(
  port: QueueCleanupPort,
  options: {
    readonly clock: QueueCleanupClock;
    readonly deadlineMs: number;
    readonly pollIntervalMs: number;
    readonly stableEmptyMs: number;
  },
): Promise<readonly Record<string, unknown>[]> {
  const startedAt = options.clock.now();
  let emptySince: number | undefined;
  const messages: Record<string, unknown>[] = [];

  for (;;) {
    if (options.clock.now() - startedAt >= options.deadlineMs) {
      throw new QueueCleanupError(
        'queue-not-empty-before-deadline',
        'queue did not remain empty before the cleanup deadline',
      );
    }

    const received = await port.receive();
    if (received.length > 0) {
      emptySince = undefined;
      const entries = received.map((message, index) => ({
        id: `message-${String(index)}`,
        receiptHandle: message.receiptHandle,
      }));
      for (const message of received) {
        messages.push(parseMessage(message.body));
      }
      const failures = await port.deleteBatch(entries);
      if (failures.length > 0) {
        throw new QueueCleanupError(
          'queue-delete-failed',
          `queue batch deletion failed: ${failures.map(({ id, code }) => `${id}:${code}`).join(',')}`,
        );
      }
      continue;
    }

    const counts = await port.counts();
    if (countTotal(counts) === 0) {
      emptySince ??= options.clock.now();
      if (options.clock.now() - emptySince >= options.stableEmptyMs) {
        return messages.sort((left, right) =>
          String(left.userId).localeCompare(String(right.userId)),
        );
      }
    } else {
      emptySince = undefined;
    }
    await options.clock.sleep(options.pollIntervalMs);
  }
}

function createSqsCleanupPort(client: SQSClient, queueUrl: string): QueueCleanupPort {
  return {
    counts: () => queueCounts(client, queueUrl),
    async deleteBatch(entries) {
      const result = await client.send(
        new DeleteMessageBatchCommand({
          QueueUrl: queueUrl,
          Entries: entries.map(({ id, receiptHandle }) => ({
            Id: id,
            ReceiptHandle: receiptHandle,
          })),
        }),
      );
      return (result.Failed ?? []).map((failure) => ({
        code: failure.Code ?? 'unknown',
        id: failure.Id ?? 'unknown',
      }));
    },
    async receive() {
      const result = await client.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 10,
          VisibilityTimeout: 1,
          WaitTimeSeconds: 0,
        }),
      );
      return (result.Messages ?? []).map((message) => {
        if (message.Body === undefined || message.ReceiptHandle === undefined) {
          throw new QueueCleanupError(
            'queue-message-invalid',
            'received queue message is missing its body or receipt handle',
          );
        }
        return { body: message.Body, receiptHandle: message.ReceiptHandle };
      });
    },
  };
}

function parseMessage(body: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new QueueCleanupError('queue-message-invalid', 'queue message body is not valid JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new QueueCleanupError('queue-message-invalid', 'queue message body is not a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function parseCount(value: string | undefined): number {
  const parsed = Number(value ?? '0');
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new QueueCleanupError('queue-message-invalid', 'queue returned an invalid message count');
  }
  return parsed;
}

function countTotal(counts: QueueCounts): number {
  return counts.visible + counts.inFlight + counts.delayed;
}
