import type { TestInfo } from '@playwright/test';
import { assertionScope, AssertionScopeError } from '@suites/blackbox-playwright';

export function endpoint(path: string): string {
  const base = process.env.BLACKBOX_ASSERTION_ENDPOINT;
  if (base === undefined) {
    throw new Error('BLACKBOX_ASSERTION_ENDPOINT is required');
  }
  const url = new URL(path, base);
  if (url.hostname !== '127.0.0.1') {
    throw new Error('Assertion fixture must use loopback');
  }
  return url.href;
}

/** Preserve the public result/error rather than infer accounting from reporter counts. */
export async function captured<T>(label: string, info: TestInfo, body: () => T | Promise<T>) {
  const owner = {
    testId: info.testId,
    retry: info.retry,
    workerIndex: info.workerIndex,
    parallelIndex: info.parallelIndex,
  };
  try {
    const result = await assertionScope(body);
    await info.attach(`assertion-accounting:${label}`, {
      contentType: 'application/json',
      body: JSON.stringify({ label, owner, kind: 'resolved', ...result }),
    });
    return result;
  } catch (error) {
    if (error instanceof AssertionScopeError) {
      await info.attach(`assertion-accounting:${label}`, {
        contentType: 'application/json',
        body: JSON.stringify({
          label,
          owner,
          kind: 'rejected',
          code: error.code,
          message: error.message,
          accounting: error.accounting,
        }),
      });
    }
    throw error;
  }
}
