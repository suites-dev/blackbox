export const nodeInstrumentationDependencies = {
  '@opentelemetry/api': '1.9.1',
  '@opentelemetry/auto-instrumentations-node': '0.79.0',
  '@opentelemetry/context-async-hooks': '2.10.0',
  '@opentelemetry/core': '2.10.0',
  '@opentelemetry/exporter-trace-otlp-http': '0.221.0',
  '@opentelemetry/propagator-env-carrier': '0.221.0',
  '@opentelemetry/sdk-node': '0.221.0',
} as const;

export const nodeInstrumentationPackage = {
  name: 'blackbox-node-instrumentation',
  version: '1.0.0',
  private: true,
  type: 'commonjs',
  description: 'Project-local OpenTelemetry bootstrap installed by Blackbox.',
  engines: {
    node: '^18.19.0 || >=20.6.0',
  },
  dependencies: nodeInstrumentationDependencies,
} as const;

export const nodeInstrumentationPackageJson = `${JSON.stringify(nodeInstrumentationPackage, null, 2)}\n`;

export const nodeInstrumentationSource = `'use strict';

const { realpathSync } = require('node:fs');
const { sep } = require('node:path');

const packageManagerEntries = [
  '/node_modules/npm/bin/npm-cli.js',
  '/node_modules/npm/bin/npx-cli.js',
  '/node_modules/pnpm/bin/pnpm.cjs',
  '/node_modules/pnpm/bin/pnpx.cjs',
  '/node_modules/yarn/bin/yarn.js',
  '/node_modules/@yarnpkg/cli-dist/bin/yarn.js',
  '/node_modules/corepack/dist/corepack.js',
  '/node_modules/corepack/dist/npm.js',
  '/node_modules/corepack/dist/npx.js',
  '/node_modules/corepack/dist/pnpm.js',
  '/node_modules/corepack/dist/pnpx.js',
  '/node_modules/corepack/dist/yarn.js',
  '/node_modules/corepack/dist/yarnpkg.js',
];

function resolvedEntry(entry) {
  try {
    return realpathSync(entry);
  } catch {
    return entry;
  }
}

function isPackageManagerLauncher(entry) {
  if (typeof entry !== 'string' || entry === '') {
    return false;
  }
  const resolved = resolvedEntry(entry).split(sep).join('/');
  if (packageManagerEntries.some((suffix) => resolved.endsWith(suffix))) {
    return true;
  }
  const name = resolved.slice(resolved.lastIndexOf('/') + 1);
  return (
    resolved.endsWith('/.yarn/releases/' + name) &&
    name.startsWith('yarn-') &&
    name.endsWith('.cjs')
  );
}

// Launchers only start the application. NODE_OPTIONS still loads this bootstrap in their children.
if (isPackageManagerLauncher(process.argv[1])) {
  module.exports = { activation: Promise.resolve({ kind: 'instrumentation-activation-skipped' }) };
  return;
}

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { ROOT_CONTEXT, context, trace } = require('@opentelemetry/api');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { W3CTraceContextPropagator, suppressTracing } = require('@opentelemetry/core');
const { AsyncLocalStorageContextManager } = require('@opentelemetry/context-async-hooks');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { EnvironmentGetter } = require('@opentelemetry/propagator-env-carrier');
const { AsyncLocalStorage } = require('node:async_hooks');

function required(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(name + ' is required when Blackbox telemetry is enabled.');
  }
  return value;
}

const tracesEndpoint = process.env.BLACKBOX_OTEL_TRACES_ENDPOINT;
const blackboxEnabled = typeof tracesEndpoint === 'string' && tracesEndpoint.trim() !== '';
const token = blackboxEnabled ? required('BLACKBOX_OTEL_AUTH_TOKEN') : '';
class ProcessContextManager extends AsyncLocalStorageContextManager {
  constructor() {
    super();
    this.storage = new AsyncLocalStorage();
  }
  active() {
    return this.storage.getStore() || ROOT_CONTEXT;
  }
  with(context, callback, thisArg, ...args) {
    const bound = thisArg == null ? callback : callback.bind(thisArg);
    return this.storage.run(context, bound, ...args);
  }
  enter(context) {
    this.storage.enterWith(context);
  }
  enable() {
    return this;
  }
  disable() {
    this.storage.disable();
    return this;
  }
}
const contextManager = new ProcessContextManager();
const sdkOptions = {
  contextManager,
  instrumentations: [getNodeAutoInstrumentations()],
};

if (blackboxEnabled) {
  sdkOptions.traceExporter = new OTLPTraceExporter({
    url: tracesEndpoint,
    headers: { authorization: 'Bearer ' + token },
  });
}

const sdk = new NodeSDK(sdkOptions);

sdk.start();

function extractProcessContext() {
  const extracted = new W3CTraceContextPropagator().extract(
    ROOT_CONTEXT,
    undefined,
    new EnvironmentGetter(),
  );
  if (
    typeof process.env.TRACEPARENT === 'string' &&
    trace.getSpanContext(extracted) === undefined
  ) {
    throw new Error('TRACEPARENT does not contain valid W3C trace context.');
  }
  return extracted;
}

function activateProcessContext(extracted) {
  if (trace.getSpanContext(extracted) === undefined) {
    return;
  }
  contextManager.enter(extracted);
}

const processContext = extractProcessContext();

async function activate() {
  if (!blackboxEnabled) {
    return { kind: 'instrumentation-activation-skipped' };
  }
  const endpoint = required('BLACKBOX_OTEL_ACTIVATION_ENDPOINT');
  const request = {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + token,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      schemaVersion: 1,
      kind: 'instrumentation-activation-v1',
      sessionId: required('BLACKBOX_OTEL_SESSION_ID'),
      executionId: required('BLACKBOX_OTEL_EXECUTION_ID'),
      runtime: required('BLACKBOX_OTEL_RUNTIME'),
      serviceName: required('BLACKBOX_OTEL_SERVICE_NAME'),
    }),
  };
  // The activation is Blackbox's own call, not application behavior, so it must not export a span.
  const response = await context.with(suppressTracing(context.active()), () =>
    fetch(endpoint, request),
  );
  if (!response.ok) {
    throw new Error('Blackbox instrumentation activation failed with HTTP ' + response.status + '.');
  }
  return { kind: 'instrumentation-activated' };
}

const activation = activate();
activation.catch((error) => {
  setImmediate(() => { throw error; });
});

activateProcessContext(processContext);

let shutdownPromise = null;
function shutdown() {
  if (shutdownPromise === null) {
    shutdownPromise = sdk.shutdown();
  }
  return shutdownPromise;
}

async function stopForSignal(signal, applicationOwnsSignal) {
  try {
    await shutdown();
  } catch (error) {
    process.stderr.write('[blackbox] OpenTelemetry shutdown failed: ' + String(error) + '\\n');
    process.exitCode = 1;
  }
  if (!applicationOwnsSignal) {
    process.kill(process.pid, signal);
  }
}

function handleSignal(signal) {
  const applicationOwnsSignal = process.listenerCount(signal) > 0;
  void stopForSignal(signal, applicationOwnsSignal);
}

process.once('SIGINT', () => { handleSignal('SIGINT'); });
process.once('SIGTERM', () => { handleSignal('SIGTERM'); });
process.once('beforeExit', () => { void shutdown(); });

module.exports = { activation, sdk, shutdown };
`;

export const nodeInstrumentationFiles = [
  { name: 'package.json', content: nodeInstrumentationPackageJson },
  { name: 'instrumentation.js', content: nodeInstrumentationSource },
] as const;
