import { describe, expect, it } from 'vitest';

import { digestBytes } from '../../envelope/canonical.js';
import { inputFixture } from '../../envelope/testing/envelope.fixture.js';
import type { BehaviorIdentity } from '../../envelope/types.js';
import { compareSides } from '../compare.js';
import { checkOf } from './delta.fixture.js';
import {
  configurationFixture,
  healthy,
  requestFixture,
  sideFixture,
  stimulusFixture,
} from './compare.fixture.js';

const behavior = (id: string, derivedId = 'derived:aaaaaaaaaaaaaaaa'): BehaviorIdentity => ({
  id,
  basis: 'derived',
  derivedId,
  declaration: { state: 'absent' },
});

describe('comparability comes before comparison', () => {
  it('finds no difference between two equivalent healthy attempts and says the experiment is identical', () => {
    const delta = compareSides(
      sideFixture({ spans: healthy }),
      sideFixture({ spans: healthy, attemptId: 'attempt-2' }),
    );
    expect(delta.outcome).toBe('no-observed-difference');
    expect(delta.comparability.level).toBe('identical-experiment');
    expect(delta.drift).toEqual({ effects: [], state: [] });
    expect(delta.reference.attemptId).not.toBe(delta.head.attemptId);
  });

  it('refuses to compare different scenarios and produces no drift', () => {
    const delta = compareSides(
      sideFixture({ spans: healthy, behavior: behavior('subscription.create') }),
      sideFixture({ spans: [...healthy, ...healthy], behavior: behavior('subscription.cancel') }),
    );
    expect(delta.outcome).toBe('invalid');
    expect(delta.comparability.level).toBe('incomparable');
    expect(delta.drift.effects).toEqual([]);
    expect(checkOf(delta, 'behavior').result).toBe('differs');
  });

  it('notes a declared id that shares a derived id with an undeclared one, without merging them', () => {
    const delta = compareSides(
      sideFixture({
        spans: healthy,
        behavior: behavior('subscription.create', 'derived:bbbbbbbbbbbbbbbb'),
      }),
      sideFixture({
        spans: healthy,
        behavior: behavior('derived:bbbbbbbbbbbbbbbb', 'derived:bbbbbbbbbbbbbbbb'),
      }),
    );
    expect(delta.outcome).toBe('invalid');
    expect(checkOf(delta, 'behavior').detail).toContain('same derived id');
  });

  it('refuses a different system', () => {
    const base = inputFixture().system;
    const delta = compareSides(
      sideFixture({ spans: healthy }),
      sideFixture({
        spans: healthy,
        system: { ...base, catalogEntry: { id: 'other', kind: 'system' } },
      }),
    );
    expect(delta.outcome).toBe('invalid');
  });

  it('refuses different stimulus inputs instead of attributing the difference to the system', () => {
    const other = stimulusFixture([requestFixture({ body: digestBytes('body-bob') })]);
    const delta = compareSides(
      sideFixture({ spans: healthy }),
      sideFixture({ spans: [...healthy, ...healthy], stimulus: other }),
    );
    expect(delta.outcome).toBe('invalid');
    expect(checkOf(delta, 'stimulus').result).toBe('differs');
    expect(delta.drift.effects).toEqual([]);
  });

  it('never assumes identical inputs: an unrecorded stimulus caps the result at inconclusive', () => {
    const unknown = {
      ...stimulusFixture(),
      state: 'unavailable' as const,
      activities: [],
      fingerprint: null,
    };
    const delta = compareSides(
      sideFixture({ spans: healthy, stimulus: unknown }),
      sideFixture({ spans: healthy, stimulus: unknown }),
    );
    expect(delta.outcome).toBe('inconclusive');
    expect(delta.unresolved.map(({ kind }) => kind)).toContain('stimulus-unestablished');
  });
});

describe('configuration changes are assessed, not ignored', () => {
  it('treats a changed instrumentation as a change of the measurement and keeps the difference unresolved', () => {
    const delta = compareSides(
      sideFixture({ spans: healthy }),
      sideFixture({
        spans: [...healthy, ...healthy],
        configuration: configurationFixture({ activation: 'activation-v2' }),
      }),
    );
    expect(delta.outcome).toBe('inconclusive');
    expect(checkOf(delta, 'measurement-basis').detail).toContain('instrumentation');
    expect(delta.drift.effects.length).toBeGreaterThan(0);
    expect(delta.unresolved.map(({ kind }) => kind)).toContain('measurement-basis-differs');
  });

  it('allows a catalog change but marks the comparison as compatible, not identical', () => {
    const delta = compareSides(
      sideFixture({ spans: healthy }),
      sideFixture({
        spans: [...healthy, ...healthy],
        configuration: configurationFixture({ compose: 'compose-v2' }),
      }),
    );
    expect(delta.outcome).toBe('observed-difference');
    expect(delta.comparability.level).toBe('compatible');
    expect(checkOf(delta, 'catalog').result).toBe('differs');
  });

  it('records an environment change without inventing a difference', () => {
    const delta = compareSides(
      sideFixture({ spans: healthy }),
      sideFixture({ spans: healthy, configuration: configurationFixture({ node: 'v22.9.0' }) }),
    );
    expect(delta.outcome).toBe('no-observed-difference');
    expect(checkOf(delta, 'environment').result).toBe('differs');
    expect(delta.comparability.level).toBe('compatible');
  });

  it('associates revisions without claiming a cause', () => {
    const delta = compareSides(sideFixture({ spans: healthy }), sideFixture({ spans: healthy }));
    expect(delta.association.level).toBe(1);
    expect(delta.association.note).toContain('not evidence');
  });
});
