import { describe, expect, it } from 'vitest';

import { requestFixture } from '../../../envelope/testing/envelope.fixture.js';
import { stimulusSection } from '../envelope.js';

const sent = [{ title: 'When Alice subscribes', requests: [requestFixture()] }];

describe('the stimulus section of an envelope', () => {
  it('has a fingerprint when every request was summarized', () => {
    const section = stimulusSection({ stimuli: sent, unscoped: 0, opaque: 0 });
    expect(section.state).toBe('recorded');
    expect(section.fingerprint).not.toBeNull();
  });

  it('has none when a request was made outside every stimulus step, however many were scoped', () => {
    const section = stimulusSection({ stimuli: sent, unscoped: 1, opaque: 0 });
    expect(section).toMatchObject({ state: 'recorded', unscopedRequests: 1, fingerprint: null });
  });

  it('is recorded, not "none", when the only requests were outside a step', () => {
    expect(stimulusSection({ stimuli: [], unscoped: 2, opaque: 0 })).toMatchObject({
      state: 'recorded',
      fingerprint: null,
    });
  });

  it('has none when a request object could not be summarized', () => {
    expect(stimulusSection({ stimuli: sent, unscoped: 0, opaque: 1 }).fingerprint).toBeNull();
  });
});
