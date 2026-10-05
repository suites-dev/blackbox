import { expect, test, type EffectContractBuilder } from '@suites/blackbox-playwright';
import { effectsGolden, json } from '../support.js';

test.system('effects-acceptance', (system) => {
  system.sandbox('real dependencies', (sandbox) => {
    sandbox.afterEach(({ sandbox: _sandbox }, info) => {
      effectsGolden(info);
    });
    sandbox.test(
      'PostgreSQL activity is observed while its operation remains unknown',
      async ({ activities, effects, request, sandbox }) => {
        const response = await activities.stimulus.request('insert record 101', request, (scoped) =>
          scoped.post(new URL('/records/101', sandbox.entrypoint.url).href, {
            data: { value: 'persisted-101' },
          }),
        );
        expect(await json<{ row: { id: number; value: string } }>(response, 201)).toEqual({
          row: { id: 101, value: 'persisted-101' },
        });
        await expect(effects).toSatisfy((e) => [e.exists(e.db({}))]);
        const insertion: EffectContractBuilder = (e) => [e.exists(e.db({ operation: 'INSERT' }))];
        await expect(expect(effects).toSatisfy(insertion)).rejects.toThrow(
          /Scope .*: inconclusive/,
        );
        await expect(expect(effects).not.toSatisfy(insertion)).rejects.toThrow(
          /Scope .*: inconclusive/,
        );

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
      'forbidden database activity produces a definite matcher failure',
      async ({ activities, effects, request, sandbox }) => {
        const response = await activities.stimulus.request(
          'insert forbidden record',
          request,
          (scoped) => scoped.post(new URL('/records/201', sandbox.entrypoint.url).href),
        );
        expect(response.status()).toBe(201);
        await expect(expect(effects).toSatisfy((e) => [e.absent(e.db({}))])).rejects.toThrow(
          /Scope .*: fail[\s\S]*observed lower=[1-9]/,
        );
      },
    );
  });
});
