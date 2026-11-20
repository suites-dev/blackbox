import { createRequire } from 'node:module';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { JSONReport } from '@playwright/test/reporter';
import { expect, it } from 'vitest';
import { discovered, runAssertionProcess } from '../../../testing/assertion-accounting/native-runner.fixture.js';

async function runNativeClose() {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-native-close-'));
  const reportFile = join(directory, 'results.json');
  const require = createRequire(import.meta.url);
  const run = await runAssertionProcess([
    require.resolve('@playwright/test/cli'), 'test', '--config',
    join(import.meta.dirname, '../../../testing/durable-close/config.ts'),
  ], {
    directory, cwd: join(import.meta.dirname, '../../../..'),
    env: { ...process.env, BLACKBOX_ASSERTION_REPORT: reportFile,
      BLACKBOX_ASSERTION_OUTPUT: join(directory, 'output'), FORCE_COLOR: '0', NO_COLOR: undefined },
  });
  const report = JSON.parse(await readFile(reportFile, 'utf8')) as JSONReport;
  return { ...run, directory, report };
}

it('finishes bounded execution teardown after the native timeout and before the attempt envelope', async () => {
  const run = await runNativeClose();
  expect(run.exitCode, `${run.directory}\n${run.output}`).toBe(1);
  expect(run.report.errors).toEqual([]);
  const specs = discovered(run.report.suites);
  expect(specs.map(({ title }) => title)).toEqual(['short native timeout allows bounded execution teardown before the envelope']);
  const results = specs[0].tests[0].results;
  expect(results).toHaveLength(1);
  expect(results[0].status).toBe('timedOut');
  expect(run.output).toContain('"kind":"bounded-close-action-started","value":true');
  expect(run.output).toContain('"kind":"bounded-close-persist-finished","value":true');
  expect(run.output).toContain('"kind":"bounded-close-collector","value":"collector-stopped"');
  const names = results[0].attachments.map(({ name }) => name);
  expect(names.filter((name) => name === 'blackbox-execution')).toHaveLength(1);
  expect(names.filter((name) => name === 'blackbox-envelope')).toHaveLength(1);
  expect(names.indexOf('blackbox-execution')).toBeLessThan(names.indexOf('blackbox-envelope'));
  const execution = results[0].attachments.find(({ name }) => name === 'blackbox-execution');
  if (execution === undefined || execution.body === undefined) { throw new Error('missing execution body'); }
  expect(JSON.parse(Buffer.from(execution.body, 'base64').toString('utf8'))).toMatchObject({ events: [
    { kind: 'begin' }, { kind: 'action', status: 'interrupted' },
  ] });
  expect(run.output).not.toContain('Fixture "_blackboxExecution" timeout');
}, 30_000);
