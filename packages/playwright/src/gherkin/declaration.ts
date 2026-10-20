import type { InternalTest } from '../declarations/native.js';
import { declarationError, nonemptyString } from '../declarations/validation.js';
import { createGiven } from './runtime.js';
import { declareOutline } from './outline.js';
import { assertActive, synchronousScope } from './scope.js';
import type {
  GherkinFeature,
  GherkinFixtures,
  GherkinRuleScope,
  GherkinScenarioScope,
} from './types.js';

interface Background<Args extends object> {
  readonly title: string;
  readonly body: (fixtures: GherkinFixtures<Args>) => void | Promise<void>;
}
type ScenarioBody<Args extends object> = (
  scope: GherkinScenarioScope<Args>,
) => void | Promise<void>;
function createRuleScope<Args extends object, Worker extends object, Internal extends object>(
  nativeTest: InternalTest<Args, Worker, Internal>,
  active: () => boolean,
  inherited: readonly Background<Args>[],
  backgrounds: Background<Args>[] = [],
): GherkinRuleScope<Args> {
  let started = false;
  const fixtureTest = nativeTest.extend<GherkinFixtures<Args>>({});
  const scenario = (name: string, body: ScenarioBody<Args>) => {
    assertActive(active);
    started = true;
    const title = nonemptyString(name, 'Scenario title');
    const setup = [...inherited, ...backgrounds];
    fixtureTest(`Scenario: ${title}`, async ({ clients, request, sandbox, effects, step, telemetry }) => {
      const fixtures = Object.freeze({ clients, request, sandbox, effects, step, telemetry });
      for (const background of setup) {
        await step(`Given ${background.title}`, () => background.body(fixtures));
      }
      let open = true;
      let count = 0;
      const Given = createGiven(
        fixtures,
        (value) => value,
        () => open,
      );
      try {
        const scope = {
          Given: async (label, callback) => {
            count += 1;
            await Given(label, callback);
          },
        } satisfies GherkinScenarioScope<Args>;
        await body(Object.freeze(scope));
      } finally {
        open = false;
      }
      if (count === 0) {
        throw declarationError('Scenario requires a Given');
      }
    });
  };
  const scope = {
    Background: (name, body) => {
      assertActive(active);
      nonemptyString(name, 'Background title');
      if (started || backgrounds.length > 0) {
        throw declarationError(
          'Background must precede scenarios and may be declared once per scope',
        );
      }
      let open = true;
      try {
        synchronousScope(
          {
            Given: (title: string, callback: Background<Args>['body']) => {
              assertActive(() => open);
              backgrounds.push({ title: nonemptyString(title, 'Given title'), body: callback });
            },
          },
          body,
          'Background',
        );
      } finally {
        open = false;
      }
      if (backgrounds.length === 0) {
        throw declarationError('Background requires a Given');
      }
    },
    Scenario: scenario,
    Example: scenario,
    ScenarioOutline: (name, body) => {
      assertActive(active);
      nonemptyString(name, 'ScenarioOutline title');
      declareOutline(name, body, scenario);
    },
  } satisfies Omit<GherkinRuleScope<Args>, 'ScenarioTemplate'>;
  return Object.freeze({ ...scope, ScenarioTemplate: scope.ScenarioOutline });
}

export function createFeature<Args extends object, Worker extends object, Internal extends object>(
  nativeTest: InternalTest<Args, Worker, Internal>,
  active: () => boolean,
): GherkinFeature<Args> {
  return (name, body) => {
    assertActive(active);
    nativeTest.describe(`Feature: ${nonemptyString(name, 'Feature title')}`, () => {
      let open = true;
      let insideRule = false;
      let ruleSeen = false;
      const backgrounds: Background<Args>[] = [];
      const scope = createRuleScope(nativeTest, () => open && !insideRule, [], backgrounds);
      try {
        synchronousScope(
          Object.freeze({
            ...scope,
            Background: (title: string, callback: Parameters<typeof scope.Background>[1]) => {
              if (ruleSeen) {
                throw declarationError('Feature Background must precede Rules');
              }
              scope.Background(title, callback);
            },
            Rule: (title: string, callback: (rule: GherkinRuleScope<Args>) => void) => {
              assertActive(() => open && !insideRule);
              ruleSeen = true;
              nativeTest.describe(`Rule: ${nonemptyString(title, 'Rule title')}`, () => {
                let ruleOpen = true;
                insideRule = true;
                try {
                  synchronousScope(
                    createRuleScope(nativeTest, () => ruleOpen, backgrounds),
                    callback,
                    'Rule',
                  );
                } finally {
                  ruleOpen = false;
                  insideRule = false;
                }
              });
            },
          }),
          body,
          'Feature',
        );
      } finally {
        open = false;
      }
    });
  };
}
