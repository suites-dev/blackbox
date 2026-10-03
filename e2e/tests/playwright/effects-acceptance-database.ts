import { expect, type EffectContractBuilder } from '@suites/blackbox-playwright';

import { json, type EffectsSuite } from './effects-acceptance.support.js';

export function declareDatabaseCases(suite: EffectsSuite): void {
  suite.test(
    'PostgreSQL INSERT is observed and persisted state is checked separately',
    async ({ activities, effects, request, sandbox }) => {
      const response = await activities.stimulus.request('insert record 101', request, (scoped) =>
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

  suite.test(
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

  suite.test(
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
}

export function declareWithheldCase(suite: EffectsSuite): void {
  suite.test(
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
}
