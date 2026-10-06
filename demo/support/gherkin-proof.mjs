// Assertions over finished Gherkin runs, for demo/support/gherkin-test.sh.
//
// parity: every scenario the native subscription spec declares is compiled from
// the feature and supported in the verified Gherkin run.
//
// negative-control: against a demo app that does not persist subscriptions,
// the eligible-user scenario passes its response claims and fails at its
// stored-state step, reported at that step's .feature line; every other
// failure is reported at a .feature line too, and the run differs from the
// supported one in verdicts only.

import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

const NATIVE_SPEC = 'subscription-system.spec.ts';
const NO_PERSIST_SCENARIO = 'Scenario: an eligible user receives an active subscription';
const STORED_STATE_STEP =
  'And the state at "/fixture/state" as "fixture-control" has "/subscriptions" equal to:';
/** The claims before the stored-state step, which the app still satisfies. */
const RESPONSE_STEPS = ['And the response status is 201', 'And the response JSON equals:'];
/** What verify reports for a run whose tests failed. */
const FAILED_RUN = 'the run status is "failed", not "passed"';

const SEPARATOR = ' › ';

function walkSuites(suites, parents, visit) {
  for (const suite of suites ?? []) {
    const path = [...parents, suite.title];
    for (const spec of suite.specs ?? []) visit(spec, path);
    walkSuites(suite.suites, path, visit);
  }
}

/** `Rule: … › Scenario: …` for each test of the native spec, from `playwright test --list --reporter=json`. */
function nativeScenarios(listReport, specFile = NATIVE_SPEC) {
  const titles = [];
  walkSuites(listReport.suites, [], (spec, path) => {
    if (basename(spec.file) !== specFile) return;
    const rule = path.findLast((title) => title.startsWith('Rule: '));
    titles.push(rule === undefined ? spec.title : `${rule}${SEPARATOR}${spec.title}`);
  });
  return titles;
}

/** A Gherkin title matches a native one exactly, or as one row of a Scenario Outline. */
const isCounterpart = (gherkinTitle, nativeTitle) =>
  gherkinTitle === nativeTitle || gherkinTitle.startsWith(`${nativeTitle} [`);

function parity({ native, verify }) {
  const problems = [];
  if (native.length === 0) {
    problems.push(`the native listing has no test from ${NATIVE_SPEC}`);
  }
  if (verify.ok !== true) {
    problems.push('blackbox feature verify did not pass the Gherkin run');
  }
  const rows = native.map((title) => {
    const gherkin = verify.scenarios
      .filter((scenario) => isCounterpart(scenario.title, title))
      .map(({ id, title: gherkinTitle, verdict }) => ({ id, title: gherkinTitle, verdict }));
    if (gherkin.length === 0) {
      problems.push(`native scenario has no Gherkin counterpart: ${title}`);
    }
    for (const scenario of gherkin) {
      if (scenario.verdict !== 'supported') {
        problems.push(`Gherkin counterpart is ${scenario.verdict}: ${scenario.title}`);
      }
    }
    return { native: title, gherkin };
  });
  const covered = new Set(rows.flatMap((row) => row.gherkin.map(({ id }) => id)));
  const additional = verify.scenarios
    .filter(({ id }) => !covered.has(id))
    .map(({ title, verdict }) => ({ title, verdict }));
  return { kind: 'gherkin-native-parity', ok: problems.length === 0, problems, rows, additional };
}

/** The 1-based line and column of `step` inside the scenario titled `scenario`. */
function stepSite(featureText, scenario, step) {
  const lines = featureText.split('\n');
  const start = lines.findIndex((line) => line.trim() === scenario);
  if (start === -1) {
    throw new Error(`the feature has no "${scenario}"`);
  }
  for (let index = start + 1; index < lines.length; index += 1) {
    const text = lines[index].trim();
    if (/^(?:Scenario|Scenario Outline|Rule|Example):/u.test(text)) break;
    if (text === step) {
      return { line: index + 1, column: lines[index].indexOf(step) + 1 };
    }
  }
  throw new Error(`"${scenario}" has no step "${step}"`);
}

function testsByTitle(report) {
  const tests = new Map();
  walkSuites(report.suites, [], (spec) => {
    tests.set(spec.title, [...(tests.get(spec.title) ?? []), ...spec.tests]);
  });
  return tests;
}

function stepsOf(steps, found = []) {
  for (const step of steps ?? []) {
    found.push(step);
    stepsOf(step.steps, found);
  }
  return found;
}

const sameSite = (location, file, site) =>
  location !== undefined &&
  resolve(location.file) === file &&
  location.line === site.line &&
  location.column === site.column;

/**
 * Checks the no-persist run: `report` is its Playwright JSON report and
 * `verify` its `blackbox feature verify --json` result.
 */
function negativeControl({ featureFile, featureText, report, verify }) {
  const problems = [];
  const file = resolve(featureFile);
  const site = stepSite(featureText, NO_PERSIST_SCENARIO, STORED_STATE_STEP);
  const titled = testsByTitle(report).get(NO_PERSIST_SCENARIO) ?? [];
  const results = titled.flatMap((test) => test.results ?? []);
  let reported = null;
  if (titled.length !== 1 || results.length !== 1) {
    problems.push(`expected one run of "${NO_PERSIST_SCENARIO}", found ${results.length}`);
  } else {
    const [result] = results;
    reported = result.errors?.[0]?.location ?? null;
    if (result.status !== 'failed') {
      problems.push(`"${NO_PERSIST_SCENARIO}" ended ${result.status}, not failed`);
    }
    if (!sameSite(result.errors?.[0]?.location, file, site)) {
      problems.push(
        `the failure is reported at ${JSON.stringify(reported)}, not at ${file}:${site.line}:${site.column}`,
      );
    }
    const steps = stepsOf(result.steps);
    const failing = steps.filter((step) => step.error !== undefined).map((step) => step.title);
    if (!failing.includes(STORED_STATE_STEP)) {
      problems.push(
        `the stored-state step did not fail; failing steps: ${JSON.stringify(failing)}`,
      );
    }
    for (const title of RESPONSE_STEPS) {
      const step = steps.find((candidate) => candidate.title === title);
      if (step === undefined || step.error !== undefined) {
        problems.push(`the response claim "${title}" did not pass before the stored-state step`);
      }
    }
  }

  // Every failure is a claim at a .feature line, not a Sandbox or runner error.
  const failures = [];
  walkSuites(report.suites, [], (spec) => {
    for (const result of spec.tests.flatMap((test) => test.results ?? [])) {
      if (result.status === 'passed') continue;
      const location = result.errors?.[0]?.location;
      failures.push({ title: spec.title, status: result.status, location: location ?? null });
      if (location === undefined || resolve(location.file) !== file) {
        problems.push(`"${spec.title}" did not fail at a line of ${basename(file)}`);
      }
    }
  });

  if (verify.ok !== false) {
    problems.push('blackbox feature verify passed the no-persist run');
  }
  // Failed tests fail the run, which verify reports too; any other problem
  // (policy drift, a changed feature or library) means the runs differ.
  const beyondVerdicts = verify.problems.filter((problem) => problem !== FAILED_RUN);
  if (beyondVerdicts.length > 0) {
    problems.push(`verify reported more than verdicts: ${JSON.stringify(beyondVerdicts)}`);
  }
  const verdict = verify.scenarios.find((scenario) => scenario.title.endsWith(NO_PERSIST_SCENARIO));
  if (verdict?.verdict !== 'not-supported' || !verdict.reasons.includes('failed')) {
    problems.push(`verify did not record "${NO_PERSIST_SCENARIO}" as not supported (failed)`);
  }

  return {
    kind: 'gherkin-no-persist-control',
    ok: problems.length === 0,
    problems,
    expected: { file, ...site, step: STORED_STATE_STEP },
    reported,
    failures,
    verdicts: verify.scenarios.map(({ title, verdict: outcome }) => ({ title, verdict: outcome })),
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), 'utf8'));
}

const [operation, ...arguments_] = process.argv.slice(2);
let proof;
if (operation === 'parity' && arguments_.length === 2) {
  proof = parity({
    native: nativeScenarios(await readJson(arguments_[0])),
    verify: await readJson(arguments_[1]),
  });
} else if (operation === 'negative-control' && arguments_.length === 3) {
  proof = negativeControl({
    featureFile: arguments_[0],
    featureText: await readFile(resolve(arguments_[0]), 'utf8'),
    report: await readJson(arguments_[1]),
    verify: await readJson(arguments_[2]),
  });
} else {
  throw new Error(
    'Usage: gherkin-proof.mjs <parity native-list verify|negative-control feature results verify>',
  );
}
process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
if (!proof.ok) {
  process.stderr.write(`${proof.kind}: ${proof.problems.join('; ')}\n`);
  process.exitCode = 1;
}
