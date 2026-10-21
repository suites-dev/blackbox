import { digestBytes } from '../envelope/canonical.js';
import { currentEvidenceDigest, evidencePathInside } from '../envelope/capture/evidence.js';
import type { AnyEnvelope, EvidenceCheck } from './history-types.js';
import type { ObjectStore } from './storage/store.js';

/**
 * Where each piece of an execution's evidence stands: stored in the history and matching, re-verified against the
 * retained files under `root`, or simply referenced. A reference is never reported as verified without a check.
 */
export async function checkEvidence(
  store: ObjectStore,
  envelope: AnyEnvelope,
  root: string | null,
): Promise<EvidenceCheck[]> {
  const checks: EvidenceCheck[] = [];
  for (const ref of envelope.evidence) {
    const bytes = await store.get('blob', ref.id);
    const base = { kind: ref.kind, id: ref.id, locator: ref.locator };
    if (bytes !== null && digestBytes(bytes) === ref.id) {
      checks.push({ ...base, status: 'stored' });
    } else if (root !== null && ref.locator.type === 'file') {
      if ((await evidencePathInside(root, ref.locator.path)) === null) {
        checks.push({ ...base, status: 'refused' });
        continue;
      }
      const current = await currentEvidenceDigest(root, ref);
      checks.push({
        ...base,
        status: current === null ? 'missing' : current === ref.id ? 'verified' : 'mismatch',
      });
    } else {
      checks.push({ ...base, status: 'not-checked' });
    }
  }
  return checks;
}
