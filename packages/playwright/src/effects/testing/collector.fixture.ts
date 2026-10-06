import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startCollector, type CollectorHandle } from '@suites/blackbox-otel-collector';

import { createActivityRegistry } from '../../activities/activity-registry.js';

const identity = { sessionId: 'effects-pipeline-session', executionId: 'effects-pipeline-attempt' };
const ingestToken = 'effects-pipeline-test-ingest';

export interface PipelineFixture {
  readonly registry: ReturnType<typeof createActivityRegistry>;
  readonly storageDirectory: string;
  readonly collector: CollectorHandle;
  readonly exportSpans: (spans: readonly Record<string, unknown>[]) => Promise<void>;
}

async function cleanupCollector(collector: CollectorHandle | null, storageDirectory: string) {
  try {
    if (collector !== null) {
      const closed = await collector.close();
      if (closed.kind !== 'collector-stopped') {
        throw new Error(`Pipeline collector cleanup failed: ${closed.error.message}`);
      }
    }
  } finally {
    await rm(storageDirectory, { recursive: true, force: true });
  }
}

async function exportSpans(collector: CollectorHandle, spans: readonly Record<string, unknown>[]) {
  const response = await fetch(collector.endpoint.tracesUrl, {
    method: 'POST',
    headers: { authorization: `Bearer ${ingestToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      resourceSpans: [
        {
          resource: { attributes: [{ key: 'service.name', value: { stringValue: 'orders' } }] },
          scopeSpans: [{ scope: { name: 'effects-pipeline-test' }, spans }],
        },
      ],
    }),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Collector rejected pipeline fixture (${response.status}): ${body}`);
  }
}

/** Real collector transport and retained storage, with explicit synthetic OTLP input. */
export async function withPipeline(
  run: (fixture: PipelineFixture) => Promise<void>,
): Promise<void> {
  const storageDirectory = await mkdtemp(join(tmpdir(), 'blackbox-effects-pipeline-'));
  let collector: CollectorHandle | null = null;
  try {
    collector = await startCollector({
      ...identity,
      kind: 'start-collector',
      storageDirectory,
      endpoint: {
        kind: 'http',
        host: '127.0.0.1',
        port: 0,
        tracesPath: '/v1/traces',
        activationPath: '/v1/activation',
        readinessPath: '/ready',
        readPath: '/status',
      },
      authorization: {
        kind: 'split-bearer-tokens',
        ingestToken,
        controlToken: 'effects-pipeline-test-control',
      },
      limits: {
        maxRequestBytes: 65_536,
        maxRetainedBytes: 262_144,
        maxRetainedFragments: 32,
        shutdownTimeoutMs: 1_000,
      },
    });
    const active = collector;
    await run({
      storageDirectory,
      collector: active,
      registry: createActivityRegistry(identity),
      exportSpans: (spans) => exportSpans(active, spans),
    });
  } finally {
    await cleanupCollector(collector, storageDirectory);
  }
}

export function operationSpan(input: {
  readonly traceId: string;
  readonly spanId: string;
  readonly attributes: Readonly<Record<string, string>>;
}): Record<string, unknown> {
  return {
    traceId: input.traceId,
    spanId: input.spanId,
    name: 'observed operation',
    kind: 3,
    startTimeUnixNano: '1750000000000000000',
    endTimeUnixNano: '1750000000001000000',
    attributes: Object.entries(input.attributes).map(([key, value]) => ({
      key,
      value: { stringValue: value },
    })),
    droppedAttributesCount: 0,
    events: [],
    links: [],
    status: { code: 0 },
  };
}
