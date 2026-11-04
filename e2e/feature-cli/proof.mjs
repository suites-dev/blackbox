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

function scenarioTitle(scenario) {
  return scenario.example
    ? `${scenario.title} [Examples ${scenario.example.split(':')[0]}: ${scenario.example.split(':')[1]}, row ${scenario.example.split(':')[2]}]`
    : scenario.title;
}

function matcher(assertion, name) {
  return new RegExp(`\\b${name}\\b`, 'u').test(assertion.title);
}

function requiredMatchers(title) {
  if (/GET "[^"]+" returns \d+ with JSON exactly/u.test(title)) return ['toBe', 'toEqual'];
  if (/the response status is | has sent .+ and received /u.test(title)) return ['toBe'];
  if (/the response JSON contains/u.test(title)) return ['toEqual'];
  if (/client "[^"]+" sends /u.test(title)) return [];
  assert.fail(`No business evidence contract for step: ${title}`);
}

function verifyBusinessStep(step, failureMatcher) {
  assert.ok(Array.isArray(step.assertions), `Missing assertion evidence: ${step.title}`);
  assert.ok(Array.isArray(step.requests), `Missing request evidence: ${step.title}`);
  const required = requiredMatchers(step.title);
  for (const name of required) {
    const found = step.assertions.filter((item) => matcher(item, name));
    assert.ok(found.length > 0, `Business matcher ${name} did not execute: ${step.title}`);
    assert.ok(
      found.every((item) => item.failed === (name === failureMatcher)),
      `Unexpected business matcher outcome: ${step.title}`,
    );
  }
  assert.ok(
    step.assertions.every((item) => !item.failed || matcher(item, failureMatcher ?? '^$')),
    `Unexpected failed assertion: ${step.title}`,
  );
  const request =
    /client "[^"]+" (?:(?:has sent|sends) )?(GET|POST|PUT|PATCH|DELETE) "([^"]+)"/u.exec(
      step.title,
    );
  if (request) {
    assert.ok(
      step.requests.some((item) => {
        const description = `${item.title} ${item.subtitle ?? ''}`;
        return (
          new RegExp(`\\b${request[1]}\\b`, 'iu').test(description) &&
          description.includes(request[2]) &&
          item.failed === false
        );
      }),
      `Business request ${request[1]} ${request[2]} did not execute: ${step.title}`,
    );
  }
  assert.ok(
    step.requests.every((item) => item.failed === false),
    `Business request failed: ${step.title}`,
  );
  assert.equal(
    step.failed,
    failureMatcher !== undefined,
    `Unexpected business step outcome: ${step.title}`,
  );
}

function oneAttempt(spec, live, status) {
  assert.equal(spec.tests.length, 1, 'Unexpected test projects');
  const test = spec.tests[0];
  assert.equal(
    test.expectedStatus,
    'passed',
    'Expected-failure scenarios are not acceptance evidence',
  );
  assert.equal(test.results.length, 1, 'Unexpected retries');
  const result = test.results[0];
  assert.equal(result.status, status, `Scenario did not ${status}: ${spec.title}`);
  assert.equal(result.retry, 0, 'Report attempt retry must be zero');
  const attempts = live.filter((attempt) => attempt.testId === spec.id);
  assert.equal(attempts.length, 1, `Missing or duplicated live attempt: ${spec.title}`);
  assert.equal(attempts[0].status, status);
  assert.equal(attempts[0].retry, 0);
  return { result, live: attempts[0] };
}

export function verifyReport(report, model, live) {
  assert.ok(model.length > 0, 'Scenario model must not be empty');
  assert.equal(live.length, model.length, 'Unexpected live attempt count');
  assert.deepEqual(report.errors, [], 'Playwright reported collection errors');
  const specs = specsUnder(report.suites);
  assert.equal(specs.length, model.length, 'Unexpected Playwright scenario count');
  assert.equal(report.stats.expected, model.length, 'Unexpected passed scenario count');
  assert.equal(report.stats.skipped, 0, 'Scenarios were skipped');
  assert.equal(report.stats.flaky, 0, 'Scenarios were flaky');
  assert.equal(report.stats.unexpected, 0, 'Scenarios failed');
  for (const scenario of model) {
    const title = scenarioTitle(scenario);
    const matches = specs.filter((spec) => spec.title === title);
    assert.equal(matches.length, 1, `Missing or duplicated scenario: ${title}`);
    const attempt = oneAttempt(matches[0], live, 'passed');
    assert.deepEqual(attempt.result.errors ?? [], [], 'Passing scenario had errors');
    const expected = [...scenario.backgrounds.flatMap((hook) => hook.steps), ...scenario.steps];
    assert.deepEqual(
      attempt.live.steps.map((step) => step.title),
      expected,
      `Live Background/Scenario steps differ: ${title}`,
    );
    for (const step of attempt.live.steps) verifyBusinessStep(step);
    assert.deepEqual(
      stepTitles(attempt.result.steps ?? []).filter((step) =>
        /^(Given|When|Then|And|But|\*) /u.test(step),
      ),
      scenario.steps,
      `Step execution differs: ${title}`,
    );
  }
  return specs.length;
}

export function verifyRefundFailure(report, model, live, exitCode) {
  const title = 'Scenario: A repeated refund retains exactly one refund';
  const scenario = model.find((item) => scenarioTitle(item) === title);
  assert.ok(scenario, 'Missing repeated-refund model');
  assert.equal(exitCode, 1, 'Refund fault must fail the Playwright process');
  assert.deepEqual(report.errors, [], 'Refund fault had collection errors');
  assert.equal(report.stats.expected, 0);
  assert.equal(report.stats.unexpected, 1);
  assert.equal(report.stats.skipped, 0);
  assert.equal(report.stats.flaky, 0);
  const specs = specsUnder(report.suites);
  assert.equal(specs.length, 1, 'Refund fault must discover exactly one scenario');
  assert.equal(specs[0].title, title);
  assert.equal(live.length, 1, 'Refund fault must have exactly one live attempt');
  const attempt = oneAttempt(specs[0], live, 'failed');
  const expected = [...scenario.backgrounds.flatMap((hook) => hook.steps), ...scenario.steps];
  assert.deepEqual(
    attempt.live.steps.map((step) => step.title),
    expected,
    'Refund fault did not reach all business steps',
  );
  const final = attempt.live.steps.at(-1);
  assert.match(final.title, /GET "\/fixture\/state" returns 200 with JSON exactly/u);
  for (const step of attempt.live.steps.slice(0, -1)) verifyBusinessStep(step);
  verifyBusinessStep(final, 'toEqual');
  const errors = attempt.result.errors ?? [];
  assert.ok(errors.length > 0, 'Refund fault omitted assertion errors');
  for (const error of errors) {
    assert.match(error.message ?? '', /toEqual/u, 'Refund failed outside the state matcher');
    assert.match(
      error.message ?? '',
      /refunds/u,
      'Refund failure did not identify retained refunds',
    );
    assert.match(
      error.message ?? '',
      /refund_1/u,
      'Refund failure did not identify the missing refund',
    );
  }
  return 1;
}

export async function verifySandboxes(
  records,
  expectedCount,
  resources = dockerResources,
  { stopReason = 'completed' } = {},
) {
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
    assert.equal(value.stopReason, stopReason, 'Sandbox stop reason did not match the attempt');
    assert.deepEqual(
      await resources(value.projectName),
      [],
      `Docker resources remain for ${value.projectName}`,
    );
  }
}

export function verifyDisjointSandboxes(positiveRecords, faultRecords) {
  assert.ok(
    positiveRecords.length > 0 && faultRecords.length > 0,
    'Both invocations must own Sandbox records',
  );
  const records = [...positiveRecords, ...faultRecords];
  for (const key of ['sandboxId', 'projectName']) {
    const identities = records.map(({ value }) => value[key]);
    assert.ok(
      identities.every((value) => typeof value === 'string' && value.length > 0),
      `Missing Sandbox ${key}`,
    );
    assert.equal(
      new Set(identities).size,
      records.length,
      `Sandbox ${key} reused across invocations`,
    );
  }
  return records.length;
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
