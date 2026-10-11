import { expect, test } from '@suites/blackbox-playwright';

import { effectsGolden } from './golden.js';
import * as clients from './state-clients.js';

test.system('effects-acceptance', (system) => {
  system.sandbox('automatic actions and current state', { clients }, (suite) => {
    suite.afterEach(({ sandbox: _sandbox }, info) => {
      effectsGolden(info);
    });
    suite.test(
      'automatic requests observe effects while SDK clients inspect evolving current state',
      async ({ request, clients, effects }) => {
        expect(await clients.redis.get('current-value')).toBeNull();
        expect(
          (await clients.postgres.query('SELECT id, value FROM acceptance_records ORDER BY id'))
            .rows,
        ).toEqual([]);

        const first = await test.step('write the first value', () =>
          request.post('/state-actions', {
            data: { value: 'first' },
          }));
        expect(first.status()).toBe(201);
        expect(await first.json()).toEqual({ row: { id: 501, value: 'first' } });
        await expect(effects).toSatisfy((e) => [
          e.exists(e.http({ actor: 'app', method: 'POST' })),
          e.exists(e.db({ actor: 'app' })),
          e.exists(e.cache({ actor: 'app', operation: 'SET' })),
        ]);
        expect(await clients.redis.get('current-value')).toBe('first');
        expect(
          (await clients.postgres.query('SELECT id, value FROM acceptance_records ORDER BY id'))
            .rows,
        ).toEqual([{ id: 501, value: 'first' }]);

        const second = await test.step('replace the current value', () =>
          request.patch('/state-actions', {
            data: { value: 'second' },
          }));
        expect(second.status()).toBe(200);
        expect(await second.json()).toEqual({ row: { id: 501, value: 'second' } });
        await expect(effects).toSatisfy((e) => [
          e.exists(e.http({ actor: 'app', method: 'POST' })),
          e.exists(e.http({ actor: 'app', method: 'PATCH' })),
          e.exists(e.db({ actor: 'app' })),
          e.exists(e.cache({ actor: 'app', operation: 'SET' })),
        ]);
        expect(await clients.redis.get('current-value')).toBe('second');
        expect(
          (await clients.postgres.query('SELECT id, value FROM acceptance_records ORDER BY id'))
            .rows,
        ).toEqual([{ id: 501, value: 'second' }]);

        for (let action = 3; action <= 9; action++) {
          const value = `value-${action}`;
          const response = await test.step(`write value ${action}`, () =>
            request.patch('/state-actions', { data: { value } }));
          expect(response.status()).toBe(200);
          expect(await response.json()).toEqual({ row: { id: 501, value } });
          expect(await clients.redis.get('current-value')).toBe(value);
          expect(
            (await clients.postgres.query('SELECT id, value FROM acceptance_records ORDER BY id'))
              .rows,
          ).toEqual([{ id: 501, value }]);
        }
        await expect(effects).toSatisfy((e) => [
          e.exists(e.http({ actor: 'app', method: 'POST' })),
          e.atLeast(8, e.http({ actor: 'app', method: 'PATCH' })),
          e.atLeast(9, e.db({ actor: 'app' })),
          e.atLeast(9, e.cache({ actor: 'app', operation: 'SET' })),
        ]);
      },
    );
  });
});
