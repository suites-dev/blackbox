import { expect, test } from '@suites/blackbox-playwright';
import { effectsGolden } from '../support.js';

test.system('effects-acceptance', (system) => {
  system.sandbox('real dependencies', (sandbox) => {
    sandbox.afterEach(({ sandbox: _sandbox }, info) => {
      effectsGolden(info);
    });
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
          const response = await activities.stimulus.request(`publish ${own}`, request, (scoped) =>
            scoped.post(new URL(`/publish/${own}`, sandbox.entrypoint.url).href),
          );
          expect(response.status()).toBe(202);
          await expect(effects).toSatisfy((e) => [
            e.exists(e.message({ destination: `acceptance.${own}` })),
          ]);
          await expect(
            expect(effects).toSatisfy((e) => [e.exists(e.message({ destination: foreign }))]),
          ).rejects.toThrow(/Scope .*: inconclusive/);
        },
      );
    }
  });
});
