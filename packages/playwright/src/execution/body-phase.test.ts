import { readFile } from 'node:fs/promises';
import { afterEach, expect, it } from 'vitest';

import {
  cleanupNativeRuns,
  eventsOf,
  runPlaywright,
} from '../testing/system-sandbox-harness/native-runner.js';

afterEach(cleanupNativeRuns);

it.each(['named', 'shorthand'])(
  'preserves native %s fixture signatures, declaration locations, hooks, concurrent bodies and retries',
  async (scenario) => {
    const run = await runPlaywright({
      configFile: 'system-sandbox-body-phase.config.ts',
      testFile: 'body-phase.spec.ts',
      jsonReport: true,
      scenario,
    });
    expect(run.code, run.output).toBe(0);
    expect(eventsOf(run, 'phase-body')).toHaveLength(2);
    expect(eventsOf(run, 'phase-retry').map(({ raw }) => raw.retry)).toEqual([0, 1]);
    const starts = eventsOf(run, 'start');
    expect(starts).toHaveLength(4);
    expect(new Set(starts.map(({ raw }) => raw.executionId)).size).toBe(4);
    const stops = eventsOf(run, 'stop');
    expect(stops).toHaveLength(4);
    expect(
      starts.some((left) =>
        starts.some((right) => {
          const stop = stops.find(({ raw }) => raw.executionId === left.raw.executionId);
          return (
            right.pid !== left.pid &&
            right.at >= left.at &&
            stop !== undefined &&
            right.at < stop.at
          );
        }),
      ),
    ).toBe(true);
    expect(eventsOf(run, 'phase-fixture-setup')).toHaveLength(4);
    expect(eventsOf(run, 'phase-fixture-teardown')).toHaveLength(4);
    expect(run.reportKind).toBe('json');
    if (run.reportKind !== 'json') {
      throw new Error('Missing native discovery report');
    }
    const specs = run.report.suites
      .flatMap((file) => file.suites ?? [])
      .flatMap((system) => system.suites ?? [])
      .flatMap((sandbox) => sandbox.suites ?? [])
      .flatMap((nested) => nested.specs);
    expect(specs).toHaveLength(3);
    const source = await readFile(
      new URL('../testing/body-phase/body-phase.spec.ts', import.meta.url),
      'utf8',
    );
    for (const spec of specs) {
      expect(spec.file).toMatch(/body-phase.spec.ts$/u);
      const declaration =
        spec.title === 'phase survives retry'
          ? "suite.test('phase survives retry'"
          : 'suite.test(title,';
      expect(spec.line).toBe(
        source.split('\n').findIndex((line) => line.includes(declaration)) + 1,
      );
    }
  },
);
