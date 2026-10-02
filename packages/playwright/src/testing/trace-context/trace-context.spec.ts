import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';

import { expect as playwrightExpect } from '@playwright/test';

import { createBlackboxTest } from '../../fixtures.js';
import type { BlackboxAttemptRuntime } from '../../runtime/acquisition.js';

// Stands in for the sandbox entrypoint and records what each request carried.
const received: IncomingHttpHeaders[] = [];
const server = createServer((request, response) => {
  received.push(request.headers);
  response.end('ok');
});
const listening = new Promise<number>((resolve) => {
  server.listen(0, '127.0.0.1', () => {
    resolve((server.address() as AddressInfo).port);
  });
});

const runtime = {
  async start(input) {
    if (input.selection.kind === 'unselected') {
      throw new Error('test fixture did not select a catalog entry');
    }
    const port = await listening;
    return {
      sandbox: {
        sandboxId: 'trace-sandbox',
        executionId: 'trace-execution',
        catalogEntry: { id: input.selection.id, kind: input.selection.kind },
        projectName: 'trace-project',
        artifactDirectory: input.artifactDirectory,
        entrypoint: { url: `http://127.0.0.1:${port}`, host: '127.0.0.1', port, protocol: 'http' },
        containers: new Map(),
      },
      telemetry: {
        sessionId: 'trace-session',
        executionId: 'trace-execution',
        inspect: () => Promise.resolve({ kind: 'disabled' as const }),
        read: () => Promise.reject(new Error('not used by this fixture')),
        readTrace: () => Promise.reject(new Error('not used by this fixture')),
      },
      effects: { sessionId: 'trace-session', executionId: 'trace-execution' },
      runActivity: () => Promise.reject(new Error('not used by this fixture')),
      stop: () => Promise.resolve(),
    };
  },
} satisfies BlackboxAttemptRuntime;

const test = createBlackboxTest(runtime);

test.use({ catalogEntry: { kind: 'system', id: 'orders' } });

test.afterAll(() => {
  server.close();
});

test.beforeAll(async ({ request }) => {
  await request.get(`http://127.0.0.1:${await listening}/hook`);
});

test('request joins the attempt trace that telemetry exposes', async ({ request, telemetry }) => {
  await request.get('/first');
  await request.post('/second', { data: { ok: true } });
  const [hook, first, second] = received;
  playwrightExpect(hook.traceparent).toBeUndefined();
  playwrightExpect(hook['x-configured']).toBe('kept');
  playwrightExpect(telemetry.traceparent).toMatch(
    new RegExp(`^00-${telemetry.traceId}-[0-9a-f]{16}-01$`, 'u'),
  );
  playwrightExpect([first.traceparent, second.traceparent]).toEqual([
    telemetry.traceparent,
    telemetry.traceparent,
  ]);
  playwrightExpect(first['x-configured']).toBe('kept');
  const document = test.info().attachments.filter(({ name }) => name === 'blackbox-progress');
  playwrightExpect(
    document.some((attachment) => String(attachment.body).includes(telemetry.traceparent)),
  ).toBe(true);
});
