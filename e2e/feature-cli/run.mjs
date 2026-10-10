#!/usr/bin/env node
// Real CLI and Playwright/Sandbox lifecycle proof. Business closures are deliberately empty.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
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

import { compareStructure, skeleton } from './structure.mjs';
import {
  dockerResources,
  recordsUnder,
  recoverRecords,
  verifyReport,
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

async function command(cwd, executable, arguments_, expected = 0) {
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
  return `${result.stdout}${result.stderr}`;
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

function config(directory, results) {
  return `import { defineConfig } from '@suites/blackbox-playwright/config';
export default defineConfig({
  blackboxConfigFile: './blackbox.config.yaml', testDir: ${JSON.stringify(directory)},
  testMatch: '*.spec.ts', workers: 2, fullyParallel: true, retries: 0, timeout: 180000,
  preserveOutput: 'always', outputDir: ${JSON.stringify(join(results, 'output'))},
  use: { blackboxEnvironment: { FIXTURE_CONTROL_TOKEN: process.env.FIXTURE_CONTROL_TOKEN } },
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
    const cases = await compareStructure(pristine, hand);
    model.push(...cases);
    await assert.rejects(
      compareStructure(
        pristine.replace('Then the response status is', 'Then WRONG response status is'),
        hand,
      ),
      /structure differs/u,
    );
    await writeFile(join(project, `skeleton/${name}.spec.ts`), skeleton(pristine));
    transcript.push(
      `${name}: file validate; suite emit; pristine suite validate`,
      `  overwrite refused; drift rejected; restored suite validated`,
      `  declaration/step-title structure matches ${cases.length} hand-authored cases; changed-title control rejected`,
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

async function nestedNegative(project, playwright, transcript) {
  await mkdir(join(project, 'nested'));
  await mkdir(join(project, 'nested-results'));
  await writeFile(join(project, 'nested.spec.config.ts'), config('./nested', './nested-results'));
  await writeFile(
    join(project, 'nested/illegal.spec.ts'),
    `import { writeFileSync } from 'node:fs';
import { test } from '@suites/blackbox-playwright';
test.system({ kind: 'subsystem', id: 'payment-mock' }, (system) => {
  system.sandbox('outer', (suite) => {
    suite.test('must not execute', ({ sandbox }) => { writeFileSync('body-ran', sandbox.sandboxId); });
    system.sandbox('nested', () => {});
  });
});\n`,
  );
  const before = await dockerResources();
  const output = await command(
    project,
    playwright,
    ['test', '--config', 'nested.spec.config.ts'],
    'failure',
  );
  assert.match(output, /sandbox declarations cannot be nested/u);
  assert.doesNotMatch(output, /Blackbox: sandbox (?:ready|cleaned up)|acquisition: started/u);
  const report = JSON.parse(await readFile(join(project, 'nested-results/results.json'), 'utf8'));
  assert.ok(
    report.errors.some((error) => error.message.includes('sandbox declarations cannot be nested')),
  );
  assert.equal(
    report.stats.expected + report.stats.unexpected + report.stats.skipped + report.stats.flaky,
    0,
    'Nested declaration executed a test',
  );
  await assert.rejects(stat(join(project, 'body-ran')), { code: 'ENOENT' });
  assert.deepEqual(
    await recordsUnder(join(project, 'nested-results')),
    [],
    'Nested declaration acquired a Sandbox',
  );
  assert.deepEqual(await dockerResources(), before, 'Nested declaration changed Docker resources');
  transcript.push(
    'nested sandbox: collection rejected; 0 executed tests; 0 Sandbox records; Docker resources unchanged',
  );
}

async function cleanup(project, retained, runtime) {
  if (runtime) {
    const records = [];
    for (const name of ['results', 'nested-results']) {
      try {
        records.push(...(await recordsUnder(join(project, name))));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    const recovery = await recoverRecords(records, runtime.recoverSandbox);
    await writeFile(join(retained, 'recovery.json'), JSON.stringify(recovery, null, 2));
  }
  for (const name of ['generated', 'skeleton', 'results', 'nested-results']) {
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
    'Scope: generated declarations, step titles, client readiness, Sandbox acquisition and cleanup.',
    'Business step bodies: empty; business semantics are not tested.',
  ];
  let runtime;
  let failure;
  try {
    runtime = await prepare(project, retained);
    await mkdir(join(project, 'generated'));
    await mkdir(join(project, 'skeleton'));
    const model = await compile(project, runtime.blackbox, 'generated', transcript);
    assert.equal(model.length, 7, 'Expected five subscription and two refund scenarios');
    await writeFile(join(retained, 'structure.json'), JSON.stringify(model, null, 2));
    await nestedNegative(project, runtime.playwright, transcript);
    await mkdir(join(project, 'results'));
    await writeFile(join(project, 'playwright.config.ts'), config('./skeleton', './results'));
    await command(project, runtime.playwright, ['test', '--config', 'playwright.config.ts']);
    const report = JSON.parse(await readFile(join(project, 'results/results.json'), 'utf8'));
    const steps = JSON.parse(await readFile(join(project, 'results/steps.json'), 'utf8'));
    verifyReport(report, model, steps);
    const records = await recordsUnder(join(project, 'results'));
    await verifySandboxes(records, model.length);
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
