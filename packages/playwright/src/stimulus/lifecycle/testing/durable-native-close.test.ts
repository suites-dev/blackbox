import { expect, it } from 'vitest';
import { discovered, runAssertions } from '../../../testing/assertion-accounting/native-runner.fixture.js';

it('finishes bounded execution teardown after the native timeout and before the attempt envelope', async () => {
  const run = await runAssertions('durable-close-timeout.spec.ts');
  expect(run.exitCode, `${run.directory}\n${run.output}`).toBe(1);
  expect(run.report.errors).toEqual([]);
  const specs = discovered(run.report.suites);
  expect(specs.map(({ title }) => title)).toEqual(['short native timeout allows bounded execution teardown before the envelope']);
  const results = specs[0].tests[0].results;
  expect(results).toHaveLength(1);
  expect(results[0].status).toBe('timedOut');
  expect(run.events).toContainEqual({ kind: 'bounded-close-action-started', value: true });
  expect(run.events).toContainEqual({ kind: 'bounded-close-persist-finished', value: true });
  expect(run.events).toContainEqual({ kind: 'bounded-close-collector', value: 'collector-stopped' });
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
