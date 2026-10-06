import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { PROJECT_FILE } from '../check/testing/repository.js';
import FeatureCompile from '../cli/commands/feature/compile.js';
import { CATALOG, useCommands, type CommandRun } from './testing/commands.js';

// Rule-dodging suite, compile gate (hard rules 3, 4 and 5). Each feature here
// tries to get a scenario that is selected, run or judged differently past
// `blackbox feature compile`: a tag that would select, skip, invert or re-time
// it, a step the shared library does not define, and a telemetry claim whose
// evidence could end inconclusive. compile must exit 1, name each attempt at
// its file:line:column and generate nothing. Each case has a control: the same
// feature without the attempt compiles, so the failure is the attempt's.
// Run-time attempts (a swapped reporter, changed retries or timeouts, filtered
// scenarios, flaky and expected-to-fail results) are judged where they are
// enforced, by the Playwright run and `blackbox feature verify`.

const runCommand = useCommands(beforeAll, afterAll, vi);

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const FEATURE = 'features/dodging.feature';
const SELECTED = '@system:subscription-system @sandbox:default';

/** Compiles one feature in a fresh project with the real CLI command and the shared step library. */
async function compile(feature: string): Promise<CommandRun & { readonly generated: boolean }> {
  const root = await mkdtemp(join(tmpdir(), 'blackbox-gherkin-dodging-'));
  roots.push(root);
  await mkdir(join(root, 'features'));
  await writeFile(join(root, 'blackbox.gherkin.json'), `${JSON.stringify(PROJECT_FILE, null, 2)}\n`);
  await writeFile(join(root, 'blackbox.config.yaml'), CATALOG);
  await writeFile(join(root, FEATURE), feature);
  const run = await runCommand(FeatureCompile, ['--config', join(root, 'blackbox.gherkin.json')]);
  return { ...run, generated: (await readdir(root)).includes('.features-gen') };
}

const NOTHING_GENERATED = 'compile: failed; nothing was generated';

describe('a forbidden tag does not compile', () => {
  const tagged = (tags: Readonly<Record<'feature' | 'scenario' | 'rule' | 'ruleScenario' | 'examples', string>>) => `${SELECTED}${tags.feature}
Feature: dodging tags

  ${tags.scenario}
  Scenario: a tag that would select or re-run a scenario
    When the client sends GET "/health"
    Then the response status is 200

  ${tags.rule}
  Rule: tags on a rule

    ${tags.ruleScenario}
    Scenario: tags that would skip, invert, re-time or re-target a scenario
      When the client sends GET "/health"
      Then the response status is 200

  Scenario Outline: a tag on the examples
    When the client sends GET "<path>"
    Then the response status is 200

    ${tags.examples}
    Examples:
      | path    |
      | /health |
`;

  it('control: the same feature with only allowed tags compiles', async () => {
    const run = await compile(
      tagged({ feature: ' @requirement:REQ-1', scenario: '@requirement:REQ-2', rule: '@requirement:REQ-3', ruleScenario: '', examples: '' }),
    );
    expect(run.exit, run.stderr).toBe(0);
    expect(run.generated).toBe(true);
  });

  it('exits 1, names every forbidden tag at its location and generates nothing', async () => {
    const run = await compile(
      tagged({
        feature: ' @smoke',
        scenario: '@only @retries:3 @requirement:smoke',
        rule: '@serial',
        ruleScenario: '@skip @fail @slow @timeout:60000 @system:payment-mock @System:subscription-system',
        examples: '@requirement:REQ-9',
      }),
    );
    expect(run.exit).toBe(1);
    expect(run.generated).toBe(false);
    const notAllowed = (at: string, tag: string) =>
      `${FEATURE}:${at}: tag "${tag}" is not allowed; only @system:<id>, @sandbox:<profile> and @requirement:REQ-<n> are accepted`;
    expect(run.stderr.trim().split('\n')).toEqual([
      notAllowed('1:46', '@smoke'),
      notAllowed('4:3', '@only'),
      notAllowed('4:9', '@retries:3'),
      `${FEATURE}:4:20: requirement ID "smoke" must match REQ-<n>`,
      notAllowed('9:3', '@serial'),
      notAllowed('12:5', '@skip'),
      notAllowed('12:11', '@fail'),
      notAllowed('12:17', '@slow'),
      notAllowed('12:23', '@timeout:60000'),
      `${FEATURE}:12:38: @system: is not allowed on Scenario (allowed on Feature)`,
      notAllowed('12:59', '@System:subscription-system'),
      `${FEATURE}:21:5: @requirement: is not allowed on Examples (allowed on Feature, Rule, Scenario)`,
      NOTHING_GENERATED,
      'EEXIT: 1',
    ]);
  });
});

describe('a step outside the shared library does not compile', () => {
  const scenario = (steps: string) => `${SELECTED}
Feature: dodging steps

  Scenario: steps the shared library does not define
${steps}
`;

  it('control: the same scenario with library steps compiles', async () => {
    const run = await compile(scenario('    When the client sends GET "/health"\n    Then the response status is 200'));
    expect(run.exit, run.stderr).toBe(0);
    expect(run.generated).toBe(true);
  });

  it('exits 1, names every unknown step at its location and generates nothing', async () => {
    const run = await compile(
      scenario(
        [
          '    When the client sends DELETE "/subscriptions/alice"',
          '    Then the subscription of "alice" is active',
          '    And the response status is 200 within 5 seconds',
          '    And the response status is 200',
        ].join('\n'),
      ),
    );
    expect(run.exit).toBe(1);
    expect(run.generated).toBe(false);
    const undefinedStep = (at: string, step: string) =>
      `${FEATURE}:${at}: undefined step "${step}"; only steps from the shared Blackbox step library are allowed`;
    expect(run.stderr.trim().split('\n')).toEqual([
      undefinedStep('5:5', 'When the client sends DELETE "/subscriptions/alice"'),
      undefinedStep('6:5', 'Then the subscription of "alice" is active'),
      undefinedStep('7:5', 'And the response status is 200 within 5 seconds'),
      NOTHING_GENERATED,
      'EEXIT: 1',
    ]);
  });
});

// Behind the compile gate, a generated step whose capability the runtime does
// not offer fails without running (runtime/run-step.test.ts), and the gated
// claim's body only rejects (library/steps/gated.ts), so it can never pass.
describe('a telemetry claim, whose evidence could be inconclusive, does not compile in v1', () => {
  const scenario = (claim: string) => `${SELECTED}
Feature: dodging telemetry

  Scenario: a claim on telemetry effects
    When the client sends GET "/health"
    Then the flow is sealed by the terminal response
${claim}
`;

  it('control: the same scenario with a response claim instead compiles', async () => {
    const run = await compile(scenario('    And the response status is 200'));
    expect(run.exit, run.stderr).toBe(0);
    expect(run.generated).toBe(true);
  });

  it('exits 1 naming the capability the claim needs, and generates nothing', async () => {
    const run = await compile(scenario('    And the effects satisfy:\n      | quantifier | kind |\n      | exists     | http |'));
    expect(run.exit).toBe(1);
    expect(run.generated).toBe(false);
    expect(run.stderr.trim().split('\n')).toEqual([
      `${FEATURE}:7:5: step "And the effects satisfy:" needs capability "effects-claims", which this Blackbox runtime does not offer`,
      NOTHING_GENERATED,
      'EEXIT: 1',
    ]);
  });
});
