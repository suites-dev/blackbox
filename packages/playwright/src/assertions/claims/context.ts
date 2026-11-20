import { AsyncLocalStorage } from 'node:async_hooks';
import type { Digest } from '../../envelope/index.js';

interface Snapshot { matcher: string; status: 'passed' | 'failed' | 'unknown' }
interface Claim { readonly id: string; active: boolean; readonly snapshots: Snapshot[] }
const claims = new AsyncLocalStorage<Claim>();
const active = new Map<string, Claim>();
export function withClaim<T>(claimId: string, callback: () => T): T {
  const claim = { id: claimId, active: true, snapshots: [] } satisfies Claim;
  active.set(claimId, claim);
  return claims.run(claim, callback);
}
export function currentClaim(): string | undefined {
  const claim = claims.getStore();
  return claim !== undefined && claim.active ? claim.id : undefined;
}
export function recordSnapshot(matcher: string, status: 'passed' | 'failed' | 'unknown'): void {
  if (matcher !== 'toMatchSnapshot' && matcher !== 'toHaveScreenshot') { return; }
  const claim = claims.getStore();
  if (claim !== undefined && claim.active) { claim.snapshots.push({ matcher, status }); }
}
export function takeSnapshots(claimId: string): readonly { matcher: string; status: 'passed' | 'failed' | 'unknown' }[] {
  const claim = active.get(claimId);
  if (claim === undefined) { return []; }
  claim.active = false;
  active.delete(claimId);
  return claim.snapshots;
}
const evidence = new WeakMap<object, Map<string, Digest[]>>();
export function linkClaim(owner: object, digest: Digest): void {
  const claim = currentClaim();
  if (claim === undefined) { return; }
  let entries = evidence.get(owner);
  if (entries === undefined) { entries = new Map(); evidence.set(owner, entries); }
  entries.set(claim, [...(entries.get(claim) ?? []), digest]);
}
export function evidenceForClaim(owner: object, claimId: string): readonly Digest[] {
  const entries = evidence.get(owner);
  return entries === undefined ? [] : entries.get(claimId) ?? [];
}
