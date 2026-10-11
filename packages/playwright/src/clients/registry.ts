import type { ClientRegistry } from './types.js';

/** Captures a reusable registry while preserving each client's SDK type. */
export function defineClients<const Definitions extends ClientRegistry>(
  definitions: Definitions,
): Readonly<Definitions> {
  return Object.freeze({ ...definitions });
}
