import { expect, test } from '@suites/blackbox-playwright';
import { effectsGolden, json } from '../support.js';

test.system('effects-acceptance', (system) => {
  system.sandbox('real dependencies', (sandbox) => {
    sandbox.afterEach(({ sandbox: _sandbox }, info) => {
      effectsGolden(info);
    });
    sandbox.test(
      'database activity remains observable after rollback while state is absent',
      async ({ activities, effects, request, sandbox }) => {
        const response = await activities.stimulus.request(
          'insert then roll back',
          request,
          (scoped) => scoped.post(new URL('/records/301/rollback', sandbox.entrypoint.url).href),
        );
        expect(await json(response, 200)).toEqual({ id: 301, rolledBack: true });
        await expect(effects).toSatisfy((e) => [e.exists(e.db({}))]);

        const inspection = await activities.inspection.request(
          'read rolled-back record independently',
          request,
          (scoped) => scoped.get(new URL('/records/301', sandbox.entrypoint.url).href),
        );
        expect(await json(inspection, 200)).toEqual({ row: null });
      },
    );
  });
});
