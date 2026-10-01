import type { Readable, Writable } from 'node:stream';

import type { DriverPrepareRequest } from '../../model/driver-context.js';
import type { DriverDefinition } from '../../model/definition.js';
import type { DriverPrepareResponse, DriverPreparation } from '../../model/preparation.js';

interface CreateNodeDriverRunnerSourceDefaultInput {
  readonly driverModuleUrl: URL;
  readonly runnerModuleUrl: URL;
}

interface CreateNodeDriverRunnerSourceWithProtocolInput extends CreateNodeDriverRunnerSourceDefaultInput {
  readonly protocolFd: number;
}

export type CreateNodeDriverRunnerSourceInput =
  CreateNodeDriverRunnerSourceDefaultInput | CreateNodeDriverRunnerSourceWithProtocolInput;

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
