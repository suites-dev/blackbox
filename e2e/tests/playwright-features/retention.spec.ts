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
      async ({ request, sandbox, telemetry, effects, step }, testInfo) => {
        const mode = requiredEnvironment('BLACKBOX_FEATURE_MODE');
        const { response, traceId } = await step.stimulus(
          'create a payment intent with a retained trace',
          async ({ headers }) => ({
            response: await request.post('/v1/payment_intents', {
              headers,
              data: { paymentMethodId: 'pm_retention', userId: 'retention' },
            }),
            traceId: headers.traceparent.split('-')[1],
          }),
        );
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
        expect(response.status()).toBe(201);
        expect(await response.json()).toMatchObject({ status: 'succeeded', userId: 'retention' });
        await expect
          .poll(async () => (await telemetry.readTrace(traceId)).kind, {
            timeout: 15_000,
          })
          .toBe('collector-trace-found');
        await expect(effects).toSatisfy((e) => [
          e.exists(e.http({ actor: 'payment-mock', method: 'POST' })),
        ]);
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
