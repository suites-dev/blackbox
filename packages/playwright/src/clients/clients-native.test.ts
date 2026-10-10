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

it.each(['client-readiness-timeout', 'client-create-late'])(
  'waits for native client cleanup after %s',
  async (scenario) => {
    const run = await runPlaywright({
      configFile: 'system-sandbox-declarations.config.ts',
      testFile: 'clients.spec.ts',
      jsonReport: false,
      scenario,
    });
    expect(run.code, run.output).toBe(1);
    const release = eventsOf(run, 'client-release-order');
    expect(release).toHaveLength(1);
    expect(release[0].raw.events).toEqual(
      scenario === 'client-readiness-timeout'
        ? ['create', 'ready', 'dispose:start', 'dispose:finish', 'after']
        : ['create:start', 'create:finish', 'dispose:start', 'dispose:finish', 'after'],
    );
    expect(run.output).toContain('Blackbox client setup exceeded the Playwright test timeout');
  },
);

it('allows healthy client setup within a 100ms native test timeout', async () => {
  const run = await runPlaywright({
    configFile: 'system-sandbox-declarations.config.ts',
    testFile: 'clients.spec.ts',
    jsonReport: false,
    scenario: 'client-healthy-short-timeout',
  });
  expect(run.code, run.output).toBe(0);
  const release = eventsOf(run, 'client-release-order');
  expect(release).toHaveLength(1);
  expect(release[0].raw.events).toEqual([
    'create',
    'ready',
    'hook',
    'body',
    'after',
    'dispose',
  ]);
  expect(eventsOf(run, 'stop')).toHaveLength(1);
  expect(eventsOf(run, 'stop')[0].raw.reason).toBe('completed');
});
