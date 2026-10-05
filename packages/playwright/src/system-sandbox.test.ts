import { afterEach, expect, it } from 'vitest';

import {
  assertFailureRun,
  assertHappyRun,
} from './testing/system-sandbox-harness/assertions.spec.js';
import { parseParallelBarrierPort } from './testing/system-sandbox-harness/barrier-client.fixture.js';
import {
  cleanupNativeRuns,
  eventsOf,
  eventString,
  runPlaywright,
} from './testing/system-sandbox-harness/native-runner.js';

afterEach(cleanupNativeRuns);

it.each(['', 'not-a-port', '0', '65536', '12.5'])(
  'rejects invalid parallel rendezvous port %j',
  (value) => {
    expect(() => parseParallelBarrierPort(value)).toThrow(
      'Parallel rendezvous port must be an integer from 1 through 65535',
    );
  },
);

it('maps system sandbox declarations to isolated native Playwright attempts', async () => {
  const run = await runPlaywright({
    configFile: 'system-sandbox.config.ts',
    testFile: 'happy.spec.ts',
    jsonReport: true,
    scenario: 'default',
  });
  assertHappyRun(run);
});

it('fails the parallel rendezvous under single-worker serialized scheduling', async () => {
  const run = await runPlaywright({
    configFile: 'system-sandbox.config.ts',
    testFile: 'happy.spec.ts',
    jsonReport: false,
    scenario: 'serialized-control',
  });
  expect(run.code, run.output).toBe(1);
  expect(run.output).toMatch(/Parallel rendezvous failed with HTTP (?:408|409)/u);
  const starts = eventsOf(run, 'start');
  const stops = eventsOf(run, 'stop');
  expect(starts).toHaveLength(2);
  expect(stops).toHaveLength(2);
  for (const start of starts) {
    const id = eventString(start, 'executionId');
    const ownedStops = stops.filter((stop) => eventString(stop, 'executionId') === id);
    expect(ownedStops).toHaveLength(1);
    expect(eventString(ownedStops[0], 'reason')).toBe('failed');
  }
});

it('cleans up exactly once after hook setup and body failures', async () => {
  const run = await runPlaywright({
    configFile: 'system-sandbox-failures.config.ts',
    testFile: 'failures.spec.ts',
    jsonReport: true,
    scenario: 'default',
  });
  assertFailureRun(run);
});

it('does not subtract near-half acquisition time from the native body timeout', async () => {
  const run = await runPlaywright({
    configFile: 'system-sandbox-declarations.config.ts',
    testFile: 'timeout.spec.ts',
    jsonReport: false,
    scenario: 'default',
  });
  expect(run.code, run.output).toBe(0);
  expect(eventsOf(run, 'timeout-body-start')).toHaveLength(1);
  expect(eventsOf(run, 'timeout-body-end')).toHaveLength(1);
  const starts = eventsOf(run, 'start');
  const stops = eventsOf(run, 'stop');
  expect(starts).toHaveLength(1);
  expect(stops).toHaveLength(1);
  const start = starts[0];
  const stop = stops[0];
  expect(eventString(stop, 'executionId')).toBe(eventString(start, 'executionId'));
  expect(eventString(stop, 'reason')).toBe('completed');
});

it.each([
  {
    file: 'illegal-nesting.spec.ts',
    scenario: 'nested-sandbox',
    message: /sandbox declarations cannot be nested/u,
  },
  {
    file: 'illegal-nesting.spec.ts',
    scenario: 'async-system',
    message: /test\.system callback must be synchronous/u,
  },
  {
    file: 'illegal-nesting.spec.ts',
    scenario: 'async-sandbox',
    message: /system\.sandbox callback must be synchronous/u,
  },
  {
    file: 'illegal-nesting.spec.ts',
    scenario: 'escaped-system',
    message: /system scope cannot be used after its callback returns/u,
  },
  {
    file: 'illegal-nesting.spec.ts',
    scenario: 'invalid-selection',
    message: /system selection must identify a system or subsystem/u,
  },
  {
    file: 'illegal-nesting.spec.ts',
    scenario: 'invalid-environment',
    message: /sandbox environment value "PORT" must be a string/u,
  },
  {
    file: 'escaped-declaration.spec.ts',
    scenario: 'default',
    message:
      /(?:sandbox suite cannot be used after its declaration callback returns|Cannot perform 'apply' on a proxy that has been revoked)/u,
  },
  {
    file: 'suite-hooks.spec.ts',
    scenario: 'default',
    message: /unsupported\.beforeAll is not a function/u,
  },
  {
    file: 'flat-root.spec.ts',
    scenario: 'default',
    message: /tests must be declared inside test\.system\(.+\)\.sandbox\(.+\)/u,
  },
  {
    file: 'nested-root-hook.spec.ts',
    scenario: 'default',
    message: /test\.beforeAll must be registered outside test\.system(?: and sandbox)? declarations/u,
  },
])(
  'rejects invalid declaration $scenario in $file before acquisition',
  async ({ file, scenario, message }) => {
    const run = await runPlaywright({
      configFile: 'system-sandbox-declarations.config.ts',
      testFile: file,
      jsonReport: false,
      scenario,
    });
    expect(run.code, run.output).toBe(1);
    expect(run.output).toMatch(message);
    expect(eventsOf(run, 'start')).toHaveLength(0);
  },
);

it.each([
  { scenario: 'direct-before-all', attempts: 0 },
  { scenario: 'transitive-before-all', attempts: 0 },
  { scenario: 'direct-after-all', attempts: 1 },
  { scenario: 'transitive-after-all', attempts: 1 },
])('rejects suite hook fixture misuse $scenario without hook acquisition', async (input) => {
  const run = await runPlaywright({
    configFile: 'system-sandbox-declarations.config.ts',
    testFile: 'hook-fixture-misuse.spec.ts',
    jsonReport: false,
    scenario: input.scenario,
  });
  expect(run.code, run.output).toBe(1);
  expect(run.output).toMatch(
    /(?:fixture is not supported in "(?:beforeAll|afterAll)"|Blackbox fixtures are only available in tests)/u,
  );
  const starts = eventsOf(run, 'start');
  const stops = eventsOf(run, 'stop');
  expect(starts).toHaveLength(input.attempts);
  expect(stops).toHaveLength(input.attempts);
  if (input.attempts === 1) {
    expect(eventString(stops[0], 'executionId')).toBe(eventString(starts[0], 'executionId'));
    expect(eventString(stops[0], 'reason')).toBe('completed');
  }
});
