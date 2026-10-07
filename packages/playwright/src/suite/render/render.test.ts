import { describe, expect, it } from 'vitest';

import { sentences } from '../sentences.js';
import { FEATURE } from '../testing/feature.js';
import { renderScenario, renderStep, renderSuite } from './render.js';

// Requirement: a feature outline renders to the source of a new suite file,
// a new test or a new step. Each scenario is a test inside
// test.system(...).sandbox(...); each Gherkin step is one test.step titled
// '<keyword> <text>'. A library sentence's body is exactly the library call
// with the feature's values and doc string; any other step's body throws
// 'TODO: step not in library'. The header names the feature and says to fill
// in TODO steps and keep scenario titles and step lines.

const SUITE = String.raw`// Generated from features/subscription.feature by ${'`'}blackbox feature suite emit${'`'}.
// Fill in the TODO steps: each one throws until it has a body.
// Keep scenario titles and step lines as they are: drift compares them with the feature.
import { runSentence, sandboxCredentials, sandboxEnvironment, test } from '@suites/blackbox-playwright';

const credentials = sandboxCredentials({ 'fixture-control': { scheme: 'bearer', fromEnv: 'BLACKBOX_SUITE_FIXTURE_TOKEN' } });

test.system('subscription-system', (system) => {
  system.sandbox('default', { environment: sandboxEnvironment({ 'FIXTURE_CONTROL_TOKEN': { fromEnv: 'BLACKBOX_SUITE_FIXTURE_TOKEN' } }) }, (suite) => {
    suite.test('the public API reports ready', async ({ request, sandbox }) => {
      const fixtures = { credentials, request, sandbox, world: new Map<string, unknown>() };
      await test.step('When the client sends GET "/health"', async () => {
        await runSentence(fixtures, 'the client sends GET {string}', ['/health'], { kind: 'none' });
      });
      await test.step('Then the response status is 200', async () => {
        await runSentence(fixtures, 'the response status is {int}', [200], { kind: 'none' });
      });
      await test.step('And the response has "/status" equal to:', async () => {
        await runSentence(fixtures, 'the response has {string} equal to:', ['/status'], { kind: 'doc-string', content: '"ready"', mediaType: 'json' });
      });
    });

    suite.test('an eligible user subscribes', async ({ request, sandbox }) => {
      const fixtures = { credentials, request, sandbox, world: new Map<string, unknown>() };
      await test.step('When the client sends POST "/subscriptions" with JSON:', async () => {
        await runSentence(fixtures, 'the client sends {word} {string} with JSON:', ['POST', '/subscriptions'], { kind: 'doc-string', content: '{"userId": "alice"}', mediaType: null });
      });
      await test.step('Then the response status is 201', async () => {
        await runSentence(fixtures, 'the response status is {int}', [201], { kind: 'none' });
      });
      await test.step('And the state at "/fixture/state" as "fixture-control" has 1 item at "/subscriptions"', async () => {
        await runSentence(fixtures, 'the state at {string} as {string} has {int} item(s) at {string}', ['/fixture/state', 'fixture-control', 1, '/subscriptions'], { kind: 'none' });
      });
      await test.step('And the user\'s welcome email is sent', () => {
        throw new Error('TODO: step not in library');
      });
    });
  });
});
`;

describe('renderSuite', () => {
  it('renders a suite file with library calls for known sentences and TODOs for the rest', () => {
    expect(renderSuite(FEATURE, sentences)).toBe(SUITE);
  });

  it('leaves the library out of a suite whose steps are all TODOs', () => {
    const todo = {
      keyword: 'Given',
      text: 'nothing the library knows',
      argument: { kind: 'none' },
      line: 3,
    } as const;
    const rendered = renderSuite(
      { ...FEATURE, scenarios: [{ title: 'only TODOs', line: 2, steps: [todo] }] },
      sentences,
    );
    expect(rendered).toContain(
      "import { sandboxEnvironment, test } from '@suites/blackbox-playwright';\n\ntest.system(",
    );
    expect(rendered).toContain(
      "    suite.test('only TODOs', async () => {\n      await test.step('Given nothing the library knows', () => {\n",
    );
    expect(rendered).not.toContain('credentials');
  });
});

describe('renderScenario and renderStep', () => {
  it('render a new test and a new step indented as they sit in a suite file', () => {
    const [ready, subscribe] = FEATURE.scenarios;
    expect(renderScenario(ready, sentences)).toBe(SUITE.split('\n').slice(9, 21).join('\n'));
    expect(renderStep(subscribe.steps[3], sentences)).toBe(
      [
        "      await test.step('And the user\\'s welcome email is sent', () => {",
        "        throw new Error('TODO: step not in library');",
        '      });',
      ].join('\n'),
    );
  });

  it('renders a data table and escapes every character that would end a literal', () => {
    const step = {
      keyword: 'When',
      text: 'the client sends these requests concurrently:',
      argument: {
        kind: 'data-table',
        rows: [
          ['method', 'path', 'json'],
          ['POST', '/a', '{"note": "it\'s\\n"}'],
        ],
      },
      line: 9,
    } as const;
    expect(renderStep(step, sentences).split('\n')[1]).toBe(
      String.raw`        await runSentence(fixtures, 'the client sends these requests concurrently:', [], { kind: 'data-table', rows: [['method', 'path', 'json'], ['POST', '/a', '{"note": "it\'s\\n"}']] });`,
    );
    const multiline = {
      ...step,
      text: 'line one\nline two \u2028 end',
      argument: { kind: 'none' },
    } as const;
    expect(renderStep(multiline, sentences).split('\n')[0]).toBe(
      String.raw`      await test.step('When line one\nline two \u2028 end', () => {`,
    );
  });
});
