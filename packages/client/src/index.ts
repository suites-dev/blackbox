export { defineClient, InvalidClientDefinitionError } from './authoring/define-client.js';
export { clientResultSchema, clientResultSchemaUrl } from './schema/client-result-schema.js';
export {
  clientExecutionSchema,
  clientExecutionSchemaUrl,
} from './schema/client-execution-schema.js';
export {
  clientInspectionSchema,
  clientInspectionSchemaUrl,
} from './schema/client-inspection-schema.js';
export {
  createNodeClientRunnerSource,
  createNodeClientInspectorSource,
  executeClient,
  runNodeClientProcess,
  inspectNodeClientDefinition,
} from './node-runner/index.js';
export type {
  ClientCallback,
  ClientDefinition,
  ClientEndpoint,
  ClientExecutionInput,
  ClientResult,
  ClientTarget,
  ClientTelemetry,
  JsonObject,
  JsonPrimitive,
  JsonValue,
} from './model/client-types.js';
export type {
  ClientProcessResult,
  ClientInspectionResult,
  ClientIdentity,
  ClientMetadataAvailability,
  ClientMetadataAvailable,
  CreateNodeClientInspectorSourceInput,
  CreateNodeClientRunnerSourceInput,
  ExecuteClientInput,
  InspectNodeClientDefinitionInput,
  RunNodeClientProcessInput,
} from './node-runner/index.js';
