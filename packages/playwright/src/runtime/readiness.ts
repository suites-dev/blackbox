import type { BlackboxEntrypoint } from '../types.js';

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export async function awaitReadiness(input: {
  readonly entrypoint: BlackboxEntrypoint;
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
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  throw new Error(`Readiness did not succeed within ${input.timeoutMs}ms`, { cause: lastError });
}
