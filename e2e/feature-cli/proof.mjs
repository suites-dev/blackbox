import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export async function recordsUnder(directory) {
  const records = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) records.push(...(await recordsUnder(path)));
    else if (item.name.endsWith('.json')) {
      let value;
      try {
        value = JSON.parse(await readFile(path, 'utf8'));
      } catch {
        continue;
      }
      if (
        value?.schemaVersion === 1 &&
        typeof value.sandboxId === 'string' &&
        typeof value.projectName === 'string' &&
        Array.isArray(value.composeFiles)
      ) {
        records.push({ path, value });
      }
    }
  }
  return records;
}

export async function dockerResources(project) {
  const filter = project
    ? `label=com.docker.compose.project=${project}`
    : 'label=com.docker.compose.project';
  const result = [];
  for (const args of [
    ['ps', '-a', '-q'],
    ['network', 'ls', '-q'],
    ['volume', 'ls', '-q'],
  ]) {
    const { stdout } = await execute('docker', [...args, '--filter', filter]);
    result.push(
      ...stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((id) => `${args[0]}:${id}`),
    );
  }
  return result.sort();
}

function specsUnder(suites) {
  return suites.flatMap((suite) => [...suite.specs, ...specsUnder(suite.suites ?? [])]);
}

function stepTitles(steps) {
  return steps.flatMap((step) => [step.title, ...stepTitles(step.steps ?? [])]);
}

export function verifyReport(report, model, live) {
  assert.equal(live.length, model.length, 'Unexpected live attempt count');
  assert.deepEqual(report.errors, [], 'Playwright reported collection errors');
  const specs = specsUnder(report.suites);
  assert.equal(specs.length, model.length, 'Unexpected Playwright scenario count');
  assert.equal(report.stats.skipped, 0, 'Scenarios were skipped');
  assert.equal(report.stats.flaky, 0, 'Scenarios were flaky');
  assert.equal(report.stats.unexpected, 0, 'Scenarios failed');
  const titles = specs.map((spec) => spec.title);
  for (const scenario of model) {
    const title = scenario.example
      ? `${scenario.title} [Examples ${scenario.example.split(':')[0]}: ${scenario.example.split(':')[1]}, row ${scenario.example.split(':')[2]}]`
      : scenario.title;
    assert.equal(
      titles.filter((actual) => actual === title).length,
      1,
      `Missing or duplicated scenario: ${title}`,
    );
    const spec = specs.find((candidate) => candidate.title === title);
    assert.equal(spec.tests.length, 1, 'Unexpected test projects');
    assert.equal(spec.tests[0].results.length, 1, 'Unexpected retries');
    const result = spec.tests[0].results[0];
    assert.equal(result.status, 'passed', `Scenario did not pass: ${title}`);
    const expected = [...scenario.backgrounds.flatMap((hook) => hook.steps), ...scenario.steps];
    const attempts = live.filter((attempt) => attempt.testId === spec.id);
    assert.equal(attempts.length, 1, `Missing or duplicated live attempt: ${title}`);
    assert.equal(attempts[0].status, 'passed');
    assert.equal(attempts[0].retry, 0);
    assert.ok(
      attempts[0].steps.every((step) => !step.failed),
      'A live step failed',
    );
    assert.deepEqual(
      attempts[0].steps.map((step) => step.title),
      expected,
      `Live Background/Scenario steps differ: ${title}`,
    );
    assert.deepEqual(
      stepTitles(result.steps ?? []).filter((step) => /^(Given|When|Then|And|But|\*) /u.test(step)),
      scenario.steps,
      `Step execution differs: ${title}`,
    );
  }
  return specs.length;
}

export async function verifySandboxes(records, expectedCount, resources = dockerResources) {
  assert.equal(records.length, expectedCount, 'Unexpected physical Sandbox count');
  assert.equal(
    new Set(records.map(({ value }) => value.sandboxId)).size,
    expectedCount,
    'Sandbox IDs were reused',
  );
  assert.equal(
    new Set(records.map(({ value }) => value.projectName)).size,
    expectedCount,
    'Compose projects were reused',
  );
  for (const { value } of records) {
    assert.equal(value.state, 'completed', 'Sandbox did not complete');
    assert.equal(value.cleanup, 'complete', 'Sandbox cleanup was incomplete');
    assert.equal(value.stopReason, 'completed', 'Sandbox did not finish successfully');
    assert.deepEqual(
      await resources(value.projectName),
      [],
      `Docker resources remain for ${value.projectName}`,
    );
  }
}

export async function recoverRecords(records, recoverSandbox) {
  const results = [];
  for (const { path, value } of records) {
    results.push(
      await recoverSandbox({
        recordDirectory: dirname(path),
        sandboxId: value.sandboxId,
        timeoutMs: 60_000,
      }),
    );
    assert.deepEqual(
      await dockerResources(value.projectName),
      [],
      `Recovery left resources for ${value.projectName}`,
    );
  }
  return results;
}
