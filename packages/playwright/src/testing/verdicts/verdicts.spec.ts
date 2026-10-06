import { access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { expect } from '@playwright/test';

import { createBlackboxTest } from '../../fixtures.js';
import { systemSandboxRuntime } from '../system-sandbox/runtime.fixture.js';

// The spike B2 cases: Playwright counts each of these as ok, Blackbox must not.
const test = createBlackboxTest(systemSandboxRuntime);
test.use({ catalogEntry: { kind: 'system', id: 'orders' } });

const requirements = (...ids: string[]) => ({
  annotation: ids.map((description) => ({ type: 'requirement', description })),
});

test('plain pass', requirements('REQ-100', 'REQ-102'), ({ sandbox }) => {
  expect(sandbox.catalogEntry.id).toBe('orders');
});

test('flaky retry', requirements('REQ-200'), ({ sandbox }, info) => {
  expect(sandbox.catalogEntry.id).toBe('orders');
  expect(info.retry, 'the first physical attempt fails on purpose').toBeGreaterThan(0);
});

test('expected to fail', requirements('REQ-300'), () => {
  test.fail();
  throw new Error('an inconclusive claim inverted into a pass');
});

test('skipped', () => {
  test.skip(true, 'a skipped scenario is not evidence');
});

test.describe('max failures', () => {
  test.describe.configure({ retries: 0 });

  test('fails fast', async () => {
    await expect.poll(() => started(), { timeout: 10_000 }).toBe(true);
    throw new Error('stop the run');
  });

  test('interrupted while running', async () => {
    await writeFile(marker(), 'started');
    await delay(15_000);
  });
});

const marker = () => join(process.cwd(), 'interruptible-started');

async function started(): Promise<boolean> {
  try {
    await access(marker());
    return true;
  } catch {
    return false;
  }
}
