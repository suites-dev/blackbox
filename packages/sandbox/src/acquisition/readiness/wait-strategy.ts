import { Wait, type WaitStrategy } from 'testcontainers';

type WaitArguments = Parameters<WaitStrategy['waitUntilReady']>;
type WaitContainer = WaitArguments[0];

export interface ReadinessWaits {
  readonly listeningPorts: () => WaitStrategy;
  readonly healthCheck: () => WaitStrategy;
}

const testcontainersWaits = {
  listeningPorts: () => Wait.forListeningPorts(),
  healthCheck: () => Wait.forHealthCheck(),
} satisfies ReadinessWaits;

const DEFAULT_STARTUP_TIMEOUT_MS = 60_000;

/**
 * Waits for the published ports to listen and, when the container reports a
 * health state, for its health check too. Neither signal alone is ready.
 */
export async function awaitSandboxReadiness(input: {
  readonly reportsHealth: boolean;
  readonly waits: ReadinessWaits;
  readonly startupTimeoutMs: number;
  readonly waitUntilReady: (strategy: WaitStrategy) => Promise<void>;
}): Promise<void> {
  const strategies = [input.waits.listeningPorts()];
  if (input.reportsHealth) {
    strategies.push(input.waits.healthCheck());
  }
  await Promise.all(
    strategies.map((strategy) =>
      input.waitUntilReady(strategy.withStartupTimeout(input.startupTimeoutMs)),
    ),
  );
}

async function reportsHealth(container: WaitContainer): Promise<boolean> {
  const inspected = await container.inspect();
  return inspected.State.Health !== undefined;
}

/**
 * Startup readiness for every container Compose starts for a sandbox.
 *
 * Testcontainers waits for a container's health check instead of its ports
 * whenever the container has one. A health check can pass before the process
 * that owns a published port is listening, so a sandbox could be handed back
 * with endpoints that refuse connections. This strategy always waits for the
 * published ports to listen, and also for the health check when Docker reports
 * one.
 */
export class SandboxReadinessWaitStrategy implements WaitStrategy {
  private startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS;
  private startupTimeoutSet = false;

  constructor(private readonly waits: ReadinessWaits = testcontainersWaits) {}

  async waitUntilReady(...[container, boundPorts, startTime]: WaitArguments): Promise<void> {
    await awaitSandboxReadiness({
      reportsHealth: await reportsHealth(container),
      waits: this.waits,
      startupTimeoutMs: this.startupTimeoutMs,
      waitUntilReady: (strategy) => strategy.waitUntilReady(container, boundPorts, startTime),
    });
  }

  withStartupTimeout(startupTimeoutMs: number): this {
    this.startupTimeoutMs = startupTimeoutMs;
    this.startupTimeoutSet = true;
    return this;
  }

  isStartupTimeoutSet(): boolean {
    return this.startupTimeoutSet;
  }

  getStartupTimeout(): number {
    return this.startupTimeoutMs;
  }
}
