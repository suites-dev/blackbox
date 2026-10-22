import type { Digest } from '../envelope/index.js';
import type { AnyEnvelope } from './history-types.js';
import type { HistoryIndex } from './storage/index-build.js';
import type { HistoryEntry } from './queries.js';

/** The part of the history that findings are read from; declared here so the history can depend on this module. */
export interface FindingsSource {
  behaviorHistory(
    id: string,
    options: { readonly followAliases: boolean },
  ): Promise<HistoryEntry[]>;
  execution(id: Digest): Promise<{ readonly envelope: AnyEnvelope } | null>;
  index(): Promise<HistoryIndex>;
}

export interface AssertionFinding {
  readonly envelopeId: Digest;
  readonly attemptId: string;
  readonly retry: number;
  readonly sequence: number;
  readonly outcome: string;
  readonly evaluation: string;
  readonly contractDigest: Digest;
  /** The assertion's own evidence body. */
  readonly evidence: Digest;
}

export interface ComparisonFinding {
  readonly delta: Digest;
  readonly outcome: string;
  readonly reference: Digest;
  readonly head: Digest;
  readonly refutedClaims: readonly string[];
  readonly unresolved: number;
}

export interface Findings {
  /** Attempts that ended badly or left no behavioral evidence. */
  readonly attempts: readonly HistoryEntry[];
  /** Assertions that failed or could not be decided, per execution. */
  readonly assertions: readonly AssertionFinding[];
  /** Stored comparisons that involve this behavior and refuted a claim or left something unresolved. */
  readonly comparisons: readonly ComparisonFinding[];
}

const sound = new Set(['passed', 'skipped']);

/** Failed and unresolved findings for one behavior, each linked to the record that holds its evidence. */
export async function collectFindings(
  history: FindingsSource,
  id: string,
  options: { readonly followAliases: boolean },
): Promise<Findings> {
  const entries = await history.behaviorHistory(id, options);
  const attempts = entries.filter(
    (entry) =>
      entry.kind === 'attempt-without-evidence' ||
      !sound.has(entry.status) ||
      entry.receiptStatus === 'completed-without-evidence',
  );
  const assertions: AssertionFinding[] = [];
  for (const entry of entries) {
    if (entry.envelopeId === null) {
      continue;
    }
    const detail = await history.execution(entry.envelopeId);
    if (detail === null) {
      continue;
    }
    for (const assertion of detail.envelope.verification.assertions.filter(
      ({ outcome }) => outcome !== 'passed',
    )) {
      assertions.push({
        envelopeId: entry.envelopeId,
        attemptId: detail.envelope.identity.attempt.attemptId,
        retry: detail.envelope.identity.attempt.retry,
        ...assertion,
      });
    }
  }
  const mine = new Set(
    entries.flatMap(({ envelopeId }) => (envelopeId === null ? [] : [envelopeId])),
  );
  const comparisons = (await history.index()).deltas
    .filter(
      (delta) =>
        (mine.has(delta.reference.envelope) || mine.has(delta.head.envelope)) &&
        (delta.refutedClaims.length > 0 || delta.unresolved > 0),
    )
    .map((delta) => ({
      delta: delta.id,
      outcome: delta.outcome,
      reference: delta.reference.envelope,
      head: delta.head.envelope,
      refutedClaims: delta.refutedClaims,
      unresolved: delta.unresolved,
    }));
  return { attempts, assertions, comparisons };
}
