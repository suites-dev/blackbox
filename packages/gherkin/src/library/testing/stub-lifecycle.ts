import { STUB_TOKEN, startStubSystem, type StubMode, type StubSystem } from './stub-system.js';

type Hook = (body: () => unknown) => void;

/**
 * Starts stub systems for one test file and closes them after each test. The
 * fixture-control credential is the stub's token unless a test changes it.
 * The test file passes its own runner hooks.
 */
export function useStubSystems(beforeAll: Hook, afterEach: Hook): (mode: StubMode) => Promise<StubSystem> {
  const running: StubSystem[] = [];
  beforeAll(() => {
    process.env.BLACKBOX_CREDENTIAL_FIXTURE_CONTROL = STUB_TOKEN;
  });
  afterEach(async () => {
    process.env.BLACKBOX_CREDENTIAL_FIXTURE_CONTROL = STUB_TOKEN;
    await Promise.all(running.splice(0).map((system) => system.close()));
  });
  return async (mode) => {
    const system = await startStubSystem(mode);
    running.push(system);
    return system;
  };
}
