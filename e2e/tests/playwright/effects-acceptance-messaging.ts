import { setTimeout as delay } from 'node:timers/promises';

import { expect } from '@suites/blackbox-playwright';

import { json, traceId, type EffectsSuite } from './effects-acceptance.support.js';

function declareRabbitCase(suite: EffectsSuite): void {
  suite.test(
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
}

function declareInspectionCase(suite: EffectsSuite): void {
  suite.test(
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
        const response = await request.get(new URL('/records/999', sandbox.entrypoint.url).href, {
          headers,
        });
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
}

function declareIsolationCases(suite: EffectsSuite): void {
  for (const own of ['alpha', 'beta'] as const) {
    const foreign = own === 'alpha' ? 'acceptance.beta' : 'acceptance.alpha';
    suite.test(
      `@isolation ${own} attempt cannot use the other destination`,
      async ({ activities, effects, request, sandbox, telemetry }) => {
        expect(effects.executionId).toBe(sandbox.executionId);
        expect(telemetry.executionId).toBe(sandbox.executionId);
        expect(effects.sessionId).toBe(telemetry.sessionId);
        expect(sandbox.sandboxId).toBeTruthy();
        expect(sandbox.projectName).toBeTruthy();
        const response = await activities.stimulus.request(`publish ${own}`, request, (scoped) =>
          scoped.post(new URL(`/publish/${own}`, sandbox.entrypoint.url).href),
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
}

export function declareMessagingCases(suite: EffectsSuite): void {
  declareRabbitCase(suite);
  declareInspectionCase(suite);
  declareIsolationCases(suite);
}
