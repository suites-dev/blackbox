import { afterEach, expect, it, vi } from 'vitest';

import {
  DriverPreparationTimeoutError,
  driverPreparationTimeoutMs,
  withDriverPreparationTimeout,
} from './timeout.js';

afterEach(() => vi.useRealTimers());

it('uses the fixed five-second preparation deadline', async () => {
  vi.useFakeTimers();
  const never = new Promise<string>(() => undefined);
  const result = withDriverPreparationTimeout(never);
  const rejection = expect(result).rejects.toBeInstanceOf(DriverPreparationTimeoutError);
  await vi.advanceTimersByTimeAsync(driverPreparationTimeoutMs);
  await rejection;
});

it('clears the deadline after successful preparation', async () => {
  await expect(withDriverPreparationTimeout(Promise.resolve('prepared'))).resolves.toBe(
    'prepared',
  );
});
