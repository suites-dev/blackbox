import { afterEach, expect, it } from 'vitest';
import {
  cleanupNativeRuns,
  eventsOf,
  runPlaywright,
} from '../testing/system-sandbox-harness/native-runner.js';

afterEach(cleanupNativeRuns);
it.each(['default', 'client-readiness-failure'])(
  'owns native client lifecycle for %s',
  async (scenario) => {
    const run = await runPlaywright({
      configFile: 'system-sandbox-declarations.config.ts',
      testFile: 'clients.spec.ts',
      jsonReport: false,
      scenario,
    });
    expect(run.code, run.output).toBe(scenario === 'default' ? 0 : 1);
    const release = eventsOf(run, 'client-release-order');
    expect(release).toHaveLength(1);
    expect(release[0].raw.events).toEqual(
      scenario === 'default'
        ? ['create', 'ready', 'hook', 'body', 'after', 'dispose']
        : ['create', 'ready', 'dispose', 'after'],
    );
    expect(eventsOf(run, 'stop')).toHaveLength(1);
    if (scenario !== 'default') {
      expect(run.output).toContain('client readiness deliberately failed');
    }
  },
);
