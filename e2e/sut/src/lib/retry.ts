import { setTimeout as delay } from 'node:timers/promises';

export async function retry<T>(label: string, operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      await delay(500);
    }
  }
  throw new Error(`${label} did not become ready`, { cause: lastError });
}
