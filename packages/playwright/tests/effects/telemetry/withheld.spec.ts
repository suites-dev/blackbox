import { expect, test, type EffectContractBuilder } from '@suites/blackbox-playwright';
import { effectsGolden } from '../support.js';

test.system('effects-withheld', (system) => {
  system.sandbox('controlled telemetry withholding', (sandbox) => {
    sandbox.afterEach(({ sandbox: _sandbox }, info) => {
      effectsGolden(info);
    });
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

        const contract: EffectContractBuilder = (e) => [e.exists(e.db({}))];
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
