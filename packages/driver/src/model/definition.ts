import type { DriverPrepareRequest } from './driver-context.js';
import type { DriverPreparation } from './preparation.js';

export type DriverPrepare = (
  request: Readonly<DriverPrepareRequest>,
) => DriverPreparation | Promise<DriverPreparation>;

export interface DriverDefinition {
  readonly kind: 'project-driver';
  readonly name: string;
  readonly prepare: DriverPrepare;
}
