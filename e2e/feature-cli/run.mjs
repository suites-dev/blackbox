#!/usr/bin/env node
// Execute generated Feature business callbacks against packed packages and isolated real systems.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { businessCallbacks, compareStructure, executionSuite } from './structure.mjs';
import { prepareRefundPersistenceFault } from './fault-control.mjs';
import {
  dockerResources,
  recordsUnder,
  recoverRecords,
  verifyReport,
  verifyRefundFailure,
  verifyDisjointSandboxes,
  verifySandboxes,
} from './proof.mjs';

const execute = promisify(execFile);
const cancellation = new AbortController();
process.once('SIGINT', () => cancellation.abort());
process.once('SIGTERM', () => cancellation.abort());
const here = dirname(fileURLToPath(import.meta.url));
const e2e = dirname(here);
const workspace = dirname(e2e);
const registry = process.env.BLACKBOX_TEST_REGISTRY ?? 'http://127.0.0.1:4874/';
const update = process.env.BLACKBOX_GOLDEN_UPDATE === '1';
assert.ok(!(update && process.env.CI === 'true'), 'Golden updates are refused in CI');
const args = process.argv.slice(2);
assert.ok(
  args.length === 0 || (args.length === 2 && args[0] === '--repeat'),
  'Usage: node e2e/feature-cli/run.mjs [--repeat N]',
);
const repeat = args.length === 0 ? 1 : Number(args[1]);
assert.ok(
  Number.isSafeInteger(repeat) && repeat > 0 && repeat <= 10,
  'Repeat must be 1 through 10',
);
assert.ok(!update || repeat === 1, 'Golden updates require exactly one run');
const artifactParent = join(workspace, '.blackbox/tmp/ci-feature-cli');
await mkdir(artifactParent, { recursive: true });
const evidence = await mkdtemp(join(artifactParent, 'run-'));
const token = randomBytes(24).toString('hex');
const env = {
  ...process.env,
  NO_COLOR: '1',
  NPM_CONFIG_REGISTRY: registry,
  FIXTURE_CONTROL_TOKEN: token,
};
delete env.BLACKBOX_CAPSULE;
delete env.NODE_OPTIONS;
const { version } = JSON.parse(await readFile(join(workspace, 'lerna.json'), 'utf8'));
let commandIndex = 0;

async function commandResult(cwd, executable, arguments_, expected = 0) {
  const name = String(++commandIndex).padStart(3, '0');
  let result;
  try {
    result = {
      ...(await execute(executable, arguments_, {
        cwd,
        env,
        timeout: 900_000,
        maxBuffer: 32 * 1024 * 1024,
        signal: cancellation.signal,
      })),
      status: 0,
    };
  } catch (error) {
    if (typeof error.code !== 'number') throw error;
    result = { stdout: error.stdout ?? '', stderr: error.stderr ?? '', status: error.code };
  }
  await writeFile(
    join(evidence, `${name}.json`),
    JSON.stringify({ executable, arguments: arguments_, status: result.status }, null, 2),
  );
  await writeFile(
    join(evidence, `${name}.log`),
    `${result.stdout}${result.stderr}`.replaceAll(token, '<fixture-token>'),
  );
  if (expected === 'failure')
    assert.notEqual(result.status, 0, `Command unexpectedly passed: ${arguments_.join(' ')}`);
  else
    assert.equal(
      result.status,
      expected,
      `Command failed: ${arguments_.join(' ')}; see ${name}.log`,
    );
  return { output: `${result.stdout}${result.stderr}`, exitCode: result.status };
}

async function command(cwd, executable, arguments_, expected = 0) {
  return (await commandResult(cwd, executable, arguments_, expected)).output;
}

async function prepare(project, retained) {
  await writeFile(
    join(project, 'package.json'),
    JSON.stringify(
      {
        name: 'blackbox-feature-cli-consumer',
        private: true,
        type: 'module',
        dependencies: {
          '@suites/blackbox': version,
          '@suites/blackbox-cli': version,
          '@suites/blackbox-feature': version,
          '@suites/blackbox-playwright': version,
          '@suites/blackbox-inst-runtime-node': version,
        },
      },
      null,
      2,
    ),
  );
  await command(project, 'npm', [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--registry',
    registry,
  ]);
  const require = createRequire(join(project, 'package.json'));
  const boundary = [];
  for (const name of [
    '@suites/blackbox-cli',
    '@suites/blackbox-feature',
    '@suites/blackbox-playwright',
    '@suites/blackbox-sandbox',
  ]) {
    const directory = await realpath(join(project, 'node_modules', ...name.split('/')));
    assert.ok(
      !relative(project, directory).startsWith('..'),
      `${name} escaped the registry consumer`,
    );
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    assert.equal(manifest.version, version, 'Consumer package version differs from the candidate');
    boundary.push({ name, version: manifest.version, directory });
  }
  await writeFile(join(retained, 'package-boundary.json'), JSON.stringify(boundary, null, 2));
  await mkdir(join(project, '.blackbox/catalog'), { recursive: true });
  await cp(join(e2e, 'blackbox.config.yaml'), join(project, 'blackbox.config.yaml'));
  for (const name of await readdir(join(e2e, '.blackbox/catalog'))) {
    const source = await readFile(join(e2e, '.blackbox/catalog', name), 'utf8');
    await writeFile(
      join(project, '.blackbox/catalog', name),
      source.replaceAll('../../sut', join(e2e, 'sut')),
    );
  }
  await cp(join(e2e, '.blackbox/clients'), join(project, '.blackbox/clients'), { recursive: true });
  await cp(join(here, 'reporter.mjs'), join(project, 'feature-reporter.mjs'));
  await cp(join(e2e, 'tests/features-suites'), join(project, 'features'), { recursive: true });
  const blackbox = join(project, 'node_modules/.bin/blackbox');
  const startup = await command(project, blackbox, ['--version']);
  assert.ok(startup.includes(version), 'CLI startup did not report the packed version');
  await command(project, blackbox, ['inst', 'install', '--runtime', 'node']);
  await stat(join(project, '.blackbox/instrumentation/node_modules'));
  const { recoverSandbox } = require('@suites/blackbox-sandbox');
  return { blackbox, playwright: join(project, 'node_modules/.bin/playwright'), recoverSandbox };
}

function config(directory, results, configFile = './blackbox.config.yaml') {
  return `import { defineConfig } from '@suites/blackbox-playwright/config';
export default defineConfig({
  blackboxConfigFile: ${JSON.stringify(configFile)}, testDir: ${JSON.stringify(directory)},
  testMatch: '*.spec.ts', workers: 2, fullyParallel: true, retries: 0, timeout: 180000,
  preserveOutput: 'always', outputDir: ${JSON.stringify(join(results, 'output'))},
  reporter: [['./feature-reporter.mjs', { outputFile: ${JSON.stringify(join(results, 'steps.json'))} }], ['list', { printSteps: true }], ['@suites/blackbox-playwright/reporter', { sandboxLifecycle: true }], ['json', { outputFile: ${JSON.stringify(join(results, 'results.json'))} }]],
});\n`;
}

async function compile(project, blackbox, generated, transcript) {
  const model = [];
  for (const name of ['subscription-activation', 'payment-refunds']) {
    const source = `features/${name}.feature`;
    const output = `${generated}/${name}.spec.ts`;
    const flags = ['--clients', '.blackbox/clients/feature-cli.ts'];
    assert.match(
      await command(project, blackbox, ['feature', 'file', 'validate', source, ...flags]),
      /Feature is executable:/u,
    );
    await command(project, blackbox, [
      'feature',
      'suite',
      'emit',
      source,
      ...flags,
      '--output',
      output,
    ]);
    await command(project, blackbox, [
      'feature',
      'suite',
      'validate',
      source,
      ...flags,
      '--output',
      output,
    ]);
    const pristine = await readFile(join(project, output), 'utf8');
    assert.match(
      await command(
        project,
        blackbox,
        ['feature', 'suite', 'emit', source, ...flags, '--output', output],
        'failure',
      ),
      /Refusing to overwrite/u,
    );
    await writeFile(join(project, output), `${pristine}\n// deliberate drift control\n`);
    assert.match(
      await command(
        project,
        blackbox,
        ['feature', 'suite', 'validate', source, ...flags, '--output', output],
        'failure',
      ),
      /has drifted/u,
    );
    await writeFile(join(project, output), pristine);
    await command(project, blackbox, [
      'feature',
      'suite',
      'validate',
      source,
      ...flags,
      '--output',
      output,
    ]);
    const hand = await readFile(join(project, `features/${name}.spec.ts`), 'utf8');
    const selection = /@(system|subsystem):([\w-]+)/u.exec(
      await readFile(join(project, source), 'utf8'),
    );
    assert.ok(selection, 'Reviewed Feature must declare its catalog selection');
    const catalog = [{ kind: selection[1], id: selection[2] }];
    const cases = await compareStructure(pristine, hand, catalog);
    model.push(...cases);
    await assert.rejects(
      compareStructure(
        pristine.replace('Then the response status is', 'Then WRONG response status is'),
        hand,
        catalog,
      ),
      /structure differs/u,
    );
    const environmentSources = { FIXTURE_CONTROL_TOKEN: 'FIXTURE_CONTROL_TOKEN' };
    const execution = executionSuite(pristine, environmentSources);
    await compareStructure(execution, executionSuite(hand, environmentSources), catalog);
    await writeFile(join(project, `execution/${name}.spec.ts`), execution);
    const callbacks = businessCallbacks(pristine);
    assert.deepEqual(businessCallbacks(execution), callbacks);
    await writeFile(
      join(project, `execution/${name}.callbacks.json`),
      JSON.stringify(
        {
          count: callbacks.length,
          pristineSha256: createHash('sha256').update(JSON.stringify(callbacks)).digest('hex'),
          executionSha256: createHash('sha256')
            .update(JSON.stringify(businessCallbacks(execution)))
            .digest('hex'),
        },
        null,
        2,
      ),
    );
    transcript.push(
      `${name}: file validate; suite emit; pristine suite validate`,
      `  overwrite refused; drift rejected; restored suite validated`,
      `  declaration/step-title structure matches ${cases.length} hand-authored cases; changed-title control rejected`,
      '  generated business callbacks unchanged; only explicit environment configuration added',
    );
  }
  const unsupported = 'features/redis-proof-delivery.feature';
  const unsupportedOutput = `${generated}/redis-proof-delivery.spec.ts`;
  for (const [verb, flags] of [
    ['file', []],
    ['suite', ['--output', unsupportedOutput]],
  ]) {
    const output = await command(
      project,
      blackbox,
      [
        'feature',
        verb,
        verb === 'file' ? 'validate' : 'emit',
        unsupported,
        '--clients',
        '.blackbox/clients/feature-cli.ts',
        ...flags,
      ],
      'failure',
    );
    assert.match(output, /FEATURE_STEP_UNSUPPORTED/u);
  }
  await assert.rejects(stat(join(project, unsupportedOutput)), { code: 'ENOENT' });
  transcript.push('redis-proof-delivery: unsupported async vocabulary rejected; no suite written');
  return model;
}

async function unselectedNegative(project, playwright, transcript) {
  await mkdir(join(project, 'unselected'));
  await mkdir(join(project, 'unselected-results'));
  await writeFile(
    join(project, 'unselected.spec.config.ts'),
    config('./unselected', './unselected-results'),
  );
  await writeFile(
    join(project, 'unselected/missing-system.spec.ts'),
    `import { writeFileSync } from 'node:fs';
import { test } from '@suites/blackbox-playwright';
test('must not execute', ({ sandbox }) => { writeFileSync('body-ran', sandbox.sandboxId); });\n`,
  );
  const before = await dockerResources();
  const output = await command(
    project,
    playwright,
    ['test', '--config', 'unselected.spec.config.ts'],
    'failure',
  );
  assert.match(output, /selects a system/u);
  assert.doesNotMatch(output, /Blackbox: sandbox (?:ready|cleaned up)|acquisition: started/u);
  const report = JSON.parse(
    await readFile(join(project, 'unselected-results/results.json'), 'utf8'),
  );
  assert.ok(report.suites.some((suite) => JSON.stringify(suite).includes('selects a system')));
  assert.equal(
    report.stats.unexpected,
    1,
    'Missing-system fixture did not fail its discovered test',
  );
  await assert.rejects(stat(join(project, 'body-ran')), { code: 'ENOENT' });
  assert.deepEqual(
    await recordsUnder(join(project, 'unselected-results')),
    [],
    'Missing-system fixture acquired a Sandbox',
  );
  assert.deepEqual(
    await dockerResources(),
    before,
    'Missing-system fixture changed Docker resources',
  );
  transcript.push(
    'unselected system: fixture rejected; 1 failed test; body not executed; 0 Sandbox records; Docker resources unchanged',
  );
}

async function refundPersistenceNegative(project, runtime, model, transcript) {
  const generatedSuite = join(project, 'execution/payment-refunds.spec.ts');
  const unchangedSuite = await readFile(generatedSuite, 'utf8');
  const fault = await prepareRefundPersistenceFault(project);
  runtime.fault = fault;
  await writeFile(
    join(project, 'fault-control.json'),
    JSON.stringify(
      {
        ...fault,
        generatedSuiteSha256: createHash('sha256').update(unchangedSuite).digest('hex'),
      },
      null,
      2,
    ),
  );
  await mkdir(join(project, 'fault-results'));
  await writeFile(
    join(project, 'fault.spec.config.ts'),
    config('./execution', './fault-results', fault.configFile),
  );
  const result = await commandResult(
    project,
    runtime.playwright,
    [
      'test',
      '--config',
      'fault.spec.config.ts',
      '--grep',
      'Scenario: A repeated refund retains exactly one refund',
    ],
    'failure',
  );
  const report = JSON.parse(await readFile(join(project, 'fault-results/results.json'), 'utf8'));
  const live = JSON.parse(await readFile(join(project, 'fault-results/steps.json'), 'utf8'));
  assert.equal(
    await readFile(generatedSuite, 'utf8'),
    unchangedSuite,
    'Fault control changed the generated refund scenario',
  );
  verifyRefundFailure(report, model, live, result.exitCode);
  const records = await recordsUnder(join(project, 'fault-results'));
  await verifySandboxes(records, 1, dockerResources, { stopReason: 'failed' });
  const count = verifyDisjointSandboxes(runtime.positiveRecords, records);
  assert.equal(count, 8, 'Expected seven positive and one fault Sandbox');
  await writeFile(
    join(project, 'attempt-isolation.json'),
    JSON.stringify(
      {
        count,
        attempts: [...runtime.positiveRecords, ...records].map(({ value }) => ({
          sandboxId: value.sandboxId,
          projectName: value.projectName,
          stopReason: value.stopReason,
          cleanup: value.cleanup,
        })),
      },
      null,
      2,
    ),
  );
  transcript.push(
    'refund persistence fault: unchanged generated repeated-refund scenario; HTTP 201 then 409; final retained-state assertion failed',
    'Fault Playwright: 1 discovered, 1 failed as intended, 0 skipped, 0 retried',
    'Fault Sandbox: 1 distinct record; failed; cleanup complete; 0 owned Docker resources remain',
  );
}

async function removeFaultImage(project, retained, fault) {
  const existing = await command(project, 'docker', ['image', 'ls', '--quiet', fault.image]);
  if (existing.trim()) await command(project, 'docker', ['image', 'rm', fault.image]);
  const remaining = await command(project, 'docker', ['image', 'ls', '--quiet', fault.image]);
  assert.equal(remaining.trim(), '', 'Owned fault image remains after cleanup');
  await writeFile(
    join(retained, 'fault-image-cleanup.json'),
    JSON.stringify(
      {
        image: fault.image,
        removed: existing.trim() !== '',
        remaining: [],
      },
      null,
      2,
    ),
  );
}

async function cleanup(project, retained, runtime) {
  if (runtime) {
    const records = [];
    for (const name of ['results', 'unselected-results', 'fault-results']) {
      try {
        records.push(...(await recordsUnder(join(project, name))));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    const recovery = await recoverRecords(records, runtime.recoverSandbox);
    await writeFile(join(retained, 'recovery.json'), JSON.stringify(recovery, null, 2));
    if (runtime.fault) await removeFaultImage(project, retained, runtime.fault);
  }
  for (const name of [
    'generated',
    'execution',
    'results',
    'unselected-results',
    'fault-results',
    'fault-control.json',
    'attempt-isolation.json',
    'fault-blackbox.config.yaml',
    '.blackbox/catalog/payment-refund-persistence-fault.yml',
    'refund-persistence-fault.diff',
    'fault-sut',
  ]) {
    try {
      await cp(join(project, name), join(retained, name), { recursive: true });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  await rm(project, { recursive: true, force: true });
}

async function run(pass) {
  const project = await realpath(await mkdtemp('/tmp/bbf-'));
  const retained = join(evidence, `pass-${pass}`);
  await mkdir(retained);
  const transcript = [
    'Feature CLI journey',
    'Scope: generated business operations and assertions, declarations, client readiness, Sandbox isolation and cleanup.',
    'Business step bodies: unchanged generated callbacks; real positive execution and retained-refund fault control.',
  ];
  let runtime;
  let failure;
  try {
    runtime = await prepare(project, retained);
    await mkdir(join(project, 'generated'));
    await mkdir(join(project, 'execution'));
    const model = await compile(project, runtime.blackbox, 'generated', transcript);
    assert.equal(model.length, 7, 'Expected five subscription and two refund scenarios');
    await writeFile(join(retained, 'structure.json'), JSON.stringify(model, null, 2));
    await unselectedNegative(project, runtime.playwright, transcript);
    await mkdir(join(project, 'results'));
    await writeFile(join(project, 'playwright.config.ts'), config('./execution', './results'));
    await command(project, runtime.playwright, ['test', '--config', 'playwright.config.ts']);
    const report = JSON.parse(await readFile(join(project, 'results/results.json'), 'utf8'));
    const steps = JSON.parse(await readFile(join(project, 'results/steps.json'), 'utf8'));
    verifyReport(report, model, steps);
    const records = await recordsUnder(join(project, 'results'));
    await verifySandboxes(records, model.length);
    runtime.positiveRecords = records;
    for (const scenario of model) {
      transcript.push(
        `${scenario.path.join(' / ')} / ${scenario.title}${scenario.example ? ` [${scenario.example}]` : ''}`,
      );
      for (const background of scenario.backgrounds)
        transcript.push(`  ${background.title}`, ...background.steps.map((step) => `    ${step}`));
      transcript.push(...scenario.steps.map((step) => `  ${step}`));
    }
    transcript.push(
      'Playwright: 7 discovered, 7 passed, 0 skipped, 0 retried',
      'Sandbox: 7 distinct records and Compose projects; completed; cleanup complete',
      'Docker: 0 owned containers, networks, or volumes remain',
    );
    await refundPersistenceNegative(project, runtime, model, transcript);
  } catch (error) {
    failure = error;
  } finally {
    try {
      await cleanup(project, retained, runtime);
    } catch (error) {
      failure = new AggregateError(
        [failure, error].filter(Boolean),
        `Cleanup failed; project retained at ${project}`,
      );
    }
  }
  const actual = `${transcript.join('\n')}\n`;
  await writeFile(join(retained, 'actual.golden'), actual);
  if (failure) throw failure;
  const golden = join(here, 'acceptance.golden');
  if (update) await writeFile(golden, actual);
  const expected = await readFile(golden, 'utf8');
  await writeFile(join(retained, 'expected.golden'), expected);
  assert.equal(
    actual,
    expected,
    'Feature CLI golden differs; inspect actual.golden and expected.golden',
  );
  console.log(`Feature CLI journey pass ${pass}: passed; evidence ${retained}`);
}

console.log(`Feature CLI evidence: ${evidence}`);
for (let pass = 1; pass <= repeat; pass += 1) await run(pass);
