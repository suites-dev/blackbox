import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const script = resolve(dirname(fileURLToPath(import.meta.url)), 'gherkin-proof.mjs');

const ELIGIBLE = 'Scenario: an eligible user receives an active subscription';
const UNKNOWN = 'Scenario: an unknown user is rejected without side effects';
const REPEATED = 'Scenario: a repeated request does not repeat downstream effects';
const FULL_PATH = 'Rule: full-path subscriptions settle every required effect';
const INVALID = 'Rule: invalid subscription attempts have no side effects';
const ONE = 'Rule: a user can hold only one subscription';
const STORED =
  'And the state at "/fixture/state" as "fixture-control" has "/subscriptions" equal to:';

// Line 9 holds the stored-state step of the eligible-user scenario, at column 7.
const FEATURE = `@system:subscription-system @sandbox:default
Feature: Subscription intake

  Rule: full-path subscriptions settle every required effect

    Scenario: an eligible user receives an active subscription
      When the client sends POST "/subscriptions" with JSON:
      And the response status is 201
      ${STORED}
        """json
        []
        """

  Rule: a user can hold only one subscription

    Scenario: a repeated request does not repeat downstream effects
      And the response status is 409
`;

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'blackbox-gherkin-proof-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function prove(root, operation, files) {
  const paths = [];
  for (const [name, content] of files) {
    const path = join(root, name);
    await writeFile(path, typeof content === 'string' ? content : JSON.stringify(content));
    paths.push(path);
  }
  try {
    const { stdout } = await execute(process.execPath, [script, operation, ...paths]);
    return { code: 0, proof: JSON.parse(stdout) };
  } catch (error) {
    return { code: error.code, proof: JSON.parse(error.stdout), stderr: error.stderr };
  }
}

// `playwright test --list --reporter=json` for the native config: both spec
// files, below the system and sandbox describes.
function nativeListing(scenarios) {
  const specFile = 'subscription-system.spec.ts';
  return {
    suites: [
      {
        title: specFile,
        file: specFile,
        specs: [],
        suites: [
          {
            title: 'system "subscription-system"',
            file: specFile,
            suites: [
              {
                title: 'sandbox "default"',
                file: specFile,
                suites: scenarios.map(([rule, title]) => ({
                  title: rule,
                  file: specFile,
                  specs: [{ title, file: specFile, tests: [] }],
                })),
              },
            ],
          },
        ],
      },
      {
        title: 'payment-service.spec.ts',
        file: 'payment-service.spec.ts',
        specs: [{ title: 'Scenario: a refund', file: 'payment-service.spec.ts', tests: [] }],
      },
    ],
  };
}

const NATIVE = [
  [FULL_PATH, ELIGIBLE],
  [INVALID, UNKNOWN],
];

function scenario(title, verdict = 'supported') {
  return {
    id: `features/x.feature:${title.length}`,
    title,
    verdict,
    reasons: verdict === 'supported' ? [] : ['failed'],
  };
}

const SUPPORTED_RUN = {
  ok: true,
  problems: [],
  scenarios: [
    scenario(`${FULL_PATH} › ${ELIGIBLE}`),
    scenario(`${INVALID} › ${UNKNOWN} [user=ghost-user, method=pm_ghost]`),
    scenario(`${INVALID} › ${UNKNOWN} [user=mallory, method=pm_mallory_1]`),
    scenario(`${ONE} › ${REPEATED}`),
  ],
};

test('parity holds when every native scenario has a supported Gherkin counterpart', async (t) => {
  const root = await workspace(t);
  const { code, proof } = await prove(root, 'parity', [
    ['native.json', nativeListing(NATIVE)],
    ['verify.json', SUPPORTED_RUN],
  ]);
  assert.equal(code, 0);
  assert.deepEqual(proof.problems, []);
  assert.deepEqual(
    proof.rows.map((row) => [row.native, row.gherkin.length]),
    [
      [`${FULL_PATH} › ${ELIGIBLE}`, 1],
      [`${INVALID} › ${UNKNOWN}`, 2],
    ],
  );
  assert.deepEqual(proof.additional, [{ title: `${ONE} › ${REPEATED}`, verdict: 'supported' }]);
});

test('parity fails for a native scenario without a counterpart or under another Rule', async (t) => {
  const root = await workspace(t);
  const { code, proof } = await prove(root, 'parity', [
    [
      'native.json',
      nativeListing([...NATIVE, [ONE, ELIGIBLE], [ONE, 'Scenario: concurrent requests']]),
    ],
    ['verify.json', SUPPORTED_RUN],
  ]);
  assert.equal(code, 1);
  assert.deepEqual(proof.problems, [
    `native scenario has no Gherkin counterpart: ${ONE} › ${ELIGIBLE}`,
    `native scenario has no Gherkin counterpart: ${ONE} › Scenario: concurrent requests`,
  ]);
});

test('parity fails when a counterpart is not supported or verify failed', async (t) => {
  const root = await workspace(t);
  const flaky = {
    ok: false,
    problems: [],
    scenarios: SUPPORTED_RUN.scenarios.map((entry, index) =>
      index === 2 ? { ...entry, verdict: 'not-supported', reasons: ['flaky'] } : entry,
    ),
  };
  const { code, proof } = await prove(root, 'parity', [
    ['native.json', nativeListing(NATIVE)],
    ['verify.json', flaky],
  ]);
  assert.equal(code, 1);
  assert.deepEqual(proof.problems, [
    'blackbox feature verify did not pass the Gherkin run',
    `Gherkin counterpart is not-supported: ${INVALID} › ${UNKNOWN} [user=mallory, method=pm_mallory_1]`,
  ]);
});

test('parity fails when the listing has no native subscription test', async (t) => {
  const root = await workspace(t);
  const { code, proof } = await prove(root, 'parity', [
    ['native.json', { suites: [] }],
    ['verify.json', SUPPORTED_RUN],
  ]);
  assert.equal(code, 1);
  assert.deepEqual(proof.problems, [
    'the native listing has no test from subscription-system.spec.ts',
  ]);
});

function step(title, error) {
  return error ? { title, error: { message: error } } : { title };
}

// A Playwright JSON report of the no-persist run. `eligible` overrides the
// eligible-user result; the repeated-request scenario fails at its status claim.
function noPersistReport(featureFile, eligible = {}) {
  const at = (line, column = 7) => ({ file: featureFile, line, column });
  const result = {
    status: 'failed',
    errors: [{ message: 'expected [] to equal [...]', location: at(9) }],
    steps: [
      {
        title: 'Before Hooks',
        steps: [step('Given the state at "/fixture/state" as "fixture-control" equals:')],
      },
      step('When the client sends POST "/subscriptions" with JSON:'),
      step('And the response status is 201'),
      step('And the response JSON equals:'),
      step(STORED, 'expected [] to equal [...]'),
    ],
    ...eligible,
  };
  const spec = (title, results) => ({
    title,
    file: 'features/x.feature.spec.mjs',
    tests: [{ results }],
  });
  return {
    suites: [
      {
        title: 'features/x.feature.spec.mjs',
        suites: [
          { title: FULL_PATH, specs: [spec(ELIGIBLE, [result])] },
          {
            title: ONE,
            specs: [
              spec(REPEATED, [{ status: 'failed', errors: [{ location: at(16) }], steps: [] }]),
              spec(`${UNKNOWN} [user=ghost-user]`, [{ status: 'passed', errors: [], steps: [] }]),
            ],
          },
        ],
      },
    ],
  };
}

const NO_PERSIST_VERIFY = {
  ok: false,
  problems: ['the run status is "failed", not "passed"'],
  scenarios: [
    { ...scenario(`${FULL_PATH} › ${ELIGIBLE}`), verdict: 'not-supported', reasons: ['failed'] },
    { ...scenario(`${ONE} › ${REPEATED}`), verdict: 'not-supported', reasons: ['failed'] },
  ],
};

async function negativeControl(t, report, verify = NO_PERSIST_VERIFY) {
  const root = await workspace(t);
  const featureFile = join(root, 'subscription-intake.feature');
  return prove(root, 'negative-control', [
    ['subscription-intake.feature', FEATURE],
    ['results.json', typeof report === 'function' ? report(featureFile) : report],
    ['verify.json', verify],
  ]);
}

test('the negative control passes when the stored-state step fails at its .feature line', async (t) => {
  const { code, proof } = await negativeControl(t, (feature) => noPersistReport(feature));
  assert.equal(code, 0);
  assert.deepEqual(proof.problems, []);
  assert.equal(proof.expected.line, 9);
  assert.equal(proof.expected.column, 7);
  assert.equal(proof.reported.line, 9);
  assert.deepEqual(
    proof.failures.map((failure) => [failure.title, failure.location.line]),
    [
      [ELIGIBLE, 9],
      [REPEATED, 16],
    ],
  );
});

test('the negative control fails when the failure is reported at the generated spec', async (t) => {
  const { code, proof } = await negativeControl(t, (feature) =>
    noPersistReport(feature, {
      errors: [
        { location: { file: join(dirname(feature), 'x.feature.spec.mjs'), line: 20, column: 9 } },
      ],
    }),
  );
  assert.equal(code, 1);
  assert.match(
    proof.problems[0],
    /^the failure is reported at .*x\.feature\.spec\.mjs.*, not at .*subscription-intake\.feature:9:7$/u,
  );
  assert.ok(
    proof.problems.includes(`"${ELIGIBLE}" did not fail at a line of subscription-intake.feature`),
  );
});

test('the negative control fails when the scenario fails at another claim', async (t) => {
  // A broken response, not missing state: the status claim fails first.
  const { code, proof } = await negativeControl(t, (feature) =>
    noPersistReport(feature, {
      errors: [{ location: { file: feature, line: 8, column: 7 } }],
      steps: [step('And the response status is 201', 'expected 500 to be 201')],
    }),
  );
  assert.equal(code, 1);
  assert.deepEqual(proof.problems.slice(1), [
    'the stored-state step did not fail; failing steps: ["And the response status is 201"]',
    'the response claim "And the response status is 201" did not pass before the stored-state step',
    'the response claim "And the response JSON equals:" did not pass before the stored-state step',
  ]);
});

test('the negative control fails when the app stored the subscription after all', async (t) => {
  const { code, proof } = await negativeControl(
    t,
    (feature) => noPersistReport(feature, { status: 'passed', errors: [], steps: [] }),
    { ...NO_PERSIST_VERIFY, scenarios: [scenario(`${FULL_PATH} › ${ELIGIBLE}`)] },
  );
  assert.equal(code, 1);
  assert.ok(proof.problems.includes(`"${ELIGIBLE}" ended passed, not failed`));
  assert.ok(
    proof.problems.includes(`verify did not record "${ELIGIBLE}" as not supported (failed)`),
  );
});

test('the negative control fails when another failure is not a .feature claim', async (t) => {
  const { code, proof } = await negativeControl(t, (feature) => {
    const report = noPersistReport(feature);
    report.suites[0].suites[1].specs[0].tests[0].results[0].errors = [
      {
        message: 'Sandbox acquisition failed',
        location: { file: '/consumer/node_modules/x.js', line: 1, column: 1 },
      },
    ];
    return report;
  });
  assert.equal(code, 1);
  assert.deepEqual(proof.problems, [
    `"${REPEATED}" did not fail at a line of subscription-intake.feature`,
  ]);
});

test('the negative control fails when verify reports more than verdicts or passes', async (t) => {
  const drift = {
    ...NO_PERSIST_VERIFY,
    problems: [
      ...NO_PERSIST_VERIFY.problems,
      'runner policy differs from the baseline: workers 2 -> 1',
    ],
  };
  const drifted = await negativeControl(t, (feature) => noPersistReport(feature), drift);
  assert.equal(drifted.code, 1);
  assert.deepEqual(drifted.proof.problems, [
    'verify reported more than verdicts: ["runner policy differs from the baseline: workers 2 -> 1"]',
  ]);

  const passed = await negativeControl(t, (feature) => noPersistReport(feature), {
    ...NO_PERSIST_VERIFY,
    ok: true,
  });
  assert.equal(passed.code, 1);
  assert.deepEqual(passed.proof.problems, ['blackbox feature verify passed the no-persist run']);
});

test('the proof refuses a feature without the stored-state step', async (t) => {
  const root = await workspace(t);
  await writeFile(
    join(root, 'f.feature'),
    FEATURE.replace(STORED, 'And the response JSON equals:'),
  );
  await writeFile(join(root, 'r.json'), '{"suites":[]}');
  await writeFile(join(root, 'v.json'), JSON.stringify(NO_PERSIST_VERIFY));
  await assert.rejects(
    execute(process.execPath, [
      script,
      'negative-control',
      join(root, 'f.feature'),
      join(root, 'r.json'),
      join(root, 'v.json'),
    ]),
    (error) => error.stderr.includes(`"${ELIGIBLE}" has no step "${STORED}"`),
  );
});
