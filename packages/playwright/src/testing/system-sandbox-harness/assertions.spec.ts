import { join } from 'node:path';

import type { JSONReportSuite, JSONReportTestStep } from '@playwright/test/reporter';
import { expect } from 'vitest';

import {
  eventNumber,
  eventObject,
  eventsOf,
  eventString,
  type NativeEvent,
  type NativeRun,
} from './native-runner.js';

function executionId(event: NativeEvent): string {
  return eventString(event, 'executionId');
}

function assertAttemptOwnership(run: NativeRun): void {
  const starts = eventsOf(run, 'start');
  const stops = eventsOf(run, 'stop');
  expect(starts).toHaveLength(9);
  expect(stops).toHaveLength(9);
  const executionIds = starts.map(executionId);
  expect(new Set(executionIds).size).toBe(9);
  expect(new Set(starts.map((event) => eventString(event, 'artifactDirectory'))).size).toBe(9);
  for (const id of executionIds) {
    expect(stops.filter((event) => executionId(event) === id)).toHaveLength(1);
  }

  const expectedConfig = join(import.meta.dirname, '..', 'blackbox.config.yaml');
  expect(new Set(starts.map((event) => eventString(event, 'configFile')))).toEqual(
    new Set([expectedConfig]),
  );
}

function assertSelections(run: NativeRun): void {
  const starts = eventsOf(run, 'start');
  const requests = starts.map((event) => ({
    selection: eventObject(event, 'selection'),
    environment: eventObject(event, 'environment'),
  }));
  expect(requests).toEqual(
    expect.arrayContaining([
      {
        selection: { kind: 'system', id: 'orders' },
        environment: { REGION: 'eu', TENANT: 'blue' },
      },
      {
        selection: { kind: 'system', id: 'orders' },
        environment: { REGION: 'us', TENANT: 'green' },
      },
      { selection: { kind: 'system', id: 'billing' }, environment: {} },
      {
        selection: { kind: 'system', id: 'billing' },
        environment: { PROBE: 'fixtureless' },
      },
      {
        selection: { kind: 'subsystem', id: 'invoice-worker' },
        environment: { MODE: 'worker' },
      },
      { selection: { kind: 'system', id: 'extended' }, environment: {} },
    ]),
  );
  const blue = starts.filter((event) => {
    const selection = eventObject(event, 'selection');
    const environment = eventObject(event, 'environment');
    return selection.id === 'orders' && environment.TENANT === 'blue';
  });
  expect(blue).toHaveLength(4);
  expect(
    starts.filter((event) => eventObject(event, 'environment').PROBE === 'fixtureless'),
  ).toHaveLength(1);
}

function assertRetryHooksAndAutoFixture(run: NativeRun): void {
  const retries = eventsOf(run, 'retry-body');
  const stops = eventsOf(run, 'stop');
  expect(retries.map((event) => eventNumber(event, 'retry'))).toEqual([0, 1]);
  expect(new Set(retries.map(executionId)).size).toBe(2);
  expect(
    retries.map((retry) => {
      const stop = stops.find((candidate) => executionId(candidate) === executionId(retry));
      return stop === undefined ? 'missing' : eventString(stop, 'reason');
    }),
  ).toEqual(['failed', 'completed']);

  const title = 'hooks body and native request share one attempt';
  const identityEvents = run.events.filter(
    (event) =>
      ['beforeEach', 'body', 'afterEach'].includes(event.kind) &&
      eventString(event, 'title') === title,
  );
  expect(identityEvents.map(({ kind }) => kind)).toEqual(['beforeEach', 'body', 'afterEach']);
  expect(new Set(identityEvents.map(executionId)).size).toBe(1);

  const setup = eventsOf(run, 'auto-fixture-setup');
  const teardown = eventsOf(run, 'auto-fixture-teardown');
  expect(setup).toHaveLength(1);
  expect(teardown).toHaveLength(1);
  const setupEvent = setup[0];
  const teardownEvent = teardown[0];
  expect(executionId(setupEvent)).toBe(executionId(teardownEvent));
}

function assertParallelAndRootHooks(run: NativeRun): void {
  const starts = eventsOf(run, 'start');
  const stops = eventsOf(run, 'stop');
  const bodyWorkers = eventsOf(run, 'body').map((event) => eventNumber(event, 'workerIndex'));
  expect(new Set(bodyWorkers).size).toBeGreaterThanOrEqual(2);
  expect(new Set(starts.map(({ pid }) => pid)).size).toBeGreaterThanOrEqual(2);
  for (const pid of new Set(starts.map(({ pid }) => pid))) {
    const processEvents = run.events.filter((event) => event.pid === pid);
    const firstStart = processEvents.findIndex(({ kind }) => kind === 'start');
    const lastStop = processEvents.reduce(
      (found, { kind }, index) => (kind === 'stop' ? index : found),
      -1,
    );
    const beforeAll = processEvents.findIndex(
      (event) =>
        event.kind === 'native-hook-request' && eventString(event, 'phase') === 'beforeAll',
    );
    const afterAll = processEvents.findIndex(
      (event) =>
        event.kind === 'native-hook-request' && eventString(event, 'phase') === 'afterAll',
    );
    expect(beforeAll).toBeGreaterThanOrEqual(0);
    expect(beforeAll).toBeLessThan(firstStart);
    expect(afterAll).toBeGreaterThan(lastStop);
  }
  const stopByAttempt = new Map(stops.map((event) => [executionId(event), event] as const));
  const overlaps = starts.some((left, index) =>
    starts.slice(index + 1).some((right) => {
      const leftStop = stopByAttempt.get(executionId(left));
      const rightStop = stopByAttempt.get(executionId(right));
      return (
        left.pid !== right.pid &&
        leftStop !== undefined &&
        rightStop !== undefined &&
        left.at < rightStop.at &&
        right.at < leftStop.at
      );
    }),
  );
  expect(overlaps).toBe(true);
}

interface DiscoveredSpec {
  readonly path: readonly string[];
  readonly file: string;
  readonly line: number;
  readonly steps: readonly JSONReportTestStep[];
  readonly statuses: readonly string[];
}

function specsIn(
  suites: readonly JSONReportSuite[],
  parentPath: readonly string[] = [],
): readonly DiscoveredSpec[] {
  return suites.flatMap((suite) => {
    const suitePath = suite.title.endsWith('.spec.ts') ? parentPath : [...parentPath, suite.title];
    return [
      ...suite.specs.map((spec) => ({
        path: [...suitePath, spec.title],
        file: spec.file,
        line: spec.line,
        steps: spec.tests.flatMap((test) =>
          test.results.flatMap((result) => result.steps ?? []),
        ),
        statuses: spec.tests.flatMap((test) =>
          test.results.map(({ status }) => status ?? 'missing'),
        ),
      })),
      ...specsIn(suite.suites ?? [], suitePath),
    ];
  });
}

function assertDiscoveryAndSteps(run: NativeRun): void {
  if (run.reportKind !== 'json') {
    throw new Error('Expected native JSON report');
  }
  const discovered = specsIn(run.report.suites);
  expect(discovered).toHaveLength(10);
  for (const spec of discovered) {
    expect(spec.file.endsWith('happy.spec.ts')).toBe(true);
    expect(spec.line).toBeGreaterThan(0);
  }
  expect(discovered.map(({ path }) => path)).toEqual(
    expect.arrayContaining([
      ['system "orders"', 'sandbox "green"', 'second sandbox group has isolated options'],
      [
        'subsystem "invoice-worker"',
        'sandbox "subsystem group"',
        'subsystem selection is preserved',
      ],
      [
        'system "billing"',
        'sandbox "fixtureless group"',
        'acquires without any Blackbox fixture dependency',
      ],
    ]),
  );
  const fixtureless = discovered.find(
    ({ path }) => path.at(-1) === 'fixtureless acquisition keeps native steps',
  );
  if (fixtureless === undefined) {
    throw new Error('Fixtureless native-step test was not discovered');
  }
  const outer = fixtureless.steps.find(({ title }) => title === 'outer user step');
  if (outer === undefined) {
    throw new Error('Outer native step was not reported');
  }
  expect((outer.steps ?? []).map(({ title }) => title)).toContain('nested user step');
  for (const modifierTitle of [
    'native skip modifier remains available',
    'native fixme modifier remains available',
  ]) {
    const modified = discovered.find(({ path }) => path.at(-1) === modifierTitle);
    if (modified === undefined) {
      throw new Error(`Modified native test was not discovered: ${modifierTitle}`);
    }
    expect(modified.statuses).toEqual(['skipped']);
  }
}

export function assertHappyRun(run: NativeRun): void {
  expect(run.code, run.output).toBe(0);
  assertAttemptOwnership(run);
  assertSelections(run);
  assertRetryHooksAndAutoFixture(run);
  assertParallelAndRootHooks(run);
  assertDiscoveryAndSteps(run);
}

export function assertFailureRun(run: NativeRun): void {
  expect(run.code, run.output).toBe(1);
  expect(run.output).toContain('2 failed');
  expect(run.output).toContain('synthetic beforeEach setup failure');
  expect(eventsOf(run, 'forbidden-body')).toHaveLength(0);
  const starts = eventsOf(run, 'start');
  const stops = eventsOf(run, 'stop');
  expect(starts).toHaveLength(2);
  expect(stops).toHaveLength(2);
  expect(stops.map((event) => eventString(event, 'reason'))).toEqual(['failed', 'failed']);
  for (const start of starts) {
    expect(stops.filter((stop) => executionId(stop) === executionId(start))).toHaveLength(1);
  }
  const setup = run.events.filter(
    (event) => event.raw.title === 'hook setup failure still cleans up',
  );
  expect(setup.map(({ kind }) => kind)).toEqual(['failure-beforeEach', 'failure-afterEach']);
  expect(new Set(setup.map(executionId)).size).toBe(1);
  expect(eventsOf(run, 'failing-body')).toHaveLength(1);
}
