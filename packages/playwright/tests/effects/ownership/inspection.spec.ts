import { expect, test } from '@suites/blackbox-playwright';
import { effectsGolden, json, traceId } from '../support.js';

test.system('effects-acceptance', (system) => {
  system.sandbox('real dependencies', (sandbox) => {
    sandbox.afterEach(({ sandbox: _sandbox }, info) => {
      effectsGolden(info);
    });
    sandbox.test(
      'inspection database activity cannot satisfy a stimulus database contract',
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
          e.exists(e.message({ destination: 'acceptance.alpha' })),
        ]);

        let inspectionTrace = '';
        await activities.inspection.run('select missing record', async ({ headers }) => {
          inspectionTrace = traceId(headers);
          const response = await request.get(new URL('/records/999', sandbox.entrypoint.url).href, {
            headers,
          });
          expect(await json(response, 200)).toEqual({ row: null });
        });
        await expect(expect(effects).toSatisfy((e) => [e.exists(e.db({}))])).rejects.toThrow(
          /Scope .*: inconclusive/,
        );
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
  });
});
