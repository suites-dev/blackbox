import { AsyncLocalStorage } from 'node:async_hooks';
import { runInNewContext } from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

import { nodeInstrumentationSource } from '../bundle.js';

interface AttributeSpan {
  setAttribute(name: string, value: string): void;
  setAttributes(attributes: Record<string, string>): void;
}

interface ProducerConfiguration {
  '@opentelemetry/instrumentation-pg': {
    responseHook: (span: AttributeSpan, info: { data: unknown }) => void;
  };
  '@opentelemetry/instrumentation-amqplib': {
    publishHook: (span: AttributeSpan, info: unknown) => void;
  };
}

class BootstrapDependency {
  readonly marker = 'unused dependency boundary';
}

function loadGeneratedBootstrap() {
  const instrumentations = [{ name: 'http' }, { name: 'pg' }, { name: 'amqplib' }];
  const autoInstrumentations = vi.fn<(config: ProducerConfiguration) => typeof instrumentations>(
    () => instrumentations,
  );
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
  const call = autoInstrumentations.mock.calls.at(0);
  if (call === undefined) {
    throw new Error('Generated bootstrap did not configure auto instrumentation');
  }
  const [configuration] = call;
  return { configuration, instrumentations, autoInstrumentations, sdk };
}

function span() {
  return {
    setAttribute: vi.fn<(name: string, value: string) => void>(),
    setAttributes: vi.fn<(attributes: Record<string, string>) => void>(),
  };
}

describe('generated producer operation hooks', () => {
  it('configures both hooks while retaining the full auto-instrumentation result', () => {
    const runtime = loadGeneratedBootstrap();
    expect(runtime.autoInstrumentations).toHaveBeenCalledOnce();
    expect(Object.keys(runtime.configuration).sort()).toEqual([
      '@opentelemetry/instrumentation-amqplib',
      '@opentelemetry/instrumentation-pg',
    ]);
    expect(runtime.configuration['@opentelemetry/instrumentation-pg']).toEqual({
      responseHook: expect.any(Function),
    });
    expect(runtime.configuration['@opentelemetry/instrumentation-amqplib']).toEqual({
      publishHook: expect.any(Function),
    });
    expect(runtime.sdk).toHaveBeenCalledWith(
      expect.objectContaining({ instrumentations: [runtime.instrumentations] }),
    );
  });

  it.each(['INSERT', 'SELECT', 'BEGIN', 'COMMIT', 'ROLLBACK'])(
    'uses the single structured PostgreSQL command %s without reading SQL or rows',
    (command) => {
      const { configuration } = loadGeneratedBootstrap();
      const recorded = span();
      const data = {
        command,
        get rows() {
          throw new Error('Rows do not establish the database operation');
        },
        get query() {
          throw new Error('SQL must not be parsed');
        },
      };
      configuration['@opentelemetry/instrumentation-pg'].responseHook(recorded, { data });
      expect(recorded.setAttribute).toHaveBeenCalledExactlyOnceWith('db.operation.name', command);
      expect(recorded.setAttributes).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['missing result', undefined],
    ['null result', null],
    ['error result', new Error('query failed')],
    ['missing command', { rows: [{ operation: 'INSERT' }], query: 'INSERT INTO items VALUES (1)' }],
    ['empty command', { command: '' }],
    ['non-string command', { command: 12 }],
    ['empty result array', []],
    ['single-result array', [{ command: 'INSERT' }]],
    ['multiple results', [{ command: 'INSERT' }, { command: 'COMMIT' }]],
  ])('does not invent an operation for %s', (_name, data) => {
    const { configuration } = loadGeneratedBootstrap();
    const recorded = span();
    const hook = configuration['@opentelemetry/instrumentation-pg'].responseHook;
    expect(hook).toBeTypeOf('function');
    hook(recorded, { data });
    expect(recorded.setAttribute).not.toHaveBeenCalled();
    expect(recorded.setAttributes).not.toHaveBeenCalled();
  });

  it('uses the pre-publish action without inspecting payloads or confirmation results', () => {
    const { configuration } = loadGeneratedBootstrap();
    const recorded = span();
    const info = new Proxy(
      {},
      {
        get() {
          throw new Error('Publication identity must not depend on payload or result');
        },
      },
    );
    configuration['@opentelemetry/instrumentation-amqplib'].publishHook(recorded, info);
    expect(recorded.setAttributes).toHaveBeenCalledExactlyOnceWith({
      'messaging.operation.type': 'send',
      'messaging.operation.name': 'publish',
    });
    expect(recorded.setAttribute).not.toHaveBeenCalled();
  });
});
