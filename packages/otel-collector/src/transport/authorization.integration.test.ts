import { expect, it } from 'vitest';

import {
  collectorControlHeaders,
  collectorHeaders,
  traceRequest,
  withCollector,
} from '../test-fixtures/collector.js';

it('keeps participant ingest credentials out of collector reads', async () => {
  await withCollector(async ({ collector }) => {
    const participantRead = await fetch(collector.endpoint.readUrl, {
      headers: collectorHeaders(),
    });
    expect(participantRead.status).toBe(401);

    const managerWrite = await fetch(collector.endpoint.tracesUrl, {
      method: 'POST',
      headers: collectorControlHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify(traceRequest()),
    });
    expect(managerWrite.status).toBe(401);

    const managerRead = await fetch(collector.endpoint.readUrl, {
      headers: collectorControlHeaders(),
    });
    expect(managerRead.status).toBe(200);
  });
});
