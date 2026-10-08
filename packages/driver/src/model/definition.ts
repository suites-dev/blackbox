import type { DriverPrepareRequest } from './driver-context.js';
import type { DriverPreparation } from './preparation.js';

export type DriverPrepare = (
  request: Readonly<DriverPrepareRequest>,
) => DriverPreparation | Promise<DriverPreparation>;

interface DriverDefinitionFields {
  readonly kind: 'project-driver';
  readonly prepare: DriverPrepare;
}

/** A named driver serves only the catalog driver key equal to its name. */
export interface NamedDriverDefinition extends DriverDefinitionFields {
  readonly name: string;
}

/**
 * Without a name, one module serves every catalog driver key that references it; `prepare()`
 * receives the selected key as `request.driverId`.
 */
export type DriverDefinition = NamedDriverDefinition | DriverDefinitionFields;
