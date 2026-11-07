import { expect, test, type EffectContractBuilder } from '@suites/blackbox-playwright';
import { effectsGolden } from '../support.js';

test.describe('controlled telemetry withholding', () => {
  test.use({ blackbox: { system: 'effects-withheld' } });
  test.afterEach(({ sandbox: _sandbox }, info) => {
    effectsGolden(info);
  });
  test('@withheld successful action stays inconclusive under positive and negated matchers', async ({
    step,
    effects,
    request,
    sandbox,
  }) => {
    const response = await step.stimulus(
      'insert while application telemetry is withheld',
      ({ headers }) =>
        request.post(new URL('/records/401', sandbox.entrypoint.url).href, {
          data: { value: 'executed-without-instrumentation' },
          headers,
        }),
    );
    expect(response.status()).toBe(201);

    const contract: EffectContractBuilder = (e) => [e.exists(e.db({}))];
    await expect(expect(effects).toSatisfy(contract)).rejects.toThrow(
      /inconclusive|No retained|activity-trace-not-received/,
    );
    await expect(expect(effects).not.toSatisfy(contract)).rejects.toThrow(
      /inconclusive|No retained|activity-trace-not-received/,
    );
    const database = (await effects.capture()).db({});
    await expect(expect(database).toHaveEmitted()).rejects.toThrow(/inconclusive/i);
    await expect(expect(database).not.toHaveEmitted()).rejects.toThrow(/inconclusive/i);
    await expect(expect(database).toHaveEmittedTimes(0)).rejects.toThrow(/inconclusive/i);
  });
});
