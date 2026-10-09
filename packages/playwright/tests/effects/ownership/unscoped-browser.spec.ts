import { expect, test } from '@suites/blackbox-playwright';
import { effectsGolden, json } from '../support.js';

test.system('effects-acceptance', (system) => {
  system.sandbox('real dependencies', (sandbox) => {
    sandbox.afterEach(({ sandbox: _sandbox }, info) => {
      effectsGolden(info);
    });
    sandbox.test(
      'plain browser work cannot satisfy a later stimulus contract',
      async ({ activities, effects, page, request, sandbox }) => {
        await page.goto(new URL('/browser/records/502', sandbox.entrypoint.url).href);
        const inserted = page.waitForResponse(
          (response) =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname === '/records/502',
        );
        await page.getByRole('button', { name: 'Insert record' }).click();
        expect((await inserted).status()).toBe(201);
        await expect(page.locator('#result')).toHaveText('inserted');

        const response = await activities.stimulus.request(
          'publish after unscoped browser insert',
          request,
          (scoped) => scoped.post(new URL('/publish/beta', sandbox.entrypoint.url).href),
        );
        expect(response.status()).toBe(202);
        await expect(effects).toSatisfy((e) => [
          e.exists(e.message({ destination: 'acceptance.beta' })),
        ]);
        await expect(expect(effects).toSatisfy((e) => [e.exists(e.db({}))])).rejects.toThrow(
          /Scope .*: inconclusive/,
        );
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
  });
});
