import { expect, it } from 'vitest';

import { managerRequest } from '../../ipc/client.js';
import { readCapsuleActivities } from '../../records.js';
import { requestFixture } from './request.fixture.js';

it('rejects an invalid activity name before retaining an activity', async () => {
  const fixture = await requestFixture(() => Promise.resolve());
  try {
    const response = await managerRequest({
      socketPath: fixture.socketPath,
      request: {
        kind: 'exec-request',
        requestId: 'invalid-name',
        name: { kind: 'provided', value: '   ' },
        purpose: 'stimulus',
        target: { kind: 'host', argv: ['true'] },
      },
    });
    expect(response).toMatchObject({
      kind: 'manager-error-response',
      error: { message: 'Capsule activity name must contain non-whitespace text' },
    });
    expect(await readCapsuleActivities(fixture)).toEqual([]);
  } finally {
    await fixture.close();
  }
});
