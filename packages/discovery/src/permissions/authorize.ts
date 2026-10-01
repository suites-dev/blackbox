import type { Action, Approval } from '../model/evidence.js';

export type Authorization =
  | Readonly<{ kind: 'approved'; approvalId: string }>
  | Readonly<{ kind: 'blocked'; reason: string }>;

/** The caller supplies authenticated approvals. Audit text cannot grant itself permission. */
export function authorize(
  input: Readonly<{
    action: Action;
    scope: string;
    now: string;
    approvals: readonly Approval[];
  }>,
): Authorization {
  const now = Date.parse(input.now);
  const matching = input.approvals.filter(
    (item) => item.action === input.action && item.scope === input.scope,
  );
  if (
    !Number.isFinite(now) ||
    matching.some((item) => !Number.isFinite(Date.parse(item.requestedAt)))
  ) {
    return { kind: 'blocked', reason: 'Authorization timestamps are invalid.' };
  }
  matching.sort((left, right) => Date.parse(right.requestedAt) - Date.parse(left.requestedAt));
  const latest = matching.at(0);
  if (latest === undefined || latest.kind !== 'approved') {
    return {
      kind: 'blocked',
      reason: 'No current explicit approval for this action and exact scope.',
    };
  }
  const expiry = Date.parse(latest.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= now || Date.parse(latest.requestedAt) > now) {
    return { kind: 'blocked', reason: 'Approval is expired or has invalid temporal scope.' };
  }
  const ties = matching.filter(
    (item) => Date.parse(item.requestedAt) === Date.parse(latest.requestedAt),
  );
  if (ties.length !== 1) {
    return { kind: 'blocked', reason: 'Ambiguous approvals require clarification.' };
  }
  return { kind: 'approved', approvalId: latest.id };
}
