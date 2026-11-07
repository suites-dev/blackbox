import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { readCollectorTrace, startCollector } from '../index.js';
import { fragmentDirectory } from '../storage/paths.js';
import {
  collectorControlToken,
  collectorToken,
  postJson,
  span,
  traceA,
} from '../test-fixtures/collector.js';

function collectorInput(storageDirectory: string) {
  return {
    kind: 'start-collector' as const,
    storageDirectory,
    sessionId: 'session',
    executionId: 'execution',
    endpoint: {
      kind: 'http' as const,
      host: '127.0.0.1',
      port: 0,
      tracesPath: '/v1/traces',
      activationPath: '/v1/activation',
      readinessPath: '/ready',
      readPath: '/status',
    },
    authorization: {
      kind: 'split-bearer-tokens' as const,
      ingestToken: collectorToken,
      controlToken: collectorControlToken,
    },
    limits: {
      maxRequestBytes: 8192,
      maxRetainedBytes: 32768,
      maxRetainedFragments: 16,
      shutdownTimeoutMs: 100,
    },
    redaction: { kind: 'credentials-v1' as const, secrets: ['fixture-private-value', 'bbbbbbbb'] },
  };
}

it('redacts configured secrets and credential attributes before writing OTLP while preserving trace admission', async () => {
  const storageDirectory = await mkdtemp(join(tmpdir(), 'bb-redaction-'));
  const input = collectorInput(storageDirectory);
  const collector = await startCollector(input);
  try {
    const request = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  ...span(traceA, 'aaaaaaaaaaaaaaaa'),
                  name: 'fixture-private-value',
                  attributes: [
                    {
                      key: 'http.request.header.authorization',
                      value: { stringValue: 'Bearer hidden-credential' },
                    },
                    {
                      key: 'message',
                      value: { stringValue: 'prefix fixture-private-value suffix' },
                    },
                    {
                      key: 'db.url',
                      value: { stringValue: 'postgres://alice:password123@db/orders' },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const response = await postJson(collector, request);
    expect(response.status).toBe(200);
    const names = await readdir(fragmentDirectory(input));
    expect(names).toHaveLength(1);
    const persisted = await readFile(join(fragmentDirectory(input), names[0]), 'utf8');
    expect(persisted).not.toContain('fixture-private-value');
    expect(persisted).not.toContain('hidden-credential');
    expect(persisted).not.toContain('password123');
    expect(persisted).toContain('[REDACTED]');
    const read = await readCollectorTrace({ ...input, traceId: traceA });
    expect(read.kind).toBe('collector-trace-found');
    expect(JSON.stringify(read)).toContain(traceA);
    const conflicting = {
      resourceSpans: [{ scopeSpans: [{ spans: [span(traceA, 'bbbbbbbbbbbbbbbb')] }] }],
    };
    expect((await postJson(collector, conflicting)).status).toBe(500);
    expect(collector.status().receiver).toBe('failed');
    expect(await readdir(fragmentDirectory(input))).toEqual(names);
  } finally {
    const closed = await collector.close();
    await rm(storageDirectory, { recursive: true, force: true });
    expect(closed.kind).toBe('collector-stop-failed');
    await expect(fetch(collector.endpoint.tracesUrl)).rejects.toThrow();
  }
});
