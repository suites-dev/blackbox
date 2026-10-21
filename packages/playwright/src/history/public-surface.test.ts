import { describe, expect, it } from 'vitest';

import * as history from './index.js';

describe('the public history entry point', () => {
  it('exposes exactly the deliberate runtime surface', () => {
    expect(Object.keys(history).sort()).toEqual([
      'BehaviorHistory',
      'ConflictError',
      'HistoryError',
      'ingestPlaywrightResults',
    ]);
  });
});
