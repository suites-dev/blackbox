import { expect, test } from '@suites/blackbox-playwright';
import { effectsGolden, json, traceId } from '../support.js';

test.describe('real dependencies', () => {
  test.use({ blackbox: { system: 'effects-acceptance' } });
  test.afterEach(({ sandbox: _sandbox }, info) => {
    effectsGolden(info);
  });
  test('inspection database activity cannot satisfy a stimulus database contract', async ({
    step,
    effects,
    request,
    sandbox,
    telemetry,
  }) => {
    let stimulusTrace = '';
    await step.stimulus('publish without selecting', async ({ headers }) => {
      stimulusTrace = traceId(headers);
      const response = await request.post(new URL('/publish/alpha', sandbox.entrypoint.url).href, {
        headers,
      });
      expect(response.status()).toBe(202);
    });
    await expect(effects).toSatisfy((e) => [
      e.exists(e.message({ destination: 'acceptance.alpha' })),
    ]);

    await step('select missing record', async () => {
      const response = await request.get(new URL('/records/999', sandbox.entrypoint.url).href);
      expect(await json(response, 200)).toEqual({ row: null });
    });
    await expect(expect(effects).toSatisfy((e) => [e.exists(e.db({}))])).rejects.toThrow(
      /Scope .*: inconclusive/,
    );
    const captured = await effects.capture();
    await expect(captured.message({ destination: 'acceptance.alpha' })).toHaveEmitted();
    await expect(expect(captured.db({})).toHaveEmitted()).rejects.toThrow(/inconclusive/i);
    await expect(expect(captured.db({})).not.toHaveEmitted()).rejects.toThrow(/inconclusive/i);
    await expect(telemetry.readTrace(stimulusTrace)).resolves.toMatchObject({
      kind: 'collector-trace-found',
      traceId: stimulusTrace,
    });
  });
});
