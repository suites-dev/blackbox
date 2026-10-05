import type { CapsuleEntrypoint } from '../model/environment.js';

export { runHost, runHostWithInteraction, runHostWithRedaction } from './host/process.js';

/** Probes identify themselves, so reports can tell them from application traffic. */
export const READINESS_USER_AGENT = 'blackbox-readiness/1';
/** The wait after a failed probe doubles from 200 ms up to this, so a slow start is not flooded. */
const MAX_READINESS_RETRY_MS = 1_000;

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export async function awaitReadiness(input: {
  readonly entrypoint: CapsuleEntrypoint;
  readonly path: string;
  readonly timeoutMs: number;
}): Promise<void> {
  const deadline = Date.now() + input.timeoutMs;
  const url = new URL(input.path, `${input.entrypoint.url}/`);
  let lastError = new Error('Readiness endpoint was not attempted');
  let retryMs = 200;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(2_000),
        headers: { 'user-agent': READINESS_USER_AGENT },
      });
      if (response.ok) {
        return;
      }
      lastError = new Error(`Readiness returned HTTP ${response.status}`);
    } catch (error) {
      lastError = asError(error);
    }
    await new Promise((resolve) => setTimeout(resolve, retryMs));
    retryMs = Math.min(retryMs * 2, MAX_READINESS_RETRY_MS);
  }
  throw new Error(`Readiness did not succeed within ${input.timeoutMs}ms`, { cause: lastError });
}
