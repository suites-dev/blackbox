import { join } from 'node:path';

import type {
  ProjectSkillInstallation,
  SkillAgent,
  SkillDestinationResult,
  SkillOutcome,
} from '../installation/install.js';

export interface SkillInstallDocument {
  readonly kind: 'skill-install';
  readonly ok: boolean;
  readonly skill: string;
  readonly version: string;
  readonly source: { readonly package: string; readonly version: string };
  readonly projectDirectory: string;
  /** One entry per selected agent, pointing at the absolute destination it reads. */
  readonly results: readonly {
    readonly kind: SkillOutcome;
    readonly agent: SkillAgent;
    readonly path: string;
  }[];
  /** One entry per distinct project-relative directory written or inspected. */
  readonly destinations: readonly SkillDestinationResult[];
}

export function skillInstallDocument(installation: ProjectSkillInstallation): SkillInstallDocument {
  return {
    kind: 'skill-install',
    ok: installation.ok,
    skill: installation.skill,
    version: installation.version,
    source: { package: installation.sourcePackage, version: installation.version },
    projectDirectory: installation.projectDirectory,
    results: installation.destinations.flatMap((destination) =>
      destination.agents.map((agent) => ({
        kind: destination.outcome,
        agent,
        path: join(installation.projectDirectory, ...destination.path.split('/')),
      })),
    ),
    destinations: installation.destinations,
  };
}

function detail(destination: SkillDestinationResult): string {
  switch (destination.outcome) {
    case 'updated':
      return destination.from === null ? '' : ` (from ${destination.from})`;
    case 'conflict':
      return destination.reason === 'locally-modified'
        ? ` (locally modified: ${destination.changes.map(({ path, change }) => `${path} ${change}`).join(', ')})`
        : ' (not installed by Blackbox)';
    case 'failed':
      return ` (${destination.reason ?? 'io-error'}: ${destination.message ?? ''})`;
    default:
      return '';
  }
}

export function skillInstallLines(document: SkillInstallDocument): readonly string[] {
  const byPath = new Map(
    document.destinations.map((destination) => [
      join(document.projectDirectory, ...destination.path.split('/')),
      destination,
    ]),
  );
  return [
    `${document.skill} ${document.version} (${document.source.package})`,
    ...document.results.map((result) => {
      const destination = byPath.get(result.path);
      return `${result.agent}: ${result.kind} ${result.path}${destination === undefined ? '' : detail(destination)}`;
    }),
  ];
}

/** The message the command fails with, or null when every destination succeeded. */
export function skillInstallFailure(document: SkillInstallDocument): string | null {
  const problems = document.destinations.filter(
    ({ outcome }) => outcome === 'conflict' || outcome === 'failed',
  );
  return problems.length === 0
    ? null
    : problems.map(({ message }) => message ?? 'skill installation failed').join('\n');
}
