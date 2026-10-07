import { startStubSystem, type StubMode, type StubSystem } from './stub-system.js';

type Hook = (body: () => unknown) => void;

/**
 * Starts stub systems for one test file and closes them after each test. The
 * test file passes its own runner hooks.
 */
export function useStubSystems(afterEach: Hook): (mode: StubMode) => Promise<StubSystem> {
  const running: StubSystem[] = [];
  afterEach(async () => {
    await Promise.all(running.splice(0).map((system) => system.close()));
  });
  return async (mode) => {
    const system = await startStubSystem(mode);
    running.push(system);
    return system;
  };
}
