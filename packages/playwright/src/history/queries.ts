import type { Digest } from '../envelope/canonical.js';
import { resolveAliases } from './alias.js';
import type { HistoryIndex, IndexedExecution, IndexedReceipt } from './index-build.js';
import type { ReceiptStatus } from './receipt.js';

export interface HistoryEntry {
  readonly kind: 'execution' | 'attempt-without-evidence';
  readonly at: string;
  readonly behaviorId: string;
  readonly via: 'behavior-id' | 'alias' | 'derived-id';
  readonly attemptId: string | null;
  readonly retry: number;
  readonly invocation: string | null;
  readonly status: string;
  readonly envelopeId: Digest | null;
  readonly receiptId: Digest | null;
  readonly receiptStatus: ReceiptStatus | null;
  readonly failure: IndexedReceipt['failure'];
  readonly source: IndexedExecution['source'] | null;
  readonly configuration: Digest | null;
  readonly experiment: Digest | null;
  readonly stimulus: Digest | null;
  readonly observation: Digest | null;
  readonly completeness: string | null;
  readonly snapshot: IndexedExecution['snapshot'] | null;
  /** The commit differs from the previous execution that recorded one. */
  readonly revisionChanged: boolean;
  /** The same tree (identical content) was already seen at a different commit. */
  readonly treeSeenBefore: boolean;
}

export interface BehaviorSummary {
  readonly behaviorId: string;
  readonly basis: string;
  readonly derivedIds: readonly string[];
  readonly executions: number;
  readonly attemptsWithoutEvidence: number;
  readonly firstAt: string;
  readonly lastAt: string;
  readonly revisions: number;
  readonly aliasedFrom: readonly string[];
  readonly aliasedTo: string | null;
}

/** Receipts that have no stored envelope belong to a behavior by id, or by derived id when exactly one declared id has it. */
function effectiveId(
  receipt: IndexedReceipt,
  derived: ReadonlyMap<string, ReadonlySet<string>>,
): { id: string; via: HistoryEntry['via'] } {
  const candidates =
    receipt.basis === 'derived'
      ? (derived.get(receipt.derivedId) ?? new Set<string>())
      : new Set<string>();
  if (candidates.size === 1) {
    const [only] = [...candidates];
    return { id: only, via: only === receipt.behaviorId ? 'behavior-id' : 'derived-id' };
  }
  return { id: receipt.behaviorId, via: 'behavior-id' };
}

function derivedMap(index: HistoryIndex): ReadonlyMap<string, ReadonlySet<string>> {
  const map = new Map<string, Set<string>>();
  for (const { derivedId, behaviorId } of index.executions) {
    map.set(derivedId, (map.get(derivedId) ?? new Set()).add(behaviorId));
  }
  return map;
}

type Draft = Omit<HistoryEntry, 'revisionChanged' | 'treeSeenBefore'>;

function executionEntry(
  run: IndexedExecution,
  id: string,
  receipt: IndexedReceipt | undefined,
): Draft {
  return {
    kind: 'execution',
    at: run.capturedAt,
    behaviorId: run.behaviorId,
    via: run.behaviorId === id ? 'behavior-id' : 'alias',
    attemptId: run.attemptId,
    retry: run.retry,
    invocation: run.invocation,
    status: run.testStatus,
    envelopeId: run.envelopeId,
    receiptId: receipt === undefined ? null : receipt.id,
    receiptStatus: receipt === undefined ? null : receipt.status,
    failure: receipt === undefined ? null : receipt.failure,
    source: run.source,
    configuration: run.configuration,
    experiment: run.experiment,
    stimulus: run.stimulus,
    observation: run.observation,
    completeness: run.completeness,
    snapshot: run.snapshot,
  };
}

function attemptEntry(
  receipt: IndexedReceipt,
  mine: { id: string; via: HistoryEntry['via'] },
  asked: string,
): Draft {
  return {
    kind: 'attempt-without-evidence',
    at: receipt.at,
    behaviorId: mine.id,
    via: mine.id === asked ? mine.via : 'alias',
    attemptId: receipt.sandboxId,
    retry: receipt.retry,
    invocation: receipt.invocation,
    status: receipt.status,
    envelopeId: null,
    receiptId: receipt.id,
    receiptStatus: receipt.status,
    failure: receipt.failure,
    source: null,
    configuration: null,
    experiment: null,
    stimulus: null,
    observation: null,
    completeness: null,
    snapshot: null,
  };
}

const key = (entry: Draft): string => entry.attemptId ?? entry.receiptId ?? '';

function chronological(a: Draft, b: Draft): number {
  if (a.at !== b.at) {
    return a.at < b.at ? -1 : 1;
  }
  return key(a) < key(b) ? -1 : 1;
}

/** Marks where the commit changed and where content that was seen before came back under another commit. */
function annotate(entries: readonly Draft[]): HistoryEntry[] {
  const trees = new Map<string, string>();
  let previous: string | null = null;
  return entries.map((entry) => {
    const { source } = entry;
    const commit = source === null ? null : source.commit;
    const tree = source === null ? null : source.tree;
    const revisionChanged = commit !== null && previous !== null && commit !== previous;
    const treeSeenBefore = tree !== null && trees.has(tree) && trees.get(tree) !== commit;
    if (commit !== null) {
      previous = commit;
      if (tree !== null && !trees.has(tree)) {
        trees.set(tree, commit);
      }
    }
    return { ...entry, revisionChanged, treeSeenBefore };
  });
}

export function behaviorHistory(
  index: HistoryIndex,
  id: string,
  followAliases: boolean,
): HistoryEntry[] {
  const ids = new Set(followAliases ? resolveAliases(index.aliases, id).ids : [id]);
  const derived = derivedMap(index);
  const joined = new Map(
    index.receipts.flatMap((receipt) =>
      receipt.envelope === null ? [] : [[receipt.envelope, receipt] as const],
    ),
  );
  const stored = new Set(index.executions.map(({ envelopeId }) => envelopeId));
  const entries: Draft[] = index.executions
    .filter(({ behaviorId }) => ids.has(behaviorId))
    .map((run) => executionEntry(run, id, joined.get(run.envelopeId)));
  for (const receipt of index.receipts.filter(
    ({ envelope }) => envelope === null || !stored.has(envelope),
  )) {
    const mine = effectiveId(receipt, derived);
    if (ids.has(mine.id)) {
      entries.push(attemptEntry(receipt, mine, id));
    }
  }
  return annotate(entries.sort(chronological));
}

function aliasTarget(index: HistoryIndex, id: string): string | null {
  const found = index.aliases.find(({ from }) => from === id);
  return found === undefined ? null : found.to;
}

export function behaviorSummaries(index: HistoryIndex): BehaviorSummary[] {
  const ids = new Set(index.executions.map(({ behaviorId }) => behaviorId));
  const derived = derivedMap(index);
  const stored = new Set(index.executions.map(({ envelopeId }) => envelopeId));
  for (const receipt of index.receipts.filter(
    ({ envelope }) => envelope === null || !stored.has(envelope),
  )) {
    ids.add(effectiveId(receipt, derived).id);
  }
  return [...ids].sort().map((id) => {
    const entries = behaviorHistory(index, id, false);
    const mine = index.executions.filter(({ behaviorId }) => behaviorId === id);
    return {
      behaviorId: id,
      basis: mine.length > 0 ? mine[0].basis : 'derived',
      derivedIds: [...new Set(mine.map(({ derivedId }) => derivedId))].sort(),
      executions: entries.filter(({ kind }) => kind === 'execution').length,
      attemptsWithoutEvidence: entries.filter(({ kind }) => kind === 'attempt-without-evidence')
        .length,
      firstAt: entries.length > 0 ? entries[0].at : '',
      lastAt: entries.length > 0 ? entries[entries.length - 1].at : '',
      revisions: new Set(
        entries.flatMap(({ source }) =>
          source === null || source.commit === null ? [] : [source.commit],
        ),
      ).size,
      aliasedFrom: index.aliases
        .filter(({ to }) => to === id)
        .map(({ from }) => from)
        .sort(),
      aliasedTo: aliasTarget(index, id),
    };
  });
}
