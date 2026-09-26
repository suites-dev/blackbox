import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { readCollectorSession, readCollectorTrace } from '../index.js';
import { collectorToken, withCollector } from '../test-fixtures/collector.js';

// This is a separately installed upstream producer; no collector serializer is reused.
const producer = `
const { BasicTracerProvider, SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const exporter = new OTLPTraceExporter({
  url: process.argv[2],
  headers: { authorization: 'Bearer ' + process.argv[3] },
});
const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
const span = provider.getTracer('upstream-http-json-probe').startSpan('actual-exporter-span');
const identity = span.spanContext();
span.end();
provider.forceFlush().then(() => provider.shutdown()).then(() => {
  process.stdout.write(JSON.stringify(identity));
}, (error) => { console.error(error); process.exitCode = 1; });
`;

it('accepts an actual upstream OTLP HTTP JSON exporter and retains its exact trace identity', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-upstream-exporter-'));
  try {
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify({
        private: true,
        dependencies: {
          '@opentelemetry/sdk-trace-base': '2.10.0',
          '@opentelemetry/exporter-trace-otlp-http': '0.221.0',
        },
      }),
    );
    await promisify(execFile)(
      'npm',
      ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock'],
      {
        cwd: directory,
        timeout: 90_000,
      },
    );
    const entry = join(directory, 'producer.cjs');
    await writeFile(entry, producer);
    await withCollector(async ({ input, collector }) => {
      const result = await promisify(execFile)(
        process.execPath,
        [entry, collector.endpoint.tracesUrl, collectorToken],
        {
          cwd: directory,
          timeout: 15_000,
        },
      );
      const identity = JSON.parse(result.stdout);
      expect(identity.traceId).toMatch(/^[0-9a-f]{32}$/u);
      expect(identity.spanId).toMatch(/^[0-9a-f]{16}$/u);
      expect(await readCollectorSession(input)).toMatchObject({
        kind: 'collector-session-found',
        traceIds: [identity.traceId],
        lifecycle: { telemetry: { acceptedRequests: 1, acceptedSpans: 1 } },
      });
      expect(await readCollectorTrace({ ...input, traceId: identity.traceId })).toMatchObject({
        kind: 'collector-trace-found',
        fragments: [
          {
            request: {
              resourceSpans: [
                {
                  scopeSpans: [
                    {
                      spans: [
                        expect.objectContaining({
                          traceId: identity.traceId,
                          spanId: identity.spanId,
                          name: 'actual-exporter-span',
                        }),
                      ],
                    },
                  ],
                },
              ],
            },
          },
        ],
      });
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
