import type { CatalogSandboxInput } from '@suites/blackbox-catalog-internal';

export interface RequiredActivation {
  readonly runtime: string;
  readonly serviceName: string;
}

export function requiredActivations(plan: CatalogSandboxInput): readonly RequiredActivation[] {
  const unique = new Map<string, RequiredActivation>();
  for (const participant of Object.values(plan.metadata.participants)) {
    if (participant.activation.kind === 'configured') {
      const item = { runtime: participant.runtime, serviceName: participant.service };
      unique.set(`${item.runtime}\u0000${item.serviceName}`, item);
    }
  }
  return [...unique.values()].sort((left, right) =>
    left.serviceName.localeCompare(right.serviceName),
  );
}

export function missingActivations(
  required: readonly RequiredActivation[],
  observed: readonly RequiredActivation[],
): readonly RequiredActivation[] {
  const keys = new Set(observed.map((item) => `${item.runtime}\u0000${item.serviceName}`));
  return required.filter((item) => !keys.has(`${item.runtime}\u0000${item.serviceName}`));
}
