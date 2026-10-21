import type { TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { relative } from 'node:path';

import { behaviorIdentity } from '../envelope/behavior.js';
import type { Digest } from '../envelope/canonical.js';
import { ReceiptRecorder } from '../history/recorder.js';
import type { AttemptReceipt } from '../history/receipt.js';
import { invocationId } from './invocation.js';

export const receiptAttachment = 'blackbox-receipt';

export function startReceipt(testInfo: TestInfo, catalogEntryId: string): ReceiptRecorder {
  return new ReceiptRecorder({
    receiptId: randomUUID(),
    retry: testInfo.retry,
    retries: testInfo.project.retries,
    workerIndex: testInfo.workerIndex,
    parallelIndex: testInfo.parallelIndex,
    test: {
      runnerTestId: testInfo.testId,
      file: relative(testInfo.project.testDir, testInfo.file),
      titlePath: testInfo.titlePath.slice(1),
      project: testInfo.project.name,
    },
    catalogEntryId,
    invocation: invocationId(),
  });
}

/** Builds the receipt from what the recorder saw and what the test finally reported, and attaches it. */
export async function attachReceipt(input: {
  readonly testInfo: TestInfo;
  readonly recorder: ReceiptRecorder;
  readonly catalogEntryId: string;
  readonly envelope: Digest | null;
}): Promise<AttemptReceipt> {
  const { testInfo } = input;
  const receipt = input.recorder.build({
    behavior: behaviorIdentity({
      annotations: testInfo.annotations.map(({ type, description }) => ({
        type,
        description: description ?? '',
      })),
      catalogEntryId: input.catalogEntryId,
      project: testInfo.project.name,
      titlePath: testInfo.titlePath.slice(1),
    }),
    outcome: {
      testStatus: testInfo.status ?? 'unknown',
      expectedStatus: testInfo.expectedStatus,
      errorCount: testInfo.errors.length,
    },
    interrupted: testInfo.status === 'interrupted',
    envelope: input.envelope,
  });
  await testInfo.attach(receiptAttachment, {
    contentType: 'application/json',
    body: JSON.stringify(receipt),
  });
  return receipt;
}
