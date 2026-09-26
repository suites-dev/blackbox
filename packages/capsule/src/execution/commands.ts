import type { CapsuleEntrypoint } from '../types.js';

export { runHost, runHostWithInteraction, runHostWithRedaction } from './host/process.js';

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
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) {
        return;
      }
      lastError = new Error(`Readiness returned HTTP ${response.status}`);
    } catch (error) {
      lastError = asError(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Readiness did not succeed within ${input.timeoutMs}ms`, { cause: lastError });
}
