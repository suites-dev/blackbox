import { digestOf, type canonicalization, type Digest } from '../../envelope/canonical.js';
import type { BehaviorIdentity } from '../../envelope/types.js';

export const receiptVersion = 1;

export type LifecycleState =
  | 'scheduled'
  | 'acquisition-failed'
  | 'execution-started'
  | 'execution-completed'
  | 'execution-interrupted'
  | 'evidence-unavailable';

export interface LifecycleEvent {
  readonly state: LifecycleState;
  readonly at: string;
  /** A short, redacted reason; empty when there is nothing to add. */
  readonly detail: string;
}

/**
 * What is known about one physical attempt, including an attempt that never reached a sandbox. It carries no
 * observations: an attempt that failed before acquisition has a receipt and no envelope, never an empty record.
 */
export interface AttemptReceipt {
  readonly receiptVersion: typeof receiptVersion;
  readonly kind: 'attempt-receipt';
  readonly canonicalization: typeof canonicalization;
  readonly digest: Digest;
  readonly attempt: {
    readonly receiptId: string;
    readonly retry: number;
    readonly retries: number;
    readonly workerIndex: number;
    readonly parallelIndex: number;
    /** `null` until a sandbox exists. */
    readonly sandboxId: string | null;
  };
  readonly test: {
    readonly runnerTestId: string;
    readonly file: string;
    readonly titlePath: readonly string[];
    readonly project: string;
  };
  readonly system: { readonly catalogEntryId: string };
  readonly behavior: BehaviorIdentity;
  /** Ties attempts of one Playwright invocation together; `null` when no invocation id was available. */
  readonly invocation: string | null;
  readonly lifecycle: readonly LifecycleEvent[];
  readonly outcome: {
    readonly testStatus: string;
    readonly expectedStatus: string;
    readonly errorCount: number;
  };
  readonly failure: { readonly phase: string; readonly message: string } | null;
  /** The envelope this attempt produced; `null` when none exists. */
  readonly envelope: Digest | null;
}

export type ReceiptBody = Omit<AttemptReceipt, 'digest'>;

export function receiptDigest(body: object): Digest {
  return digestOf(body);
}

export function buildReceipt(body: ReceiptBody): AttemptReceipt {
  return { ...body, digest: receiptDigest(body) };
}

const terminal = new Set<LifecycleState>([
  'acquisition-failed',
  'execution-completed',
  'execution-interrupted',
]);

function lifecycleProblems(receipt: AttemptReceipt): string[] {
  const problems: string[] = [];
  const states = receipt.lifecycle.map(({ state }) => state);
  if (states[0] !== 'scheduled') {
    problems.push('lifecycle must start as scheduled');
  }
  if (states.filter((state) => terminal.has(state)).length > 1) {
    problems.push('lifecycle has more than one ending');
  }
  if (states.includes('acquisition-failed')) {
    problems.push(...acquisitionProblems(receipt, states));
  }
  if (states.includes('execution-started') && receipt.attempt.sandboxId === null) {
    problems.push('a started execution needs a sandbox id');
  }
  if (states.includes('evidence-unavailable') && receipt.envelope !== null) {
    problems.push('evidence marked unavailable cannot point at an envelope');
  }
  return problems;
}

function acquisitionProblems(receipt: AttemptReceipt, states: readonly LifecycleState[]) {
  const problems: string[] = [];
  if (states.some((state) => state.startsWith('execution-') || state === 'evidence-unavailable')) {
    problems.push('an attempt that failed to acquire cannot have executed');
  }
  if (receipt.attempt.sandboxId !== null || receipt.envelope !== null) {
    problems.push('an attempt that failed to acquire has no sandbox and no envelope');
  }
  if (receipt.failure === null) {
    problems.push('an acquisition failure needs a failure');
  }
  return problems;
}

/**
 * Checks the invariants that keep a receipt honest: it starts as scheduled, has at most one ending, never claims
 * an execution for an attempt that failed to acquire, and never points at evidence it says is unavailable.
 */
export function verifyReceipt(value: unknown): {
  readonly ok: boolean;
  readonly problems: readonly string[];
} {
  if (
    value === null ||
    typeof value !== 'object' ||
    !('kind' in value) ||
    value.kind !== 'attempt-receipt' ||
    !('receiptVersion' in value) ||
    value.receiptVersion !== receiptVersion
  ) {
    return { ok: false, problems: ['not a supported attempt receipt'] };
  }
  const receipt = value as AttemptReceipt;
  const problems: string[] = [];
  try {
    const { digest, ...rest } = receipt;
    if (digest !== receiptDigest(rest)) {
      problems.push('digest');
    }
    problems.push(...lifecycleProblems(receipt));
  } catch (error) {
    problems.push(`malformed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { ok: problems.length === 0, problems };
}

export type ReceiptStatus =
  | 'acquisition-failed'
  | 'completed'
  | 'completed-without-evidence'
  | 'interrupted'
  | 'interrupted-without-evidence'
  | 'incomplete';

/** The one word a reader needs: how this attempt ended and whether it left behavioral evidence. */
export function receiptStatus(receipt: AttemptReceipt): ReceiptStatus {
  const states = receipt.lifecycle.map(({ state }) => state);
  if (states.includes('acquisition-failed')) {
    return 'acquisition-failed';
  }
  const withEvidence = receipt.envelope !== null;
  if (states.includes('execution-interrupted')) {
    return withEvidence ? 'interrupted' : 'interrupted-without-evidence';
  }
  if (states.includes('execution-completed')) {
    return withEvidence ? 'completed' : 'completed-without-evidence';
  }
  return 'incomplete';
}
