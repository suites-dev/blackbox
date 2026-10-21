import { digestOf } from './canonical.js';
import type { BehaviorIdentity } from './types.js';

export const behaviorAnnotation = 'bb:behavior';

// Lower-case dot-separated segments, for example `subscription.create`: a name, not a title or a path.
const declaredId = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/u;

export interface BehaviorInput {
  readonly annotations: readonly { readonly type: string; readonly description: string }[];
  readonly catalogEntryId: string;
  readonly project: string;
  /** Describe titles followed by the test title, without the file. */
  readonly titlePath: readonly string[];
}

/**
 * The derived id hashes the system, the project and the title path. The file is excluded so a moved test
 * keeps it, and the titles are included so a renamed test does not silently keep it: a rename without a
 * declared id starts a new behavior until a person records an alias.
 */
export function derivedBehaviorId(input: BehaviorInput): string {
  const digest = digestOf({
    scheme: 'derived-1',
    system: input.catalogEntryId,
    project: input.project,
    titlePath: input.titlePath,
  });
  return `derived:${digest.slice('sha256:'.length, 'sha256:'.length + 16)}`;
}

export function behaviorIdentity(input: BehaviorInput): BehaviorIdentity {
  const derivedId = derivedBehaviorId(input);
  const declarations = input.annotations.filter(({ type }) => type === behaviorAnnotation);
  if (declarations.length === 0) {
    return { id: derivedId, basis: 'derived', derivedId, declaration: { state: 'absent' } };
  }
  const [only] = declarations;
  if (declarations.length > 1) {
    return {
      id: derivedId,
      basis: 'derived',
      derivedId,
      declaration: { state: 'rejected', reason: 'multiple-declarations' },
    };
  }
  const id = only.description.trim();
  if (!declaredId.test(id)) {
    return {
      id: derivedId,
      basis: 'derived',
      derivedId,
      declaration: { state: 'rejected', reason: 'invalid-id' },
    };
  }
  return { id, basis: 'declared', derivedId, declaration: { state: 'declared' } };
}
