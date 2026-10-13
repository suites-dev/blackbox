import { declarationError, nonemptyString } from '../declarations/validation.js';
import { interpolate } from './runtime.js';
import { assertActive, synchronousScope } from './scope.js';
import type { GherkinOutlineScope, GherkinRow, GherkinScenarioScope } from './types.js';

type ScenarioBody<Args extends object> = (
  scope: GherkinScenarioScope<Args>,
) => void | Promise<void>;
export function declareOutline<Args extends object>(
  name: string,
  body: (scope: GherkinOutlineScope<Args>) => void,
  scenario: (title: string, body: ScenarioBody<Args>) => void,
): void {
  type GivenBody = Parameters<GherkinOutlineScope<Args>['Given']>[1];
  const givens: { readonly title: string; readonly body: GivenBody }[] = [];
  const examples: { readonly title: string; readonly rows: readonly GherkinRow[] }[] = [];
  let open = true;
  const registerExamples = (title: string, rows: readonly GherkinRow[]) => {
    assertActive(() => open);
    examples.push({ title: nonemptyString(title, 'Examples title'), rows: validateRows(rows) });
  };
  try {
    synchronousScope(
      {
        Scenarios: registerExamples,
        Given: (title: string, callback: GivenBody) => {
          assertActive(() => open);
          givens.push({ title: nonemptyString(title, 'Given title'), body: callback });
        },
        Examples: registerExamples,
      },
      body,
      'ScenarioOutline',
    );
  } finally {
    open = false;
  }
  if (givens.length === 0 || examples.length === 0) {
    throw declarationError('ScenarioOutline requires Given and Examples');
  }
  for (const example of examples) {
    for (const [index, row] of example.rows.entries()) {
      scenario(
        `${interpolate(name, row)} [${example.title} ${String(index + 1)}]`,
        async ({ Given }) => {
          for (const given of givens) {
            await Given(interpolate(given.title, row), async (context) => {
              const withRow = Object.freeze({ ...context, row });
              // Reuse the current Given's scheduling handle, adding this immutable example row.
              await given.body(
                Object.freeze({
                  ...withRow,
                  When: async (title, callback) => {
                    await context.When(interpolate(title, row), async (when) => {
                      await callback(
                        Object.freeze({
                          ...when,
                          row,
                          Then: async (label, assertion) => {
                            await when.Then(interpolate(label, row), (fixtures) =>
                              assertion({ ...fixtures, row }),
                            );
                          },
                          But: async (label, assertion) => {
                            await when.But(interpolate(label, row), (fixtures) =>
                              assertion({ ...fixtures, row }),
                            );
                          },
                          And: async (label, assertion) => {
                            await when.And(interpolate(label, row), (fixtures) =>
                              assertion({ ...fixtures, row }),
                            );
                          },
                        }),
                      );
                    });
                  },
                }),
              );
            });
          }
        },
      );
    }
  }
}
function validateRows(rows: readonly GherkinRow[]): readonly GherkinRow[] {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw declarationError('Examples requires nonempty rows');
  }
  let keys: string | undefined;
  return Object.freeze(
    rows.map((row: GherkinRow) => {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Validate JavaScript callers at the public boundary.
      if (row === null || typeof row !== 'object' || Array.isArray(row)) {
        throw declarationError('Examples rows must be string records');
      }
      const names = Object.keys(row).sort();
      const signature = JSON.stringify(names);
      if (
        names.length === 0 ||
        Object.values(row).some((value) => typeof value !== 'string') ||
        (keys !== undefined && keys !== signature)
      ) {
        throw declarationError('Examples rows require consistent nonempty keys and string values');
      }
      keys = signature;
      return Object.freeze({ ...row });
    }),
  );
}
