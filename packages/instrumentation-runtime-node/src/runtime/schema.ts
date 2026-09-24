export { default as nodeInstrumentationPackageSchema } from './schema/node-instrumentation-package-v1.json' with { type: 'json' };

export const nodeInstrumentationPackageSchemaUrl = new URL(
  './schema/node-instrumentation-package-v1.json',
  import.meta.url,
);
