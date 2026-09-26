import type { Readable, Writable } from 'node:stream';

import type { DriverPrepareRequest } from '../../model/driver-context.js';
import type { DriverDefinition } from '../../model/definition.js';
import type { DriverPrepareResponse, DriverPreparation } from '../../model/preparation.js';

export interface CreateNodeDriverRunnerSourceInput {
  readonly driverModuleUrl: URL;
  readonly runnerModuleUrl: URL;
}

export interface RunNodeDriverProcessInput {
  readonly definition: unknown;
  readonly input: Readable;
  readonly output: Writable;
}

export interface PrepareDriverInput {
  readonly definition: DriverDefinition;
  readonly request: DriverPrepareRequest;
}

export interface PreparedDriver {
  readonly response: DriverPrepareResponse;
  readonly preparation: DriverPreparation;
}
