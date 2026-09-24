export const nodeInstrumentationDependencies = {
  '@opentelemetry/api': '1.9.1',
  '@opentelemetry/auto-instrumentations-node': '0.79.0',
  '@opentelemetry/exporter-trace-otlp-http': '0.221.0',
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

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');

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
const sdkOptions = {
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

async function activate() {
  if (!blackboxEnabled) {
    return { kind: 'instrumentation-activation-skipped' };
  }
  const response = await fetch(required('BLACKBOX_OTEL_ACTIVATION_ENDPOINT'), {
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
  });
  if (!response.ok) {
    throw new Error('Blackbox instrumentation activation failed with HTTP ' + response.status + '.');
  }
  return { kind: 'instrumentation-activated' };
}

const activation = activate();
activation.catch((error) => {
  setImmediate(() => { throw error; });
});

let shutdownPromise = null;
function shutdown() {
  if (shutdownPromise === null) {
    shutdownPromise = sdk.shutdown();
  }
  return shutdownPromise;
}

async function stopForSignal(signal) {
  try {
    await shutdown();
  } catch (error) {
    process.stderr.write('[blackbox] OpenTelemetry shutdown failed: ' + String(error) + '\\n');
    process.exitCode = 1;
  }
  process.removeAllListeners(signal);
  process.kill(process.pid, signal);
}

process.once('SIGINT', () => { void stopForSignal('SIGINT'); });
process.once('SIGTERM', () => { void stopForSignal('SIGTERM'); });
process.once('beforeExit', () => { void shutdown(); });

module.exports = { activation, sdk, shutdown };
`;

export const nodeInstrumentationFiles = [
  { name: 'package.json', content: nodeInstrumentationPackageJson },
  { name: 'instrumentation.js', content: nodeInstrumentationSource },
] as const;
