import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { expectedCatalogForSpec } from './playwright-evidence.mjs';
import { collectImageInputs, declaredMutableInputs } from './playwright-image-inputs.mjs';
import {
  verifyAttemptReports,
  verifyEffectReports,
  verifyParallelAcquisition,
} from './playwright-report-proof.mjs';

const execute = promisify(execFile);

function parallelAcquisitions() {
  return {
    attempts: [
      {
        file: 'payments.spec.ts',
        workerIndex: 0,
        acquisitionStartedAt: 0,
        acquisitionCompletedAt: 10,
      },
      {
        file: 'payments.spec.ts',
        workerIndex: 1,
        acquisitionStartedAt: 1,
        acquisitionCompletedAt: 11,
      },
      {
        file: 'subscriptions.spec.ts',
        workerIndex: 0,
        acquisitionStartedAt: 10,
        acquisitionCompletedAt: 20,
      },
    ],
  };
}

test('requires overlapping sandbox acquisition both within and across files', () => {
  verifyParallelAcquisition(parallelAcquisitions());
  const serial = parallelAcquisitions();
  serial.attempts.forEach((attempt, index) => {
    attempt.acquisitionStartedAt = index * 10;
    attempt.acquisitionCompletedAt = (index + 1) * 10;
  });
  assert.throws(() => verifyParallelAcquisition(serial), /within a test file/);
  const acrossOnly = parallelAcquisitions();
  acrossOnly.attempts[1].file = 'orders.spec.ts';
  assert.throws(() => verifyParallelAcquisition(acrossOnly), /within a test file/);
  const withinOnly = parallelAcquisitions();
  withinOnly.attempts[2].file = 'payments.spec.ts';
  assert.throws(() => verifyParallelAcquisition(withinOnly), /across test files/);
});

test('rejects worker reuse and missing acquisition timings as parallel evidence', () => {
  const oneWorker = parallelAcquisitions();
  oneWorker.attempts.forEach((attempt) => {
    attempt.workerIndex = 0;
  });
  assert.throws(() => verifyParallelAcquisition(oneWorker), /within a test file/);
  const missing = parallelAcquisitions();
  missing.attempts[0].acquisitionStartedAt = null;
  assert.throws(() => verifyParallelAcquisition(missing), /within a test file/);
});

test('attributes helper callsites to their catalog without treating helpers as entry files', () => {
  for (const helper of ['browser', 'database', 'messaging']) {
    assert.deepEqual(
      expectedCatalogForSpec(
        `/consumer/tests/playwright/effects-acceptance-${helper}.ts`,
        'candidate case',
      ),
      { kind: 'system', id: 'effects-acceptance' },
    );
  }
  assert.deepEqual(
    expectedCatalogForSpec(
      '/consumer/tests/playwright/effects-acceptance-database.ts',
      '@withheld successful action stays inconclusive under positive and negated matchers',
    ),
    { kind: 'system', id: 'effects-withheld' },
  );

  const helpersOnly = parallelAcquisitions();
  helpersOnly.attempts.forEach((attempt, index) => {
    attempt.file = 'effects-acceptance.spec.ts';
    attempt.sourceFile = `effects-acceptance-${['browser', 'database', 'messaging'][index]}.ts`;
  });
  assert.throws(
    () => verifyParallelAcquisition(helpersOnly),
    /across test files/,
    'Helper source locations must not manufacture entry-file parallelism',
  );
});

test('requires every mutable image to resolve before the candidate run', async () => {
  const pulled = [];
  const result = await collectImageInputs({
    pull: true,
    pullImage: async (declared) => pulled.push(declared),
    inspectImage: async (declared) => ({
      Id: `sha256:${'a'.repeat(64)}`,
      RepoDigests: [`${declared.split(':')[0]}@sha256:${'1'.repeat(64)}`],
      RepoTags: [declared],
    }),
  });
  assert.equal(result.complete, true);
  assert.deepEqual(pulled, declaredMutableInputs);

  await assert.rejects(
    collectImageInputs({
      pull: true,
      pullImage: async () => undefined,
      inspectImage: async () => ({ Id: 'mutable-tag-only' }),
    }),
    /immutable image ID/,
  );
});

test('cleanup records unavailable image inputs without pulling or masking the primary failure', async () => {
  let pulls = 0;
  const result = await collectImageInputs({
    pull: false,
    pullImage: async () => {
      pulls++;
    },
    inspectImage: async (declared) => {
      if (declared === 'node:22.22.0-bookworm-slim') {
        throw new Error('image was never pulled');
      }
      return { Id: `sha256:${'2'.repeat(64)}`, RepoDigests: [], RepoTags: [declared] };
    },
  });
  assert.equal(pulls, 0);
  assert.equal(result.complete, false);
  assert.deepEqual(
    result.images.find(({ declared }) => declared === 'node:22.22.0-bookworm-slim'),
    { declared: 'node:22.22.0-bookworm-slim', state: 'unavailable' },
  );
});

test('image evidence CLI executes through a filesystem alias', async () => {
  const root = await mkdtemp(join(tmpdir(), 'blackbox-image-cli-'));
  try {
    const binary = join(root, 'bin');
    const docker = join(binary, 'docker');
    const alias = join(root, 'image-inputs-alias.mjs');
    await mkdir(binary);
    await writeFile(
      docker,
      `#!/usr/bin/env bash
set -eu
[[ "$1:$2" == 'image:inspect' ]]
printf '[{"Id":"sha256:%s","RepoDigests":[],"RepoTags":[]}]\\n' '${'3'.repeat(64)}'
`,
    );
    await chmod(docker, 0o755);
    await symlink(fileURLToPath(new URL('./playwright-image-inputs.mjs', import.meta.url)), alias);
    const { stdout } = await execute(process.execPath, [alias], {
      env: { ...process.env, PATH: `${binary}:${process.env.PATH}` },
    });
    const receipt = JSON.parse(stdout);
    assert.equal(receipt.kind, 'playwright-image-inputs');
    assert.equal(receipt.resolution, 'cleanup-snapshot');
    assert.equal(receipt.complete, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function fixture(suffix = 'a', testId = `test-${suffix}`, retry = 0) {
  const owner = {
    testId,
    retry,
    workerIndex: 0,
    parallelIndex: 0,
    outputDirectory: `/output/${suffix}`,
  };
  const document = {
    schemaVersion: 1,
    owner,
    identity: {
      kind: 'acquired',
      sandboxId: `run-${suffix}`,
      executionId: `run-${suffix}`,
      sessionId: `session-${suffix}`,
      catalogEntry: { kind: 'system', id: 'subscription-system' },
    },
    events: [
      'catalog',
      'acquisition',
      'instrumentation',
      'readiness',
      'sandbox',
      'teardown',
      'collector',
    ].map((phase) => ({ phase, status: 'completed', detail: '' })),
  };
  document.events.push({
    phase: 'observations',
    status: 'info',
    detail: '3 requests; 21 spans; 2 traces',
  });
  return {
    document,
    input: {
      attempts: [
        {
          ...owner,
          expectedCatalog: { ...document.identity.catalogEntry },
          stdout: [
            {
              text: 'Blackbox: sandbox ready for system "subscription-system"\nBlackbox: sandbox cleaned up for system "subscription-system"\n',
            },
          ],
          attachments: [
            {
              name: 'blackbox-attempt',
              body: Buffer.from(JSON.stringify(document)).toString('base64'),
            },
            {
              name: 'blackbox-diagnostics',
              body: Buffer.from('retained lifecycle').toString('base64'),
            },
          ],
        },
      ],
      records: [
        {
          recordDirectory: `/output/${suffix}/blackbox`,
          value: { sandboxId: `run-${suffix}`, cleanup: 'complete' },
        },
      ],
      live: { errors: [], attempts: [{ ...owner, sandboxId: `run-${suffix}` }] },
      text: 'Then And\n1 passed (1s)',
    },
  };
}

function withheldFixture() {
  const result = fixture('withheld', 'withheld-test');
  const { document, input } = result;
  document.identity.catalogEntry = { kind: 'system', id: 'effects-withheld' };
  document.events.find(({ phase }) => phase === 'observations').detail = '0 requests; 0 spans';
  input.attempts[0].title =
    '@withheld successful action stays inconclusive under positive and negated matchers';
  input.attempts[0].expectedCatalog = { ...document.identity.catalogEntry };
  input.attempts[0].stdout[0].text =
    'Blackbox: sandbox ready for system "effects-withheld"\nBlackbox: sandbox cleaned up for system "effects-withheld"\n';
  input.attempts[0].attachments[0].body = Buffer.from(JSON.stringify(document)).toString('base64');
  return result;
}

test('accepts matched live, retained and Docker cleanup evidence', () => {
  const { input } = fixture();
  assert.equal(verifyAttemptReports(input).attempts.length, 1);
});

test('accepts zero received telemetry only for the withheld scenario', () => {
  assert.equal(verifyAttemptReports(withheldFixture().input).attempts.length, 1);

  const received = withheldFixture();
  received.document.events.find(({ phase }) => phase === 'observations').detail =
    '1 requests; 1 spans; 1 traces';
  received.input.attempts[0].attachments[0].body = Buffer.from(
    JSON.stringify(received.document),
  ).toString('base64');
  assert.throws(() => verifyAttemptReports(received.input), /claimed received telemetry/);

  const missing = fixture();
  missing.document.events.find(({ phase }) => phase === 'observations').detail =
    '0 requests; 0 spans';
  missing.input.attempts[0].attachments[0].body = Buffer.from(
    JSON.stringify(missing.document),
  ).toString('base64');
  assert.throws(() => verifyAttemptReports(missing.input), /no received telemetry/);

  const mismatched = withheldFixture().input;
  mismatched.attempts[0].title = 'ordinary case';
  assert.throws(() => verifyAttemptReports(mismatched), /title and catalog/);
});

function pair(sameTest = false) {
  const first = fixture('a', 'first', 0).input;
  const second = fixture('b', sameTest ? 'first' : 'second', sameTest ? 1 : 0).input;
  return {
    attempts: [...first.attempts, ...second.attempts],
    records: [...first.records, ...second.records],
    live: { errors: [], attempts: [...first.live.attempts, ...second.live.attempts] },
    text: `${first.text}\n${second.text}`,
  };
}

for (const sameTest of [false, true]) {
  test(`rejects swapped attachments across ${sameTest ? 'retries' : 'tests'}`, () => {
    const input = pair(sameTest);
    assert.equal(verifyAttemptReports(input).attempts.length, 2);
    const [first, second] = input.attempts;
    [first.attachments, second.attachments] = [second.attachments, first.attachments];
    assert.throws(() => verifyAttemptReports(input), /different Playwright attempt/);
  });
}

test('rejects swapped live sandbox attribution even when retained reports are valid', () => {
  const input = pair();
  const [first, second] = input.live.attempts;
  [first.sandboxId, second.sandboxId] = [second.sandboxId, first.sandboxId];
  assert.throws(() => verifyAttemptReports(input), /Live report belongs/);
});

test('rejects missing live attempts disguised by duplicate counts', () => {
  const input = pair();
  input.live.attempts[1] = input.live.attempts[0];
  assert.throws(() => verifyAttemptReports(input), /Live report belongs/);
});

test('rejects another scenario catalog, worker identity, or output record', () => {
  const catalog = fixture().input;
  catalog.attempts[0].expectedCatalog = { kind: 'subsystem', id: 'payment-mock' };
  assert.throws(() => verifyAttemptReports(catalog), /catalog does not match/);
  const worker = fixture().input;
  worker.attempts[0].workerIndex++;
  assert.throws(() => verifyAttemptReports(worker), /different Playwright attempt/);
  const output = fixture().input;
  output.records[0].recordDirectory = '/output/another-attempt/blackbox';
  assert.throws(() => verifyAttemptReports(output), /owning attempt output directory/);
});

for (const phase of [
  'catalog',
  'acquisition',
  'instrumentation',
  'readiness',
  'sandbox',
  'teardown',
  'collector',
]) {
  test(`rejects a report falsely omitting ${phase}`, () => {
    const { input, document } = fixture();
    document.events = document.events.filter((event) => event.phase !== phase);
    input.attempts[0].attachments[0].body = Buffer.from(JSON.stringify(document)).toString(
      'base64',
    );
    assert.throws(() => verifyAttemptReports(input), new RegExp(`phase: ${phase}`));
  });
}

test('rejects delayed progress, unrelated sandboxes, and leaked fixture secrets', () => {
  const delayed = fixture().input;
  delayed.live.errors.push('Business step started before live readiness was reported');
  assert.throws(() => verifyAttemptReports(delayed), /Live reporting failed/);
  const unrelated = fixture().input;
  unrelated.records[0].value.sandboxId = 'someone-elses-run';
  assert.throws(() => verifyAttemptReports(unrelated), /no matching cleaned Sandbox/);
  const secret = fixture().input;
  secret.text += ' playwright-e2e-token';
  assert.throws(() => verifyAttemptReports(secret), /leaked/);
});

test('rejects missing or duplicated lifecycle output and custom terminal rendering', () => {
  const missing = fixture().input;
  missing.attempts[0].stdout = [];
  assert.throws(() => verifyAttemptReports(missing), /Native per-test stdout/);
  const duplicate = fixture().input;
  duplicate.attempts[0].stdout.push(...duplicate.attempts[0].stdout);
  assert.throws(() => verifyAttemptReports(duplicate), /Native per-test stdout/);
  for (const extra of [
    'Blackbox · passed',
    '[1]   ✓ passed',
    'Docker health: starting',
    'waiting for Compose',
  ]) {
    const verbose = fixture().input;
    verbose.text += `\n${extra}`;
    assert.throws(() => verifyAttemptReports(verbose), /native output|internal polling/);
  }
  const diagnostics = fixture().input;
  diagnostics.attempts[0].attachments.pop();
  assert.throws(() => verifyAttemptReports(diagnostics), /Missing retained Blackbox diagnostics/);
});

const effectCases = [
  ['Scenario: a valid payment method creates a payment intent', [['satisfied', 'passed', false]]],
  [
    'PostgreSQL INSERT is observed and persisted state is checked separately',
    [['satisfied', 'passed', false]],
  ],
  [
    'RabbitMQ send is observed and broker delivery is checked separately',
    [['satisfied', 'passed', false]],
  ],
  [
    'an observed forbidden INSERT produces a definite matcher failure',
    [['unsatisfied', 'failed', false]],
  ],
  [
    'inspection SELECT cannot satisfy a stimulus SELECT contract',
    [
      ['satisfied', 'passed', false],
      ['inconclusive', 'inconclusive', false],
    ],
  ],
  ...['alpha', 'beta'].map((destination) => [
    `@isolation ${destination} attempt cannot use the other destination`,
    [
      ['satisfied', 'passed', false],
      ['inconclusive', 'inconclusive', false],
    ],
  ]),
  [
    'a rolled-back INSERT remains an observed operation while state is absent',
    [['satisfied', 'passed', false]],
  ],
  [
    'browser stimulus propagates ownership to a PostgreSQL INSERT',
    [['satisfied', 'passed', false]],
  ],
  [
    'plain browser work cannot satisfy a later stimulus contract',
    [
      ['satisfied', 'passed', false],
      ['inconclusive', 'inconclusive', false],
    ],
  ],
  [
    '@withheld successful action stays inconclusive under positive and negated matchers',
    [
      ['inconclusive', 'inconclusive', false],
      ['inconclusive', 'inconclusive', true],
    ],
  ],
];

function encoded(name, document) {
  return { name, body: Buffer.from(JSON.stringify(document)).toString('base64') };
}

function admittedEvidence(suffix, evaluation, selector = { kind: 'db', operation: 'INSERT' }) {
  const scopeId = `scope-${suffix}`;
  const activityId = `activity-${suffix}`;
  const effectId = `effect-${suffix}`;
  const traceId = suffix.padEnd(32, '0').slice(0, 32);
  const spanId = suffix.padEnd(16, '0').slice(0, 16);
  const operationField = {
    db: { key: 'db.operation.name', value: selector.operation },
    http: { key: 'http.request.method', value: selector.operation },
    message: {
      key: 'messaging.operation.type',
      value: selector.operation === 'send' ? 'publish' : selector.operation,
    },
  }[selector.kind];
  return {
    kind: 'admitted',
    observations: {
      scopeId,
      payloadCount: 1,
      diagnostics: [],
      excerpts: [
        {
          traceId,
          spanId,
          service: 'fixture',
          kind: 'client',
          status: 'ok',
          fields: [operationField],
        },
      ],
    },
    selection: {
      scopeId,
      sessionId: `session-${suffix}`,
      executionId: `run-${suffix}`,
      kind: 'stimulus',
      activities: [{ activityId, purpose: 'stimulus', traceIds: [traceId] }],
    },
    projection: {
      schemaVersion: '0.1.1',
      scope: { id: scopeId, closed: true },
      quality: {
        coverage: 'complete',
        orderCoverage: 'complete',
        reasons: [],
        attestation: 'fixture',
      },
      effects: [
        {
          id: effectId,
          kind: selector.kind,
          operation: selector.operation,
          target: selector.target ?? 'records',
          actor: 'app',
          outcome: 'success',
          source: [{ traceId, spanId }],
        },
      ],
      relations: [],
    },
    assessment: {
      status: { satisfied: 'pass', unsatisfied: 'fail', inconclusive: 'inconclusive' }[evaluation],
      scope: scopeId,
      semanticsVersion: '0.1.1',
      findings: [
        {
          index: 0,
          status: {
            satisfied: 'pass',
            unsatisfied: 'fail',
            inconclusive: 'inconclusive',
          }[evaluation],
          reason: 'fixture finding',
          evidence: evaluation === 'inconclusive' ? [] : [effectId],
        },
      ],
    },
    ownership: [
      {
        effectId,
        observations: [{ traceId, spanId, owners: [{ activityId, purpose: 'stimulus' }] }],
      },
    ],
    omitted: Object.fromEntries(
      [
        'activities',
        'activityTraces',
        'diagnostics',
        'observations',
        'effects',
        'effectSources',
        'relations',
        'qualityReasons',
        'findings',
        'findingEvidence',
        'ownership',
        'owners',
      ].map((name) => [name, 0]),
    ),
  };
}

function withheldEvidence(suffix) {
  const scopeId = `scope-${suffix}`;
  const activityId = `activity-${suffix}`;
  const traceId = suffix.padEnd(32, '0').slice(0, 32);
  const missingTrace = `activity-trace-not-received:${activityId}:${traceId}`;
  return {
    kind: 'admitted',
    observations: {
      scopeId,
      payloadCount: 0,
      diagnostics: [
        'explicit-activity-trace-admission',
        'trusted-manifest-not-authenticated',
        missingTrace,
      ],
      excerpts: [],
    },
    selection: {
      scopeId,
      sessionId: `session-${suffix}`,
      executionId: `run-${suffix}`,
      kind: 'stimulus',
      activities: [{ activityId, purpose: 'stimulus', traceIds: [traceId] }],
    },
    projection: {
      schemaVersion: '0.1.1',
      scope: { id: scopeId, closed: false },
      quality: {
        coverage: 'unknown',
        orderCoverage: 'unknown',
        reasons: ['no-harness-completeness-attestation'],
        attestation: 'none',
      },
      effects: [],
      relations: [],
    },
    assessment: {
      status: 'inconclusive',
      findings: [
        {
          index: 0,
          status: 'inconclusive',
          reason: 'atLeast 1; observed lower=0, upper=unbounded',
          evidence: [],
        },
      ],
      scope: scopeId,
      semanticsVersion: '0.1.0',
    },
    ownership: [],
    omitted: Object.fromEntries(
      [
        'activities',
        'activityTraces',
        'diagnostics',
        'observations',
        'effects',
        'effectSources',
        'relations',
        'qualityReasons',
        'findings',
        'findingEvidence',
        'ownership',
        'owners',
      ].map((name) => [name, 0]),
    ),
  };
}

function withheldDiagnostic(evidence) {
  return `Scope ${evidence.selection.scopeId}: inconclusive [0] inconclusive: atLeast 1; observed lower=0, upper=unbounded; evidence= ${evidence.observations.diagnostics.join(' ')} no-harness-completeness-attestation`;
}

function effectContract(title, index) {
  let selector = { node: 'selector', kind: 'db', operation: 'INSERT' };
  let operator = 'atLeast';
  let count = 1;
  if (title === 'Scenario: a valid payment method creates a payment intent') {
    selector = { node: 'selector', kind: 'http', operation: 'POST' };
  } else if (title === 'RabbitMQ send is observed and broker delivery is checked separately') {
    selector = {
      node: 'selector',
      kind: 'message',
      operation: 'send',
      target: 'acceptance.alpha',
    };
  } else if (title === 'an observed forbidden INSERT produces a definite matcher failure') {
    operator = 'exactly';
    count = 0;
  } else if (title === 'inspection SELECT cannot satisfy a stimulus SELECT contract') {
    selector =
      index === 0
        ? {
            node: 'selector',
            kind: 'message',
            operation: 'send',
            target: 'acceptance.alpha',
          }
        : { node: 'selector', kind: 'db', operation: 'SELECT' };
  } else if (title.startsWith('@isolation ')) {
    const own = title.includes(' alpha ') ? 'alpha' : 'beta';
    const target = index === 0 ? own : own === 'alpha' ? 'beta' : 'alpha';
    selector = {
      node: 'selector',
      kind: 'message',
      operation: 'send',
      target: `acceptance.${target}`,
    };
  } else if (
    title === 'plain browser work cannot satisfy a later stimulus contract' &&
    index === 0
  ) {
    selector = {
      node: 'selector',
      kind: 'message',
      operation: 'send',
      target: 'acceptance.beta',
    };
  }
  return {
    schemaVersion: 1,
    constraints: [{ node: 'constraint', operator, count, selector }],
    omitted: { constraints: 0, selectorWhereEntries: 0 },
  };
}

function effectAttempts() {
  return effectCases.map(([title, assertions], caseIndex) => {
    const suffix = String(caseIndex + 1);
    return {
      title,
      attachments: [
        encoded('blackbox-attempt', {
          identity: { sessionId: `session-${suffix}`, executionId: `run-${suffix}` },
        }),
        ...assertions.map(([evaluation, outcome, negated], assertionIndex) => {
          const evidence = title.startsWith('@withheld ')
            ? withheldEvidence(suffix)
            : admittedEvidence(
                suffix,
                evaluation,
                effectContract(title, assertionIndex).constraints[0].selector,
              );
          return encoded('blackbox-effects', {
            schemaVersion: 1,
            assertion: {
              sequence: assertionIndex + 1,
              negated,
              outcome,
              evaluation,
              diagnostic: title.startsWith('@withheld ')
                ? withheldDiagnostic(evidence)
                : evaluation === 'satisfied'
                  ? ''
                  : 'bounded diagnostic',
              contract: effectContract(title, assertionIndex),
            },
            display: { stringLimit: 1000, truncatedStrings: 0 },
            evidence,
          });
        }),
      ],
    };
  });
}

function rewriteAttachment(attachment, update) {
  const document = JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8'));
  update(document);
  attachment.body = Buffer.from(JSON.stringify(document)).toString('base64');
}

test('accepts complete, owned and bounded effects attachment evidence', () => {
  assert.equal(verifyEffectReports(effectAttempts()).assertions, 16);
});

test('rejects missing effects evidence and unstable assertion sequences', () => {
  const missing = effectAttempts();
  missing[0].attachments.pop();
  assert.throws(() => verifyEffectReports(missing), /Expected 1 effects assertions/);

  const sequence = effectAttempts();
  const effectAttachment = sequence[4].attachments[2];
  rewriteAttachment(effectAttachment, (document) => {
    document.assertion.sequence = 1;
  });
  assert.throws(() => verifyEffectReports(sequence), /sequence is not stable/);
});

test('rejects swapped identities and fabricated ownership', () => {
  const identity = effectAttempts();
  rewriteAttachment(identity[1].attachments[1], (document) => {
    document.evidence.selection.executionId = 'another-run';
  });
  assert.throws(() => verifyEffectReports(identity), /execution identity/);

  const ownership = effectAttempts();
  rewriteAttachment(ownership[1].attachments[1], (document) => {
    document.evidence.ownership[0].effectId = 'invented-effect';
  });
  assert.throws(() => verifyEffectReports(ownership), /unprojected effect/);
});

test('rejects missing raw observations and broken source joins', () => {
  const missing = effectAttempts();
  rewriteAttachment(missing[1].attachments[1], (document) => {
    document.evidence.observations.excerpts = [];
  });
  assert.throws(() => verifyEffectReports(missing), /raw observation excerpts/);

  const source = effectAttempts();
  rewriteAttachment(source[1].attachments[1], (document) => {
    document.evidence.projection.effects[0].source[0].spanId = 'another-span';
  });
  assert.throws(() => verifyEffectReports(source), /join to raw observation excerpts/);

  const ownership = effectAttempts();
  rewriteAttachment(ownership[1].attachments[1], (document) => {
    document.evidence.ownership[0].observations[0].traceId = 'another-trace';
  });
  assert.throws(() => verifyEffectReports(ownership), /selected raw observations/);
});

test('rejects invented unknown effects and finding evidence outside its selector', () => {
  const unknown = effectAttempts();
  rewriteAttachment(unknown[1].attachments[1], (document) => {
    document.evidence.projection.effects[0].kind = 'unknown';
  });
  assert.throws(() => verifyEffectReports(unknown), /invented an unknown effect/);

  const finding = effectAttempts();
  rewriteAttachment(finding[2].attachments[1], (document) => {
    document.evidence.projection.effects[0].target = 'acceptance.other';
  });
  assert.throws(() => verifyEffectReports(finding), /does not satisfy its reported selector/);
});

test('rejects verdict drift', () => {
  const verdict = effectAttempts();
  rewriteAttachment(verdict[3].attachments[1], (document) => {
    document.assertion.outcome = 'passed';
  });
  assert.throws(() => verifyEffectReports(verdict), /Unexpected effects outcome/);
});

test('rejects fabricated observations and effects in withheld evidence', () => {
  const observation = effectAttempts();
  rewriteAttachment(observation.at(-1).attachments[1], (document) => {
    document.evidence.observations.excerpts.push({ traceId: 'fabricated', spanId: 'fabricated' });
  });
  assert.throws(() => verifyEffectReports(observation), /fabricated telemetry observations/);

  const effect = effectAttempts();
  rewriteAttachment(effect.at(-1).attachments[1], (document) => {
    document.evidence.projection.effects.push({ id: 'fabricated-effect' });
  });
  assert.throws(() => verifyEffectReports(effect), /fabricated projected evidence/);
});

test('rejects foreign identity and missing trace diagnostics in withheld evidence', () => {
  const identity = effectAttempts();
  rewriteAttachment(identity.at(-1).attachments[1], (document) => {
    document.evidence.selection.sessionId = 'foreign-session';
  });
  assert.throws(() => verifyEffectReports(identity), /attempt identity/);

  const evidenceDiagnostic = effectAttempts();
  rewriteAttachment(evidenceDiagnostic.at(-1).attachments[1], (document) => {
    document.evidence.observations.diagnostics = ['explicit-activity-trace-admission'];
  });
  assert.throws(() => verifyEffectReports(evidenceDiagnostic), /selected-trace diagnostic/);

  const assertionDiagnostic = effectAttempts();
  rewriteAttachment(assertionDiagnostic.at(-1).attachments[1], (document) => {
    document.assertion.diagnostic = 'inconclusive without trace identity';
  });
  assert.throws(() => verifyEffectReports(assertionDiagnostic), /selected-trace diagnostic/);
});

test('rejects false completeness and definite withheld verdicts', () => {
  const closed = effectAttempts();
  rewriteAttachment(closed.at(-1).attachments[1], (document) => {
    document.evidence.projection.scope.closed = true;
  });
  assert.throws(() => verifyEffectReports(closed), /graph completeness/);

  const complete = effectAttempts();
  rewriteAttachment(complete.at(-1).attachments[1], (document) => {
    document.evidence.projection.quality.coverage = 'complete';
  });
  assert.throws(() => verifyEffectReports(complete), /graph completeness/);

  const passed = effectAttempts();
  rewriteAttachment(passed.at(-1).attachments[1], (document) => {
    document.assertion.outcome = 'passed';
  });
  assert.throws(() => verifyEffectReports(passed), /Unexpected effects outcome/);

  const negated = effectAttempts();
  rewriteAttachment(negated.at(-1).attachments[2], (document) => {
    document.assertion.negated = false;
  });
  assert.throws(() => verifyEffectReports(negated), /Unexpected effects negated/);
});

test('rejects finding evidence and omitted data for a withheld trace', () => {
  const finding = effectAttempts();
  rewriteAttachment(finding.at(-1).attachments[1], (document) => {
    document.evidence.assessment.findings[0].evidence = ['fabricated-effect'];
  });
  assert.throws(() => verifyEffectReports(finding), /fabricated a definite result/);

  const omitted = effectAttempts();
  rewriteAttachment(omitted.at(-1).attachments[1], (document) => {
    document.evidence.omitted.observations = 1;
  });
  assert.throws(() => verifyEffectReports(omitted), /omitted report data/);
});
