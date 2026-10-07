import { matchSentence } from '../match.js';
import type {
  FeatureOutline,
  FeatureSandboxProfile,
  FeatureScenario,
  FeatureStep,
} from '../outline.js';
import type { Sentence } from '../sentences.js';
import { argumentLiteral, indent, quote, valuesLiteral } from './source.js';

// Skeleton rendering: a feature outline becomes the source of a committed
// suite file. Each scenario is a test inside test.system(...).sandbox(...),
// and each Gherkin step is one test.step titled with its keyword and text. A
// step that is a library sentence calls the library with the feature's
// values; any other step throws until someone writes it, so it never passes.

/** The module a rendered suite imports its runtime from. */
export const SUITE_RUNTIME_MODULE = '@suites/blackbox-playwright';

/** The error a TODO step throws. */
export const TODO_MESSAGE = 'TODO: step not in library';

/** The command that writes skeletons, as a header and a drift fix name it. */
export const EMIT_COMMAND = 'blackbox feature suite emit';

const SCENARIO_DEPTH = 2;
const STEP_DEPTH = 3;

function stepTitle(step: FeatureStep): string {
  return `${step.keyword} ${step.text}`;
}

function stepSource(step: FeatureStep, sentences: readonly Sentence[]): string {
  const match = matchSentence(sentences, step.text);
  const body =
    match.kind === 'known'
      ? [
          `await test.step(${quote(stepTitle(step))}, async () => {`,
          `  await runSentence(fixtures, ${quote(match.expression)}, ${valuesLiteral(match.values)}, ${argumentLiteral(step.argument)});`,
        ]
      : [
          `await test.step(${quote(stepTitle(step))}, () => {`,
          `  throw new Error(${quote(TODO_MESSAGE)});`,
        ];
  return [...body, '});'].join('\n');
}

function usesLibrary(steps: readonly FeatureStep[], sentences: readonly Sentence[]): boolean {
  return steps.some((step) => matchSentence(sentences, step.text).kind === 'known');
}

function scenarioSource(scenario: FeatureScenario, sentences: readonly Sentence[]): string {
  const library = usesLibrary(scenario.steps, sentences);
  const opening = library
    ? [
        `suite.test(${quote(scenario.title)}, async ({ request, sandbox }) => {`,
        '  const fixtures = { credentials, request, sandbox, world: new Map<string, unknown>() };',
      ]
    : [`suite.test(${quote(scenario.title)}, async () => {`];
  const steps = scenario.steps.map((step) => indent(stepSource(step, sentences), 1));
  return [...opening, ...steps, '});'].join('\n');
}

/** A new step, indented as it sits inside a test of a rendered suite file. */
export function renderStep(step: FeatureStep, sentences: readonly Sentence[]): string {
  return indent(stepSource(step, sentences), STEP_DEPTH);
}

/** A new test for a scenario, indented as it sits inside a rendered suite file. */
export function renderScenario(scenario: FeatureScenario, sentences: readonly Sentence[]): string {
  return indent(scenarioSource(scenario, sentences), SCENARIO_DEPTH);
}

function recordLiteral(entries: readonly (readonly [string, string])[]): string {
  return entries.length === 0
    ? '{}'
    : `{ ${entries.map(([key, value]) => `${quote(key)}: ${value}`).join(', ')} }`;
}

function environmentLiteral(profile: FeatureSandboxProfile): string {
  return recordLiteral(
    Object.entries(profile.environment).map(
      ([name, source]) => [name, `{ fromEnv: ${quote(source.fromEnv)} }`] as const,
    ),
  );
}

function credentialsLiteral(profile: FeatureSandboxProfile): string {
  return recordLiteral(
    Object.entries(profile.credentials).map(
      ([name, source]) =>
        [name, `{ scheme: ${quote(source.scheme)}, fromEnv: ${quote(source.fromEnv)} }`] as const,
    ),
  );
}

function header(feature: FeatureOutline, library: boolean): readonly string[] {
  const imports = library
    ? 'runSentence, sandboxCredentials, sandboxEnvironment, test'
    : 'sandboxEnvironment, test';
  return [
    `// Generated from ${feature.file} by \`${EMIT_COMMAND}\`.`,
    '// Fill in the TODO steps: each one throws until it has a body.',
    '// Keep scenario titles and step lines as they are: drift compares them with the feature.',
    `import { ${imports} } from ${quote(SUITE_RUNTIME_MODULE)};`,
    '',
    ...(library
      ? [`const credentials = sandboxCredentials(${credentialsLiteral(feature.profile)});`, '']
      : []),
  ];
}

/** The source of a new suite file for a feature. */
export function renderSuite(feature: FeatureOutline, sentences: readonly Sentence[]): string {
  const library = feature.scenarios.some((scenario) => usesLibrary(scenario.steps, sentences));
  const scenarios = feature.scenarios.map((scenario) => renderScenario(scenario, sentences));
  return [
    ...header(feature, library),
    `test.system(${quote(feature.system)}, (system) => {`,
    `  system.sandbox(${quote(feature.sandbox)}, { environment: sandboxEnvironment(${environmentLiteral(feature.profile)}) }, (suite) => {`,
    scenarios.join('\n\n'),
    '  });',
    '});',
    '',
  ].join('\n');
}
