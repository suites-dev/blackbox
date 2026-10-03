import { expect } from '@suites/blackbox-playwright';

import { insertFromBrowser, json, type EffectsSuite } from './effects-acceptance.support.js';

export function declareBrowserCases(suite: EffectsSuite): void {
  suite.test(
    'browser stimulus propagates ownership to a PostgreSQL INSERT',
    async ({ activities, effects, page, request, sandbox }) => {
      await activities.stimulus.browser('insert record 501 in browser', page, (scopedPage) =>
        insertFromBrowser(scopedPage, sandbox.entrypoint.url, 501),
      );
      await expect(effects).toSatisfy((e) => [e.exists(e.db({ operation: 'INSERT' }))]);
      const inspection = await activities.inspection.request(
        'read browser-created record independently',
        request,
        (scoped) => scoped.get(new URL('/records/501', sandbox.entrypoint.url).href),
      );
      expect(await json(inspection, 200)).toEqual({
        row: { id: 501, value: 'browser-501' },
      });
    },
  );

  suite.test(
    'plain browser work cannot satisfy a later stimulus contract',
    async ({ activities, effects, page, request, sandbox }) => {
      await insertFromBrowser(page, sandbox.entrypoint.url, 502);
      const response = await activities.stimulus.request(
        'publish after unscoped browser insert',
        request,
        (scoped) => scoped.post(new URL('/publish/beta', sandbox.entrypoint.url).href),
      );
      expect(response.status()).toBe(202);
      await expect(effects).toSatisfy((e) => [
        e.exists(e.message({ operation: 'send', destination: 'acceptance.beta' })),
      ]);
      await expect(
        expect(effects).toSatisfy((e) => [e.exists(e.db({ operation: 'INSERT' }))]),
      ).rejects.toThrow(/Scope .*: inconclusive/);
      const inspection = await activities.inspection.request(
        'read unscoped browser-created record independently',
        request,
        (scoped) => scoped.get(new URL('/records/502', sandbox.entrypoint.url).href),
      );
      expect(await json(inspection, 200)).toEqual({
        row: { id: 502, value: 'browser-502' },
      });
    },
  );
}
