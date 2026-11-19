import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { verifyReport } from './proof.mjs';

const execute = promisify(execFile);
const require = createRequire(new URL('../../packages/playwright/package.json', import.meta.url));
const titles = [
  'Given client "api" has sent POST "/fixture/reset" and received 200',
  'When client "api" sends POST "/business"',
  'Then the response status is 200',
  'And client "api" GET "/fixture/state" returns 200 with JSON exactly:',
];
const model = [
  {
    title: 'Scenario: Native business evidence',
    backgrounds: [{ steps: [titles[0]] }],
    steps: titles.slice(1),
  },
];

async function prepare(project) {
  await mkdir(join(project, 'node_modules/@playwright'), { recursive: true });
  await symlink(
    dirname(require.resolve('@playwright/test/package.json')),
    join(project, 'node_modules/@playwright/test'),
    'dir',
  );
  await writeFile(join(project, 'package.json'), '{"type":"module"}');
  await writeFile(
    join(project, 'playwright.config.mjs'),
    `export default {
    testDir: '.', testMatch: '*.spec.mjs', workers: 1, retries: 0,
    reporter: [[${JSON.stringify(fileURLToPath(new URL('./reporter.mjs', import.meta.url)))}, { outputFile: 'live.json' }], ['json', { outputFile: 'report.json' }]],
  };`,
  );
  await writeFile(
    join(project, 'business.spec.mjs'),
    `
import { test, expect } from '@playwright/test';
const titles = ${JSON.stringify(titles)};
const empty = process.env.EMPTY_BUSINESS === '1';
test.beforeEach(async ({ request }) => {
  await test.step(titles[0], async () => {
    if (empty) return;
    expect((await request.post(process.env.ENDPOINT + '/fixture/reset')).status()).toBe(200);
  });
});
test(${JSON.stringify(model[0].title)}, async ({ request }) => {
  const response = await test.step(titles[1], async () => {
    if (empty) return;
    return request.post(process.env.ENDPOINT + '/business');
  });
  await test.step(titles[2], () => { if (!empty) expect(response.status()).toBe(200); });
  await test.step(titles[3], async () => {
    if (empty) return;
    const state = await request.get(process.env.ENDPOINT + '/fixture/state');
    expect(state.status()).toBe(200);
    expect(await state.json()).toEqual({ items: [] });
  });
});`,
  );
}

async function run(project, endpoint, empty) {
  await execute(
    process.execPath,
    [require.resolve('@playwright/test/cli'), 'test', '--config', 'playwright.config.mjs'],
    {
      cwd: project,
      env: { ...process.env, ENDPOINT: endpoint, EMPTY_BUSINESS: empty ? '1' : '0' },
      timeout: 30_000,
    },
  );
  return {
    report: JSON.parse(await readFile(join(project, 'report.json'), 'utf8')),
    live: JSON.parse(await readFile(join(project, 'live.json'), 'utf8')),
  };
}

test('native reporter observes real requests and assertions and rejects passing empty business closures', async (context) => {
  const project = await mkdtemp(join(tmpdir(), 'feature-reporter-'));
  context.after(() => rm(project, { recursive: true, force: true }));
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    response.setHeader('content-type', 'application/json');
    response.end('{"items":[]}');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  context.after(
    () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  await prepare(project);
  const passing = await run(project, endpoint, false);
  assert.equal(verifyReport(passing.report, model, passing.live), 1);
  assert.deepEqual(requests, ['POST /fixture/reset', 'POST /business', 'GET /fixture/state']);
  const empty = await run(project, endpoint, true);
  assert.equal(empty.report.stats.expected, 1, 'Empty-closure control must still pass Playwright');
  assert.throws(() => verifyReport(empty.report, model, empty.live), /did not execute/u);
  assert.equal(
    requests.length,
    3,
    'Empty-closure control must not silently execute business requests',
  );
});
