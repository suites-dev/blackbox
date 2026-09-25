import type {
  CatalogDriver,
  CatalogEntry,
  ResolvedCatalogDriver,
  ResolvedCatalogDriverExecution,
} from '../model/catalog-types.js';

function resolveExecution(
  execution: CatalogDriver['execution'],
  entry: CatalogEntry,
): ResolvedCatalogDriverExecution {
  if (execution.kind === 'host') {
    return { kind: 'host' };
  }
  const participant = entry.participants[execution.participant];
  return {
    kind: 'participant',
    participantId: execution.participant,
    service: participant.service,
  };
}

function resolveDriver(
  id: string,
  driver: CatalogDriver,
  entry: CatalogEntry,
): ResolvedCatalogDriver {
  const target = entry.participants[driver.target.participant];
  return {
    id,
    kind: driver.kind,
    runtime: driver.runtime,
    ref: driver.ref,
    target: {
      kind: 'participant',
      participantId: driver.target.participant,
      service: target.service,
      protocol: driver.target.protocol,
      containerPort: driver.target.containerPort,
    },
    execution: resolveExecution(driver.execution, entry),
    propagation: driver.propagation,
  };
}

export function resolveDrivers(
  entry: CatalogEntry,
): Readonly<Record<string, ResolvedCatalogDriver>> {
  const drivers = Object.entries(entry.drivers)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, driver]) => [id, resolveDriver(id, driver, entry)] as const);
  return Object.fromEntries(drivers);
}
