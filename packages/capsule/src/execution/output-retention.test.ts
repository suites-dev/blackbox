import { describe, expect, it } from 'vitest';

import { createOutputRetention, retainedOutputText } from './output-retention.js';

describe('output retention', () => {
  it('retains small output exactly', () => {
    const retention = createOutputRetention();
    retention.append(Buffer.from('one'));
    retention.append(Buffer.from(' two'));

    expect(retention.finish()).toEqual({
      kind: 'complete',
      text: 'one two',
      originalBytes: 7,
    });
  });

  it('retains the first and last 512 KiB with explicit omission metadata', () => {
    const retention = createOutputRetention();
    retention.append(Buffer.alloc(524_288, 'a'));
    retention.append(Buffer.alloc(32, 'x'));
    retention.append(Buffer.alloc(524_288, 'z'));

    const output = retention.finish();
    expect(output.kind).toBe('truncated');
    expect(retainedOutputText(output)).toHaveLength(1_048_576);
    if (output.kind === 'truncated') {
      expect(output.head).toBe('a'.repeat(524_288));
      expect(output.tail).toBe('z'.repeat(524_288));
      expect(output.omittedBytes).toBe(32);
      expect(output.originalBytes).toBe(1_048_608);
    }
  });
});
