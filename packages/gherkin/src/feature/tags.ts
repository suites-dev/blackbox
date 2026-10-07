import type { Tag } from '@cucumber/messages';

import { at, type DiagnosticSink, type SourceLocation } from './diagnostics.js';

// The whole tag vocabulary. Any other tag is a validation error, so no tag can
// change runner policy, select scenarios or alter a verdict (hard rules 4, 5).
const ALLOWED = /^@(system|sandbox|requirement):(.+)$/u;
const REQUIREMENT_ID = /^REQ-\d+$/u;

export type TagLevel = 'Feature' | 'Rule' | 'Scenario' | 'Examples';
type Namespace = 'system' | 'sandbox' | 'requirement';

const LEVELS = {
  system: ['Feature'],
  sandbox: ['Feature'],
  requirement: ['Feature', 'Rule', 'Scenario'],
} as const satisfies Readonly<Record<Namespace, readonly TagLevel[]>>;

export interface TagValue extends SourceLocation {
  readonly value: string;
}

export interface NodeTags {
  readonly system: readonly TagValue[];
  readonly sandbox: readonly TagValue[];
  /** Requirement IDs in source order. Traceability only: they never influence a verdict. */
  readonly requirement: readonly string[];
}

function namespaceOf(name: string): { readonly namespace: Namespace; readonly value: string } | null {
  const match = ALLOWED.exec(name);
  if (match === null) {
    return null;
  }
  return { namespace: match[1] as Namespace, value: match[2] };
}

function tagProblem(namespace: Namespace, value: string, level: TagLevel): string | null {
  const levels: readonly TagLevel[] = LEVELS[namespace];
  if (!levels.includes(level)) {
    return `@${namespace}: is not allowed on ${level} (allowed on ${levels.join(', ')})`;
  }
  if (namespace === 'requirement' && !REQUIREMENT_ID.test(value)) {
    return `requirement ID "${value}" must match REQ-<n>`;
  }
  return null;
}

/** Validates the tags written directly on one node against the allow-list. */
export function readTags(tags: readonly Tag[], level: TagLevel, sink: DiagnosticSink): NodeTags {
  const system: TagValue[] = [];
  const sandbox: TagValue[] = [];
  const requirement: TagValue[] = [];
  const parsed = { system, sandbox, requirement } satisfies Record<Namespace, TagValue[]>;
  const seen = new Set<string>();
  for (const tag of tags) {
    const location = at(tag.location);
    const allowed = namespaceOf(tag.name);
    if (allowed === null) {
      sink.report(
        'tag',
        location,
        `tag "${tag.name}" is not allowed; only @system:<id>, @sandbox:<profile> and @requirement:REQ-<n> are accepted`,
      );
      continue;
    }
    const problem = tagProblem(allowed.namespace, allowed.value, level);
    if (problem !== null) {
      sink.report('tag', location, problem);
      continue;
    }
    if (seen.has(tag.name)) {
      sink.report('tag', location, `duplicate tag "${tag.name}"`);
      continue;
    }
    seen.add(tag.name);
    parsed[allowed.namespace].push({ ...location, value: allowed.value });
  }
  return { system, sandbox, requirement: requirement.map((tag) => tag.value) };
}
