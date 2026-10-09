import type { CatalogSandboxInput, Participant } from '@suites/blackbox-catalog';
import type { ClientTarget } from '../../clients/types.js';

export function clientPlan(
  plan: CatalogSandboxInput,
  targets: readonly ClientTarget[],
): CatalogSandboxInput {
  const endpoints = targets.map((target, index) => {
    const participants: Readonly<Record<string, Participant | undefined>> =
      plan.metadata.participants;
    const participant = participants[target.participant];
    if (participant === undefined) {
      throw new Error(`Unknown client participant ${JSON.stringify(target.participant)}`);
    }
    return {
      name: `blackbox-client-${index}`,
      service: participant.service,
      containerPort: target.containerPort,
      protocol: 'http',
    };
  });
  return { ...plan, endpoints: [...plan.endpoints, ...endpoints] };
}
export function clientServices(plan: CatalogSandboxInput): Readonly<Record<string, string>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(plan.metadata.participants).map(([name, participant]) => [
        name,
        participant.service,
      ]),
    ),
  );
}
