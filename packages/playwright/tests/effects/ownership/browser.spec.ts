import { expect, test } from '@suites/blackbox-playwright';
import { effectsGolden, json } from '../support.js';

test.system('effects-acceptance', (system) => {
  system.sandbox('real dependencies', (sandbox) => {
    sandbox.afterEach(({ sandbox: _sandbox }, info) => {
      effectsGolden(info);
    });
    sandbox.test(
      'browser stimulus propagates ownership to PostgreSQL activity',
      async ({ activities, effects, page, request, sandbox }) => {
        await activities.stimulus.browser(
          'insert record 501 in browser',
          page,
          async (scopedPage) => {
            await scopedPage.goto(new URL('/browser/records/501', sandbox.entrypoint.url).href);
            const inserted = scopedPage.waitForResponse(
              (response) =>
                response.request().method() === 'POST' &&
                new URL(response.url()).pathname === '/records/501',
            );
            await scopedPage.getByRole('button', { name: 'Insert record' }).click();
            expect((await inserted).status()).toBe(201);
            await expect(scopedPage.locator('#result')).toHaveText('inserted');
          },
        );
        await expect(effects).toSatisfy((e) => [e.exists(e.db({}))]);
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
  });
});
