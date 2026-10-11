import { request as requestSdk } from '@playwright/test';
import { defineClient, expect, test } from '@suites/blackbox-playwright';
import { effectsGolden, json, traceId } from '../support.js';

const inspection = defineClient(requestSdk, {
  target: { participant: 'app', containerPort: 8080 },
  env: [] as const,
  create: (sdk, { endpoint }) => sdk.newContext({ baseURL: endpoint.url }),
  ready: async (client) => {
    expect((await client.get('/health')).ok()).toBe(true);
  },
  dispose: (client) => client.dispose(),
});

test.system('effects-acceptance', (system) => {
  system.sandbox('real dependencies', { clients: { inspection } }, (sandbox) => {
    sandbox.afterEach(({ sandbox: _sandbox }, info) => {
      effectsGolden(info);
    });
    sandbox.test(
      'inspection database activity cannot satisfy a stimulus database contract',
      async ({ step, effects, request, sandbox, telemetry, clients }) => {
        let stimulusTrace = '';
        await step.stimulus('publish without selecting', async ({ headers }) => {
          stimulusTrace = traceId(headers);
          const response = await request.post(
            new URL('/publish/alpha', sandbox.entrypoint.url).href,
            { headers },
          );
          expect(response.status()).toBe(202);
        });
        await expect(effects).toSatisfy((e) => [
          e.exists(e.message({ destination: 'acceptance.alpha' })),
        ]);

        await step('select missing record', async () => {
          const response = await clients.inspection.get('/records/999');
          expect(await json(response, 200)).toEqual({ row: null });
        });
        await expect(expect(effects).toSatisfy((e) => [e.exists(e.db({}))])).rejects.toThrow(
          /Scope .*: inconclusive/,
        );
        await expect(telemetry.readTrace(stimulusTrace)).resolves.toMatchObject({
          kind: 'collector-trace-found',
          traceId: stimulusTrace,
        });
      },
    );
  });
});
