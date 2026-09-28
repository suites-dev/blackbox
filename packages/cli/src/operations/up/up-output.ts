import type { CapsuleStartResult } from '@suites/blackbox-capsule-internal';

import { cliErrorDocument, type CliErrorDetail } from '../../cli/failure.js';
import { formatDuration } from '../../cli/output.js';
import { nextSteps } from '../../cli/next-steps.js';

export type StartedCapsule = Extract<CapsuleStartResult, { kind: 'capsule-started' }>;

export type CurrentOutcome =
  { readonly kind: 'set' } | { readonly kind: 'not-set'; readonly error: CliErrorDetail };

export function currentWriteFailure(capsule: string, message: string): CliErrorDetail {
  return {
    code: 'current-capsule-write-failed',
    message: `capsule ${capsule} is up but could not be made current (${message})`,
    details: [],
    candidates: [],
    next: [nextSteps.down(capsule)],
  };
}

/** The document `capsule start --json` printed before phase 1 (field order kept). */
function startDocument(result: StartedCapsule) {
  return {
    sessionId: result.sessionId,
    system: result.system,
    title: result.title,
    composeProject: result.composeProject,
    artifactRoot: result.artifactRoot,
    entrypoint: result.entrypoint,
    containers: result.containers,
    networks: result.networks,
    volumes: result.volumes,
    readiness: result.readiness,
  };
}

export function upDocument(input: {
  readonly result: StartedCapsule;
  readonly current: CurrentOutcome;
  readonly runSuggestion: string;
}) {
  return {
    kind: 'capsule-started',
    ...startDocument(input.result),
    capsule: input.result.sessionId,
    current: input.current.kind,
    warnings: input.current.kind === 'set' ? [] : [cliErrorDocument(input.current.error)],
    next: [input.runSuggestion],
  };
}

export function upLines(input: {
  readonly result: StartedCapsule;
  readonly current: CurrentOutcome;
  readonly runSuggestion: string;
  readonly durationMs: number;
}): readonly string[] {
  const { result } = input;
  const capsule = result.sessionId;
  const services = `${String(result.containers.length)} services`;
  const current =
    input.current.kind === 'set'
      ? [`current capsule: ${capsule}`]
      : [
          `blackbox: ${input.current.error.message}`,
          ...input.current.error.next.map((next) => `→ ${next}`),
        ];
  return [
    `capsule ${capsule} is up · ${result.system} · ${services} · ${formatDuration(input.durationMs)}`,
    ...current,
    `entrypoint: ${result.entrypoint.url}`,
    `→ ${input.runSuggestion}`,
  ];
}
