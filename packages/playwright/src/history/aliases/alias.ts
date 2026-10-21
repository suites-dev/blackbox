import { digestOf, type canonicalization, type Digest } from '../../envelope/canonical.js';

export const aliasVersion = 1;

/**
 * A recorded claim that two behavior ids name the same behavior: `from` is the older id, `to` the one that
 * replaces it. Nothing here is derived from names; the claim is someone's, and `assertedBy` says whose. It is not
 * verified authority. Both ids and every execution recorded under them stay as they were.
 */
export interface BehaviorAlias {
  readonly aliasVersion: typeof aliasVersion;
  readonly kind: 'behavior-alias';
  readonly canonicalization: typeof canonicalization;
  readonly digest: Digest;
  readonly from: string;
  readonly to: string;
  readonly reason: string;
  readonly assertedBy: string;
  readonly recordedAt: string;
  /** Envelope digests that anchor each side of the claim, when the asserter had them. */
  readonly witnesses: { readonly from: Digest | null; readonly to: Digest | null };
}

export type AliasBody = Omit<BehaviorAlias, 'digest'>;

export function buildAlias(body: AliasBody): BehaviorAlias {
  return { ...body, digest: digestOf(body) };
}

export function verifyAlias(value: unknown): {
  readonly ok: boolean;
  readonly problems: readonly string[];
} {
  if (
    value === null ||
    typeof value !== 'object' ||
    !('kind' in value) ||
    value.kind !== 'behavior-alias'
  ) {
    return { ok: false, problems: ['not a behavior alias'] };
  }
  const alias = value as BehaviorAlias;
  const problems: string[] = [];
  try {
    const { digest, ...rest } = alias;
    if (digest !== digestOf(rest)) {
      problems.push('digest');
    }
    for (const id of [alias.from, alias.to]) {
      if (typeof id !== 'string' || id.length === 0 || id.length > 200) {
        problems.push('behavior id');
      }
    }
    if (alias.from === alias.to) {
      problems.push('an alias cannot point at itself');
    }
    if (alias.reason.trim() === '') {
      problems.push('an alias needs a reason');
    }
  } catch (error) {
    problems.push(`malformed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { ok: problems.length === 0, problems };
}

export interface AliasStep {
  readonly alias: Digest;
  readonly from: string;
  readonly to: string;
}

export interface AliasResolution {
  /** Every id connected to the asked id through recorded aliases, including itself. */
  readonly ids: readonly string[];
  /** The newest id, when the chain is unambiguous. */
  readonly current: string | null;
  /** Reasons the chain cannot be trusted: two successors for one id, or a cycle. */
  readonly conflicts: readonly string[];
}

function component(aliases: readonly BehaviorAlias[], id: string): string[] {
  const neighbours = new Map<string, Set<string>>();
  for (const { from, to } of aliases) {
    neighbours.set(from, (neighbours.get(from) ?? new Set()).add(to));
    neighbours.set(to, (neighbours.get(to) ?? new Set()).add(from));
  }
  const ids = new Set([id]);
  const queue = [id];
  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    for (const other of neighbours.get(next) ?? []) {
      if (!ids.has(other)) {
        ids.add(other);
        queue.push(other);
      }
    }
  }
  return [...ids].sort();
}

function successors(aliases: readonly BehaviorAlias[]): Map<string, Set<string>> {
  const edges = new Map<string, Set<string>>();
  for (const { from, to } of aliases) {
    edges.set(from, (edges.get(from) ?? new Set()).add(to));
  }
  return edges;
}

/** Follows the single chain of successors from an id, or explains why it cannot. */
function newest(
  edges: ReadonlyMap<string, ReadonlySet<string>>,
  start: string,
  members: readonly string[],
) {
  const conflicts = members
    .filter((member) => (edges.get(member) ?? new Set()).size > 1)
    .map(
      (member) =>
        `${member} has more than one successor: ${[...(edges.get(member) ?? [])].sort().join(', ')}`,
    );
  if (conflicts.length > 0) {
    return { current: null, conflicts };
  }
  const seen = new Set<string>();
  let current = start;
  for (;;) {
    const successor = [...(edges.get(current) ?? [])].at(0);
    if (successor === undefined) {
      break;
    }
    if (seen.has(current)) {
      return { current: null, conflicts: [`alias cycle through ${current}`] };
    }
    seen.add(current);
    current = successor;
  }
  return { current, conflicts: [] };
}

/** Resolves aliases without guessing: ambiguity is reported and nothing is merged around it. */
export function resolveAliases(aliases: readonly BehaviorAlias[], id: string): AliasResolution {
  const ids = component(aliases, id);
  const { current, conflicts } = newest(successors(aliases), id, ids);
  return { ids, current, conflicts };
}

/** The recorded aliases that connect two ids, in order; `null` when they are not connected. */
export function aliasPath(
  aliases: readonly BehaviorAlias[],
  a: string,
  b: string,
): readonly AliasStep[] | null {
  if (a === b) {
    return [];
  }
  const via = new Map<string, { readonly step: AliasStep; readonly before: string }>();
  const queue = [a];
  const seen = new Set([a]);
  for (let at = queue.shift(); at !== undefined; at = queue.shift()) {
    for (const alias of aliases) {
      const other = alias.from === at ? alias.to : alias.to === at ? alias.from : null;
      if (other !== null && !seen.has(other)) {
        seen.add(other);
        via.set(other, {
          step: { alias: alias.digest, from: alias.from, to: alias.to },
          before: at,
        });
        queue.push(other);
      }
    }
  }
  const steps: AliasStep[] = [];
  for (let hop = via.get(b); hop !== undefined; hop = via.get(hop.before)) {
    steps.unshift(hop.step);
  }
  return via.has(b) ? steps : null;
}
