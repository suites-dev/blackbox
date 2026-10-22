import { describe, expect, it } from 'vitest';

import { behaviorAnnotation, behaviorIdentity, derivedBehaviorId } from '../behavior.js';

const base = {
  annotations: [],
  catalogEntryId: 'system',
  project: 'default',
  titlePath: ['Rule: subscriptions', 'Scenario: create'],
};
const declare = (description: string) => ({ type: behaviorAnnotation, description });

describe('behavior identity', () => {
  it('uses a declared id and still records the derived one', () => {
    const identity = behaviorIdentity({ ...base, annotations: [declare('subscription.create')] });
    expect(identity).toMatchObject({
      id: 'subscription.create',
      basis: 'declared',
      declaration: { state: 'declared' },
    });
    expect(identity.derivedId).toBe(derivedBehaviorId(base));
  });

  it('keeps a declared id across a rename and a derived id only across a move', () => {
    const renamed = {
      ...base,
      titlePath: ['Rule: subscriptions', 'Scenario: create a subscription'],
    };
    expect(behaviorIdentity({ ...renamed, annotations: [declare('subscription.create')] }).id).toBe(
      'subscription.create',
    );
    expect(derivedBehaviorId(renamed)).not.toBe(derivedBehaviorId(base));
    // The file is not an input, so a moved test keeps its derived id.
    expect(derivedBehaviorId({ ...base })).toBe(derivedBehaviorId(base));
  });

  it('never merges a rename silently: a renamed undeclared test is a new behavior', () => {
    const before = behaviorIdentity(base);
    const after = behaviorIdentity({
      ...base,
      titlePath: ['Rule: subscriptions', 'Scenario: create again'],
    });
    expect(after.basis).toBe('derived');
    expect(after.id).not.toBe(before.id);
  });

  it('separates the same title on a different system or project', () => {
    expect(derivedBehaviorId({ ...base, catalogEntryId: 'other' })).not.toBe(
      derivedBehaviorId(base),
    );
    expect(derivedBehaviorId({ ...base, project: 'chromium' })).not.toBe(derivedBehaviorId(base));
  });

  it('rejects malformed or repeated declarations instead of guessing', () => {
    expect(behaviorIdentity({ ...base, annotations: [declare('Not A Slug')] })).toMatchObject({
      basis: 'derived',
      declaration: { state: 'rejected', reason: 'invalid-id' },
    });
    expect(
      behaviorIdentity({ ...base, annotations: [declare('a.b'), declare('a.c')] }),
    ).toMatchObject({
      basis: 'derived',
      declaration: { state: 'rejected', reason: 'multiple-declarations' },
    });
  });
});
