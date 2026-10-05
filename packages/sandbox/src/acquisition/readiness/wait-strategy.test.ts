import type { WaitStrategy } from 'testcontainers';
import { describe, expect, it } from 'vitest';
import { awaitSandboxReadiness, SandboxReadinessWaitStrategy } from './wait-strategy.js';

class RecordingWait implements WaitStrategy {
  timeoutMs = -1;
  timeoutSet = false;

  constructor(readonly name: string) {}

  async waitUntilReady(): Promise<void> {
    await Promise.resolve();
  }

  withStartupTimeout(startupTimeoutMs: number): this {
    this.timeoutMs = startupTimeoutMs;
    this.timeoutSet = true;
    return this;
  }

  isStartupTimeoutSet(): boolean {
    return this.timeoutSet;
  }

  getStartupTimeout(): number {
    return this.timeoutMs;
  }
}

function recordingWaits() {
  const created: RecordingWait[] = [];
  return {
    created,
    waits: {
      listeningPorts: () => {
        const wait = new RecordingWait('listening-ports');
        created.push(wait);
        return wait;
      },
      healthCheck: () => {
        const wait = new RecordingWait('health-check');
        created.push(wait);
        return wait;
      },
    },
  };
}

async function awaited(input: {
  readonly reportsHealth: boolean;
  readonly startupTimeoutMs: number;
}) {
  const { created, waits } = recordingWaits();
  const awaitedNames: string[] = [];
  await awaitSandboxReadiness({
    reportsHealth: input.reportsHealth,
    waits,
    startupTimeoutMs: input.startupTimeoutMs,
    waitUntilReady: async (strategy) => {
      const match = created.find((wait) => wait === strategy);
      if (match === undefined) {
        throw new Error('waited on a strategy the readiness waits did not create');
      }
      awaitedNames.push(match.name);
      await match.waitUntilReady();
    },
  });
  return { created, awaitedNames };
}

describe('sandbox startup readiness', () => {
  it('waits for listening ports alone when the container reports no health state', async () => {
    const { awaitedNames } = await awaited({ reportsHealth: false, startupTimeoutMs: 1_500 });

    expect(awaitedNames).toEqual(['listening-ports']);
  });

  it('waits for listening ports and the health check when the container reports health', async () => {
    const { awaitedNames } = await awaited({ reportsHealth: true, startupTimeoutMs: 1_500 });

    expect([...awaitedNames].sort()).toEqual(['health-check', 'listening-ports']);
  });

  it('gives every awaited wait the sandbox startup timeout', async () => {
    const { created } = await awaited({ reportsHealth: true, startupTimeoutMs: 4_321 });

    expect(created.map((wait) => [wait.name, wait.timeoutMs])).toEqual([
      ['listening-ports', 4_321],
      ['health-check', 4_321],
    ]);
  });

  it('is not ready while the port wait fails even though the health check passed', async () => {
    const { waits } = recordingWaits();
    const portFailure = new Error('Port 80/tcp not bound after 1500ms');

    await expect(
      awaitSandboxReadiness({
        reportsHealth: true,
        waits,
        startupTimeoutMs: 1_500,
        waitUntilReady: async (strategy) => {
          if (!(strategy instanceof RecordingWait)) {
            throw new Error('waited on a strategy the readiness waits did not create');
          }
          if (strategy.name === 'listening-ports') {
            throw portFailure;
          }
          await strategy.waitUntilReady();
        },
      }),
    ).rejects.toBe(portFailure);
  });

  it('records the startup timeout Testcontainers assigns to the default strategy', () => {
    const strategy = new SandboxReadinessWaitStrategy(recordingWaits().waits);

    expect(strategy.isStartupTimeoutSet()).toBe(false);
    expect(strategy.withStartupTimeout(7_000)).toBe(strategy);
    expect(strategy.isStartupTimeoutSet()).toBe(true);
    expect(strategy.getStartupTimeout()).toBe(7_000);
  });
});
