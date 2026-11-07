import { test, type TestInfo } from '@playwright/test';

function current(): TestInfo | null {
  try { return test.info(); }
  catch { return null; }
}

/** Public TestInfo identity prevents a still-retained recorder crossing a physical test attempt. */
export function effectAttemptOwner(): () => string | null {
  const owner = current();
  return () => owner !== null && current() !== owner
    ? 'The effect recorder belongs to another Playwright attempt.' : null;
}
