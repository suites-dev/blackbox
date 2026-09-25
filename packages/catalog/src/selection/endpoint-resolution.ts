import type {
  CatalogEndpointRequest,
  CatalogEntry,
} from '../model/catalog-types.js';

export function entrypointEndpoint(entry: CatalogEntry): CatalogEndpointRequest {
  const participant = entry.participants[entry.entrypoint.participant];
  return {
    name: 'entrypoint',
    service: participant.service,
    containerPort: entry.entrypoint.containerPort,
    protocol: entry.entrypoint.protocol,
  };
}

export function hostDriverEndpoints(entry: CatalogEntry): readonly CatalogEndpointRequest[] {
  return Object.entries(entry.drivers)
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([id, driver]) => {
      if (driver.execution.kind !== 'host') {
        return [];
      }
      const target = entry.participants[driver.target.participant];
      return [
        {
          name: `driver-${id}`,
          service: target.service,
          containerPort: driver.target.containerPort,
          protocol: driver.target.protocol,
        },
      ];
    });
}
