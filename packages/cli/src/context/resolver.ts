import type { CapsuleActivityReport } from '@suites/blackbox-capsule-internal';

import { CliFailure, type CliCandidate } from '../cli/failure.js';
import { isActivityPrefix, isFullActivityId, isTraceId, stripHyphens } from './identifiers.js';
import {
  activityName,
  type ActivityEntry,
  type CapsuleSummary,
  type ProjectIndex,
} from './project-index.js';

export type Resolved =
  | { readonly kind: 'capsule'; readonly capsule: CapsuleSummary }
  | {
      readonly kind: 'activity';
      readonly capsule: CapsuleSummary;
      readonly activity: CapsuleActivityReport;
    }
  | { readonly kind: 'trace'; readonly capsule: CapsuleSummary; readonly traceId: string };

/** An explicit capsule context narrows activity/trace search; nothing else does. */
export type SearchScope =
  { readonly kind: 'project' } | { readonly kind: 'capsule'; readonly capsule: string };

interface Match {
  readonly capsule: string;
  readonly candidate: CliCandidate;
  readonly resolved: Resolved;
}

function unknown(input: string): CliFailure {
  return new CliFailure({
    code: 'id-unknown',
    message: `no capsule, activity or trace matches ${input}`,
    details: [],
    candidates: [],
    next: ['blackbox ls --all'],
  });
}

function ambiguous(input: string, matches: readonly Match[]): CliFailure {
  return new CliFailure({
    code: 'id-ambiguous',
    message: `${input} matches ${String(matches.length)} activities`,
    details: matches.map(({ candidate }) =>
      [candidate.id, candidate.capsule, candidate.name ?? ''].join(' ').trimEnd(),
    ),
    candidates: matches.map(({ candidate }) => candidate),
    next: ['use a longer prefix'],
  });
}

function mismatch(input: string, scope: string, owners: readonly Match[]): CliFailure {
  const owner = owners.length === 1 ? owners[0] : null;
  return new CliFailure({
    code: 'id-capsule-mismatch',
    message: `${input} is not in capsule ${scope}`,
    details: owner === null ? [] : [`it belongs to capsule ${owner.capsule}`],
    candidates: owner === null ? [] : [owner.candidate],
    next: owner === null ? [] : [`blackbox show ${input} --capsule ${owner.capsule}`],
  });
}

function activityMatch(index: ProjectIndex, entry: ActivityEntry): Match | null {
  const capsule = index.capsule(entry.capsule);
  if (capsule === null) {
    return null;
  }
  return {
    capsule: entry.capsule,
    candidate: {
      id: entry.activity.activityId,
      type: 'activity',
      capsule: entry.capsule,
      name: activityName(entry.activity),
    },
    resolved: { kind: 'activity', capsule, activity: entry.activity },
  };
}

async function activityMatches(index: ProjectIndex, input: string): Promise<readonly Match[]> {
  const full = isFullActivityId(input);
  const hex = stripHyphens(input);
  const entries = (await index.allActivities()).filter(({ activity }) =>
    full ? activity.activityId === input : stripHyphens(activity.activityId).startsWith(hex),
  );
  return entries.flatMap((entry) => {
    const match = activityMatch(index, entry);
    return match === null ? [] : [match];
  });
}

async function traceMatches(index: ProjectIndex, traceId: string): Promise<readonly Match[]> {
  const matches = await Promise.all(
    index.capsules().map(async (capsule) =>
      (await index.traces(capsule.capsule)).includes(traceId)
        ? [
            {
              capsule: capsule.capsule,
              candidate: { id: traceId, type: 'trace', capsule: capsule.capsule, name: null },
              resolved: { kind: 'trace', capsule, traceId },
            } satisfies Match,
          ]
        : [],
    ),
  );
  return matches.flat();
}

function choose(input: string, matches: readonly Match[], scope: SearchScope): Resolved {
  const inScope =
    scope.kind === 'capsule' ? matches.filter((match) => match.capsule === scope.capsule) : matches;
  if (inScope.length === 0) {
    if (scope.kind === 'capsule' && matches.length > 0) {
      throw mismatch(input, scope.capsule, matches);
    }
    throw unknown(input);
  }
  if (inScope.length > 1) {
    throw ambiguous(input, inScope);
  }
  return inScope[0].resolved;
}

/**
 * Resolves a capsule, activity or trace ID (table B). The search always covers
 * the whole project so a mismatch can name the capsule that owns the ID; only
 * an explicit capsule context narrows which match is accepted.
 */
export async function resolveId(
  index: ProjectIndex,
  input: string,
  scope: SearchScope,
): Promise<Resolved> {
  if (isTraceId(input)) {
    return choose(input, await traceMatches(index, input), scope);
  }
  const capsule = index.capsule(input);
  if (capsule !== null) {
    return { kind: 'capsule', capsule };
  }
  if (isFullActivityId(input) || isActivityPrefix(input)) {
    return choose(input, await activityMatches(index, input), scope);
  }
  throw unknown(input);
}
