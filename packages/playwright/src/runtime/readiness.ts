import type { BlackboxEntrypoint } from '../types.js';

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function readinessUrl(entrypointUrl: string, path: string): URL {
  const entrypoint = new URL(`${entrypointUrl}/`);
  const url = new URL(path, entrypoint);
  if (url.origin !== entrypoint.origin) {
    throw new Error('Readiness path must resolve to the sandbox entrypoint origin');
  }
  return url;
}

export async function awaitReadiness(input: {
  readonly entrypoint: BlackboxEntrypoint;
  readonly path: string;
  readonly timeoutMs: number;
}): Promise<void> {
  const deadline = Date.now() + input.timeoutMs;
  const url = readinessUrl(input.entrypoint.url, input.path);
  let lastError = new Error('Readiness endpoint was not attempted');
  let probeBudgetMs = deadline - Date.now();
  while (probeBudgetMs > 0) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(Math.min(2_000, probeBudgetMs)),
      });
      if (response.ok) {
        return;
      }
      lastError = new Error(`Readiness returned HTTP ${response.status}`);
    } catch (error) {
      lastError = asError(error);
    }
    const retryBudgetMs = deadline - Date.now();
    if (retryBudgetMs > 0) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.min(200, retryBudgetMs)));
    }
    probeBudgetMs = deadline - Date.now();
  }
  throw new Error(`Readiness did not succeed within ${input.timeoutMs}ms`, { cause: lastError });
}
