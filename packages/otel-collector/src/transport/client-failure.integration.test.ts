import { request } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { readCollectorTrace } from '../index.js';
import { lifecyclePath } from '../storage/paths.js';
import { postJson, traceA, traceRequest, withCollector } from '../test-fixtures/collector.js';

it('keeps receiver ready after a client disconnects halfway through an OTLP body', async () => {
  await withCollector(async ({ collector }) => {
    const pending = request(collector.endpoint.tracesUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '1000' },
    });
    pending.on('error', () => undefined);
    pending.write('{');
    await new Promise<void>((resolve) =>
      pending.once('socket', (socket) => socket.once('connect', resolve)),
    );
    // Ensure the server consumes headers/body before dropping the peer socket.
    await delay(30);
    pending.destroy();
    await delay(30);
    expect((await postJson(collector, traceRequest())).status).toBe(200);
    expect(collector.status()).toMatchObject({ receiver: 'ready', failure: null });
  });
});

it('does not return trace-found when the retained lifecycle is corrupt', async () => {
  await withCollector(async ({ input, collector }) => {
    expect((await postJson(collector, traceRequest())).status).toBe(200);
    await collector.close();
    await writeFile(lifecyclePath(input), '{');
    expect(await readCollectorTrace({ ...input, traceId: traceA })).toMatchObject({
      kind: 'collector-trace-corrupt',
    });
  });
});
