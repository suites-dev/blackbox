import { describe, expect, it } from 'vitest';

import { stateSection } from './state.js';

const annotation = (value: unknown) => ({ type: 'bb:state', description: JSON.stringify(value) });

describe('reported state', () => {
  it('reduces identities to digests and counts them as reported', () => {
    const section = stateSection([
      annotation({
        subject: 'payment-intents',
        source: 'fixture',
        identities: ['pi_1', 'pi_2', 'pi_2'],
      }),
    ]);
    const [record] = section.records;
    expect(record).toMatchObject({ subject: 'payment-intents', count: 3, distinct: 2 });
    expect(JSON.stringify(section)).not.toContain('pi_1');
  });

  it('is the same for the same identities in any order and different for different identities', () => {
    const one = stateSection([annotation({ subject: 's', source: 'x', identities: ['a', 'b'] })]);
    const two = stateSection([annotation({ subject: 's', source: 'x', identities: ['b', 'a'] })]);
    const three = stateSection([annotation({ subject: 's', source: 'x', identities: ['a', 'c'] })]);
    expect(two.records[0].digest).toBe(one.records[0].digest);
    expect(three.records[0].digest).not.toBe(one.records[0].digest);
  });

  it('counts malformed or repeated reports as rejected instead of guessing', () => {
    const section = stateSection([
      { type: 'bb:state', description: 'not json' },
      annotation({ subject: 'Bad Subject', source: 'x', identities: [] }),
      annotation({ subject: 'ok', source: 'x', identities: ['1'] }),
      annotation({ subject: 'ok', source: 'x', identities: ['1', '2'] }),
      { type: 'other', description: '{}' },
    ]);
    expect(section.records.map(({ subject }) => subject)).toEqual(['ok']);
    expect(section.rejected).toBe(3);
  });
});
