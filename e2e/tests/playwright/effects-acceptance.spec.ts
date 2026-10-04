import { setTimeout as delay } from 'node:timers/promises';

import { expect, test, type EffectContractBuilder } from '@suites/blackbox/playwright';

import { json, traceId } from './effects-acceptance.support.js';

test.system('effects-acceptance', (system) => {
  system.sandbox('real dependencies', (sandbox) => {
    sandbox.describe('candidate effects acceptance', () => {
      sandbox.test(
        'PostgreSQL INSERT is observed and persisted state is checked separately',
        async ({ activities, effects, request, sandbox }) => {
          const response = await activities.stimulus.request(
            'insert record 101',
            request,
            (scoped) =>
              scoped.post(new URL('/records/101', sandbox.entrypoint.url).href, {
                data: { value: 'persisted-101' },
              }),
          );
          expect(await json<{ row: { id: number; value: string } }>(response, 201)).toEqual({
            row: { id: 101, value: 'persisted-101' },
          });
          await expect(effects).toSatisfy((e) => [e.exists(e.db({ operation: 'INSERT' }))]);

          const inspection = await activities.inspection.request(
            'read record 101 independently',
            request,
            (scoped) => scoped.get(new URL('/records/101', sandbox.entrypoint.url).href),
          );
          expect(await json(inspection, 200)).toEqual({
            row: { id: 101, value: 'persisted-101' },
          });
        },
      );

      sandbox.test(
        'an observed forbidden INSERT produces a definite matcher failure',
        async ({ activities, effects, request, sandbox }) => {
          const response = await activities.stimulus.request(
            'insert forbidden record',
            request,
            (scoped) => scoped.post(new URL('/records/201', sandbox.entrypoint.url).href),
          );
          expect(response.status()).toBe(201);
          await expect(
            expect(effects).toSatisfy((e) => [e.absent(e.db({ operation: 'INSERT' }))]),
          ).rejects.toThrow(/Scope .*: fail[\s\S]*observed lower=1/);
        },
      );

      sandbox.test(
        'a rolled-back INSERT remains an observed operation while state is absent',
        async ({ activities, effects, request, sandbox }) => {
          const response = await activities.stimulus.request(
            'insert then roll back',
            request,
            (scoped) => scoped.post(new URL('/records/301/rollback', sandbox.entrypoint.url).href),
          );
          expect(await json(response, 200)).toEqual({ id: 301, rolledBack: true });
          await expect(effects).toSatisfy((e) => [e.exists(e.db({ operation: 'INSERT' }))]);

          const inspection = await activities.inspection.request(
            'read rolled-back record independently',
            request,
            (scoped) => scoped.get(new URL('/records/301', sandbox.entrypoint.url).href),
          );
          expect(await json(inspection, 200)).toEqual({ row: null });
        },
      );

      sandbox.test(
        'RabbitMQ send is observed and broker delivery is checked separately',
        async ({ activities, effects, request, sandbox }) => {
          const response = await activities.stimulus.request(
            'publish alpha message',
            request,
            (scoped) =>
              scoped.post(new URL('/publish/alpha', sandbox.entrypoint.url).href, {
                data: { value: 'rabbit-accepted' },
              }),
          );
          const published = await json<{
            brokerConfirmed: boolean;
            destination: string;
            messageId: string;
          }>(response, 202);
          expect(published).toMatchObject({
            brokerConfirmed: true,
            destination: 'acceptance.alpha',
          });
          await expect(effects).toSatisfy((e) => [
            e.exists(e.message({ operation: 'send', destination: 'acceptance.alpha' })),
          ]);

          const delivery = await activities.inspection.request(
            'read alpha delivery independently',
            request,
            async (scoped) => {
              const url = new URL(
                `/deliveries/${encodeURIComponent(published.messageId)}`,
                sandbox.entrypoint.url,
              ).href;
              for (let attempt = 0; attempt < 20; attempt += 1) {
                const candidate = await scoped.get(url);
                const body = (await candidate.json()) as { delivery: unknown };
                if (body.delivery) {
                  return body;
                }
                await delay(25);
              }
              return { delivery: null };
            },
          );
          expect(delivery).toEqual({
            delivery: {
              destination: 'acceptance.alpha',
              payload: { value: 'rabbit-accepted' },
            },
          });
        },
      );

      sandbox.test(
        'inspection SELECT cannot satisfy a stimulus SELECT contract',
        async ({ activities, effects, request, sandbox, telemetry }) => {
          let stimulusTrace = '';
          await activities.stimulus.run('publish without selecting', async ({ headers }) => {
            stimulusTrace = traceId(headers);
            const response = await request.post(
              new URL('/publish/alpha', sandbox.entrypoint.url).href,
              { headers },
            );
            expect(response.status()).toBe(202);
          });
          await expect(effects).toSatisfy((e) => [
            e.exists(e.message({ operation: 'send', destination: 'acceptance.alpha' })),
          ]);

          let inspectionTrace = '';
          await activities.inspection.run('select missing record', async ({ headers }) => {
            inspectionTrace = traceId(headers);
            const response = await request.get(
              new URL('/records/999', sandbox.entrypoint.url).href,
              { headers },
            );
            expect(await json(response, 200)).toEqual({ row: null });
          });
          await expect(
            expect(effects).toSatisfy((e) => [e.exists(e.db({ operation: 'SELECT' }))]),
          ).rejects.toThrow(/Scope .*: inconclusive/);
          expect(inspectionTrace).not.toBe(stimulusTrace);
          await expect(telemetry.readTrace(stimulusTrace)).resolves.toMatchObject({
            kind: 'collector-trace-found',
            traceId: stimulusTrace,
          });
          await expect(telemetry.readTrace(inspectionTrace)).resolves.toMatchObject({
            kind: 'collector-trace-found',
            traceId: inspectionTrace,
          });
        },
      );

      for (const own of ['alpha', 'beta'] as const) {
        const foreign = own === 'alpha' ? 'acceptance.beta' : 'acceptance.alpha';
        sandbox.test(
          `@isolation ${own} attempt cannot use the other destination`,
          async ({ activities, effects, request, sandbox, telemetry }) => {
            expect(effects.executionId).toBe(sandbox.executionId);
            expect(telemetry.executionId).toBe(sandbox.executionId);
            expect(effects.sessionId).toBe(telemetry.sessionId);
            expect(sandbox.sandboxId).toBeTruthy();
            expect(sandbox.projectName).toBeTruthy();
            const response = await activities.stimulus.request(
              `publish ${own}`,
              request,
              (scoped) => scoped.post(new URL(`/publish/${own}`, sandbox.entrypoint.url).href),
            );
            expect(response.status()).toBe(202);
            await expect(effects).toSatisfy((e) => [
              e.exists(e.message({ operation: 'send', destination: `acceptance.${own}` })),
            ]);
            await expect(
              expect(effects).toSatisfy((e) => [
                e.exists(e.message({ operation: 'send', destination: foreign })),
              ]),
            ).rejects.toThrow(/Scope .*: inconclusive/);
          },
        );
      }

      sandbox.test(
        'browser stimulus propagates ownership to a PostgreSQL INSERT',
        async ({ activities, effects, page, request, sandbox }) => {
          await activities.stimulus.browser(
            'insert record 501 in browser',
            page,
            async (scopedPage) => {
              await scopedPage.goto(new URL('/browser/records/501', sandbox.entrypoint.url).href);
              const inserted = scopedPage.waitForResponse(
                (response) =>
                  response.request().method() === 'POST' &&
                  new URL(response.url()).pathname === '/records/501',
              );
              await scopedPage.getByRole('button', { name: 'Insert record' }).click();
              expect((await inserted).status()).toBe(201);
              await expect(scopedPage.locator('#result')).toHaveText('inserted');
            },
          );
          await expect(effects).toSatisfy((e) => [e.exists(e.db({ operation: 'INSERT' }))]);
          const inspection = await activities.inspection.request(
            'read browser-created record independently',
            request,
            (scoped) => scoped.get(new URL('/records/501', sandbox.entrypoint.url).href),
          );
          expect(await json(inspection, 200)).toEqual({
            row: { id: 501, value: 'browser-501' },
          });
        },
      );

      sandbox.test(
        'plain browser work cannot satisfy a later stimulus contract',
        async ({ activities, effects, page, request, sandbox }) => {
          await page.goto(new URL('/browser/records/502', sandbox.entrypoint.url).href);
          const inserted = page.waitForResponse(
            (response) =>
              response.request().method() === 'POST' &&
              new URL(response.url()).pathname === '/records/502',
          );
          await page.getByRole('button', { name: 'Insert record' }).click();
          expect((await inserted).status()).toBe(201);
          await expect(page.locator('#result')).toHaveText('inserted');

          const response = await activities.stimulus.request(
            'publish after unscoped browser insert',
            request,
            (scoped) => scoped.post(new URL('/publish/beta', sandbox.entrypoint.url).href),
          );
          expect(response.status()).toBe(202);
          await expect(effects).toSatisfy((e) => [
            e.exists(e.message({ operation: 'send', destination: 'acceptance.beta' })),
          ]);
          await expect(
            expect(effects).toSatisfy((e) => [e.exists(e.db({ operation: 'INSERT' }))]),
          ).rejects.toThrow(/Scope .*: inconclusive/);
          const inspection = await activities.inspection.request(
            'read unscoped browser-created record independently',
            request,
            (scoped) => scoped.get(new URL('/records/502', sandbox.entrypoint.url).href),
          );
          expect(await json(inspection, 200)).toEqual({
            row: { id: 502, value: 'browser-502' },
          });
        },
      );
    });
  });
});

test.system('effects-withheld', (system) => {
  system.sandbox('controlled telemetry withholding', (sandbox) => {
    sandbox.test(
      '@withheld successful action stays inconclusive under positive and negated matchers',
      async ({ activities, effects, request, sandbox }) => {
        const response = await activities.stimulus.request(
          'insert while application telemetry is withheld',
          request,
          (scoped) =>
            scoped.post(new URL('/records/401', sandbox.entrypoint.url).href, {
              data: { value: 'executed-without-instrumentation' },
            }),
        );
        expect(response.status()).toBe(201);

        const contract: EffectContractBuilder = (e) => [e.exists(e.db({ operation: 'INSERT' }))];
        await expect(expect(effects).toSatisfy(contract)).rejects.toThrow(
          /inconclusive|No retained|activity-trace-not-received/,
        );
        await expect(expect(effects).not.toSatisfy(contract)).rejects.toThrow(
          /inconclusive|No retained|activity-trace-not-received/,
        );
      },
    );
  });
});
