import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from '@suites/blackbox-playwright';

import { blackboxEnvironment } from '../playwright/support.js';

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

test.system({ kind: 'subsystem', id: 'payment-mock' }, (system) => {
  system.sandbox('retention', { environment: blackboxEnvironment }, (sandbox) => {
    sandbox.test(
      'Scenario: finished attempts retain their real telemetry',
      async ({ request, sandbox, telemetry }, testInfo) => {
        const mode = requiredEnvironment('BLACKBOX_FEATURE_MODE');
        const traceId = randomBytes(16).toString('hex');
        const traceparent = `00-${traceId}-${randomBytes(8).toString('hex')}-01`;
        const retainedDirectory = join(
          process.cwd(),
          '.blackbox',
          'experiments',
          sandbox.sandboxId,
        );
        const receipt = {
          mode,
          sandboxId: sandbox.sandboxId,
          projectName: sandbox.projectName,
          executionId: sandbox.executionId,
          sessionId: telemetry.sessionId,
          artifactDirectory: sandbox.artifactDirectory,
          outputDirectory: testInfo.outputPath(),
          traceId,
          collisionSentinel: `owned-retention-collision:${sandbox.sandboxId}`,
        };
        await testInfo.attach('blackbox-feature-receipt:retention', {
          contentType: 'application/json',
          body: JSON.stringify(receipt, null, 2),
        });
        const response = await request.post(
          new URL('/v1/payment_intents', sandbox.entrypoint.url).href,
          {
            headers: { traceparent },
            data: { paymentMethodId: 'pm_retention', userId: 'retention' },
          },
        );
        expect(response.status()).toBe(201);
        expect(await response.json()).toMatchObject({ status: 'succeeded', userId: 'retention' });
        await expect
          .poll(async () => (await telemetry.readTrace(traceId)).kind, {
            timeout: 15_000,
          })
          .toBe('collector-trace-found');
        if (mode === 'write-failure') {
          // A portable real filesystem failure, including when CI runs as root.
          // The outer runner must observe fixture teardown failing after this body passes.
          await mkdir(retainedDirectory, { recursive: true });
          await writeFile(join(retainedDirectory, 'attempt.json'), receipt.collisionSentinel, {
            flag: 'wx',
          });
        }
      },
    );
  });
});
