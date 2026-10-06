import { AsyncLocalStorage } from 'node:async_hooks';
import { runInNewContext } from 'node:vm';

import { expect, test, vi } from 'vitest';

import { nodeInstrumentationSource } from '../bundle.js';

class BootstrapDependency {
  readonly marker = 'unused dependency boundary';
}

function loadGeneratedBootstrap() {
  const instrumentations = [{ name: 'http' }, { name: 'pg' }, { name: 'amqplib' }];
  const autoInstrumentations = vi.fn<() => typeof instrumentations>(() => instrumentations);
  const sdk = vi.fn();
  const modules = new Map<string, unknown>(
    Object.entries({
      '@opentelemetry/sdk-node': {
        NodeSDK: class {
          constructor(options: unknown) {
            sdk(options);
          }
          readonly start = vi.fn();
        },
      },
      '@opentelemetry/api': { ROOT_CONTEXT: {}, trace: { getSpanContext: () => undefined } },
      '@opentelemetry/auto-instrumentations-node': {
        getNodeAutoInstrumentations: autoInstrumentations,
      },
      '@opentelemetry/core': {
        W3CTraceContextPropagator: class {
          extract() {
            return {};
          }
        },
      },
      '@opentelemetry/context-async-hooks': {
        AsyncLocalStorageContextManager: BootstrapDependency,
      },
      '@opentelemetry/exporter-trace-otlp-http': { OTLPTraceExporter: BootstrapDependency },
      '@opentelemetry/propagator-env-carrier': { EnvironmentGetter: BootstrapDependency },
      'node:async_hooks': { AsyncLocalStorage },
    }),
  );
  runInNewContext(nodeInstrumentationSource, {
    require(name: string) {
      if (!modules.has(name)) {
        throw new Error(`Unexpected bootstrap dependency: ${name}`);
      }
      return modules.get(name);
    },
    process: { env: {}, once: vi.fn() },
    module: { exports: {} },
  });
  return { instrumentations, autoInstrumentations, sdk };
}

test('generated bootstrap preserves default OpenTelemetry instrumentation without producer hooks', () => {
  const runtime = loadGeneratedBootstrap();
  expect(runtime.autoInstrumentations.mock.calls).toEqual([[]]);
  expect(runtime.sdk).toHaveBeenCalledWith(
    expect.objectContaining({ instrumentations: [runtime.instrumentations] }),
  );
});
