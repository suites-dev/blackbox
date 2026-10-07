import { createBlackboxSystemTest } from '../../fixtures.js';
import { startStubSystem } from '../../library/testing/stub-system.js';
import type { BlackboxAttemptRuntime } from '../../runtime/acquisition.js';

// What a rendered suite imports in the real Playwright run of skeleton-run.test.ts,
// in place of @suites/blackbox-playwright: the same runtime exports, with a
// facade whose attempts start the library's subscription stub instead of a
// Docker Sandbox. Each attempt gets its own stub, as each owns its Sandbox.

export { runSentence } from '../run-sentence.js';
export { sandboxCredentials } from '../../step-runtime/credentials.js';
export { sandboxEnvironment } from '../../step-runtime/environment.js';

const stubRuntime = {
  async start(input) {
    if (input.selection.kind === 'unselected') {
      throw new Error('The rendered suite did not select a catalog entry');
    }
    const stub = await startStubSystem('correct');
    const url = new URL(stub.url);
    const executionId = `stub-${url.port}`;
    return {
      sandbox: {
        sandboxId: executionId,
        executionId,
        catalogEntry: input.selection,
        projectName: executionId,
        artifactDirectory: input.artifactDirectory,
        entrypoint: { url: stub.url, host: url.hostname, port: Number(url.port), protocol: 'http' },
        containers: new Map(),
      },
      telemetry: {
        sessionId: executionId,
        executionId,
        inspect: () => Promise.resolve({ kind: 'disabled' as const }),
        read: () => Promise.reject(new Error('Telemetry is not part of the skeleton run')),
        readTrace: () => Promise.reject(new Error('Telemetry is not part of the skeleton run')),
      },
      effects: { sessionId: executionId, executionId },
      stop: () => stub.close(),
    };
  },
} satisfies BlackboxAttemptRuntime;

export const test = createBlackboxSystemTest(stubRuntime);
