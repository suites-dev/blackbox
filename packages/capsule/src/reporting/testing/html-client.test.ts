import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

import { capsuleActivityRowScript } from '../html/activities/row.js';

/** Runs `expression` after the client script's function declarations, in a fresh VM. */
function evaluate(script: string, expression: string): unknown {
  const context = { output: null as unknown };
  new Script(`${script}\noutput = ${expression};`).runInNewContext(context);
  return context.output;
}

describe('stdout and stderr retention text', () => {
  const complete = { kind: 'complete', originalBytes: 368 };
  const document = {
    activities: [{ activityId: 'a' }, { activityId: 'b' }],
    redactions: {
      entries: [
        { kind: 'sensitive-output', location: 'activities[1].outcome.stdout' },
        { kind: 'sensitive-output', location: 'activities[1].outcome.argv[7]' },
        { kind: 'sensitive-output', location: 'activities[0].outcome.process.stdout' },
      ],
    },
  };

  it('says what redaction rewrote instead of "retained completely"', () => {
    const text = (redactions: number) =>
      evaluate(
        capsuleActivityRowScript,
        `retentionText(${JSON.stringify(complete)}, ${String(redactions)})`,
      );
    expect(text(0)).toBe('368 bytes retained completely');
    expect(text(1)).toBe('368 original bytes retained · rewritten by 1 redaction');
    expect(text(2)).toBe('368 original bytes retained · rewritten by 2 redactions');
  });

  it('counts the redactions of one activity stream, for host and driver outcomes', () => {
    const counts = evaluate(
      capsuleActivityRowScript,
      `((d) => [
        streamRedactions(d, d.activities[1], 'stdout'),
        streamRedactions(d, d.activities[1], 'stderr'),
        streamRedactions(d, d.activities[0], 'stdout'),
      ])(${JSON.stringify(document)})`,
    );
    expect(counts).toEqual([1, 0, 1]);
  });
});
