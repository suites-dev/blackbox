import { describe, expect, it } from 'vitest';

import { managerTermination } from './manager-termination.js';

describe('manager termination', () => {
  it('distinguishes a live manager from exit and signal completion', () => {
    expect(managerTermination({ exitCode: null, signalCode: null })).toEqual({
      kind: 'manager-running',
    });
    expect(managerTermination({ exitCode: 137, signalCode: null })).toMatchObject({
      kind: 'manager-terminated',
      error: { name: 'CapsuleManagerExit', message: expect.stringContaining('137') },
    });
    expect(managerTermination({ exitCode: null, signalCode: 'SIGTERM' })).toMatchObject({
      kind: 'manager-terminated',
      error: { name: 'CapsuleManagerSignal', message: expect.stringContaining('SIGTERM') },
    });
  });
});
