import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import { readCollectorFragments } from '../../index.js';
import { fragmentDirectory, fragmentName } from '../paths.js';
import {
  collectorHeaders,
  postJson,
  span,
  traceA,
  traceB,
  withCollector,
} from '../../test-fixtures/collector.js';

function request(traceId: string, spanId: string): Record<string, unknown> {
  return { resourceSpans: [{ scopeSpans: [{ spans: [span(traceId, spanId)] }] }] };
}

it('returns every retained fragment with its exact raw OTLP text in sequence order', async () => {
  await withCollector(async ({ input, collector }) => {
    // Whitespace and key order a re-serialization would not preserve.
    const exactText = `{ "resourceSpans" : [ {"scopeSpans":[{"spans":[${JSON.stringify(
      span(traceA, 'aaaaaaaaaaaaaaaa'),
    )}]}]} ] }\n`;
    const response = await fetch(collector.endpoint.tracesUrl, {
      method: 'POST',
      headers: collectorHeaders({ 'content-type': 'application/json' }),
      body: exactText,
    });
    expect(response.status).toBe(200);
    expect((await postJson(collector, request(traceB, 'bbbbbbbbbbbbbbbb'))).status).toBe(200);
    await collector.close();

    const result = await readCollectorFragments(input);
    if (result.kind !== 'collector-fragments-found') {
      throw new Error(`Expected retained fragments, received ${result.kind}.`);
    }
    expect(result.identity).toEqual({ sessionId: input.sessionId, executionId: input.executionId });
    expect(result.lifecycle.telemetry).toMatchObject({ acceptedRequests: 2, acceptedSpans: 2 });
    expect(result.fragments.map((fragment) => fragment.sequence)).toEqual([1, 2]);
    for (const fragment of result.fragments) {
      const file = JSON.parse(
        await readFile(join(fragmentDirectory(input), fragmentName(fragment.sequence)), 'utf8'),
      ) as { readonly rawJson: string; readonly receivedAt: string };
      expect(fragment.rawJson).toBe(file.rawJson);
      expect(fragment.receivedAt).toBe(file.receivedAt);
    }
    expect(JSON.parse(result.fragments[1].rawJson)).toEqual(request(traceB, 'bbbbbbbbbbbbbbbb'));
  });
});

it('reports a missing collector session without returning an empty fragment list', async () => {
  await withCollector(async ({ input }) => {
    expect(
      await readCollectorFragments({ ...input, executionId: 'another-execution' }),
    ).toMatchObject({
      kind: 'collector-fragments-missing',
      identity: { sessionId: input.sessionId, executionId: 'another-execution' },
      message: expect.stringMatching(/exact identity/u),
    });
  });
});

it('reports corruption when an acknowledged fragment disappears or is damaged', async () => {
  await withCollector(async ({ input, collector }) => {
    expect((await postJson(collector, request(traceA, 'aaaaaaaaaaaaaaaa'))).status).toBe(200);
    expect((await postJson(collector, request(traceB, 'bbbbbbbbbbbbbbbb'))).status).toBe(200);
    await collector.close();

    await writeFile(join(fragmentDirectory(input), fragmentName(2)), '{}\n', 'utf8');
    expect(await readCollectorFragments(input)).toMatchObject({
      kind: 'collector-fragments-corrupt',
      error: { message: expect.stringMatching(/corrupt/u) },
    });

    await rm(join(fragmentDirectory(input), fragmentName(2)));
    expect(await readCollectorFragments(input)).toMatchObject({
      kind: 'collector-fragments-corrupt',
      error: { message: expect.stringMatching(/incomplete/u) },
    });
  });
});
