export const nodeInstrumentationDependencies = {
  '@opentelemetry/api': '1.9.1',
  '@opentelemetry/auto-instrumentations-node': '0.79.0',
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

const sdk = new NodeSDK({
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

module.exports = { sdk };
`;

export const nodeInstrumentationFiles = [
  { name: 'package.json', content: nodeInstrumentationPackageJson },
  { name: 'instrumentation.js', content: nodeInstrumentationSource },
] as const;
