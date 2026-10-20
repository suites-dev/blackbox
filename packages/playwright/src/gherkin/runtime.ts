import { declarationError, nonemptyString } from '../declarations/validation.js';
import type { BlackboxStimulusScope } from '../steps/types.js';
import type { GherkinFixtures, GherkinGiven, GherkinRow, GherkinWhen } from './types.js';

type Pending = () => Promise<void>;
export function interpolate(title: string, row: GherkinRow): string {
  return title.replace(/<([^>]+)>/gu, (token: string, key: string) => row[key] ?? token);
}
function assertActive(active: boolean): void {
  if (!active) {
    throw declarationError('Gherkin step scope cannot be used after its callback returns');
  }
}
async function drain(steps: readonly Pending[]): Promise<void> {
  for (const step of steps) {
    await step();
  }
}
function createWhen<Args extends object, Row extends object>(
  context: GherkinFixtures<Args> & Row,
  title: (value: string) => string,
  pending: Pending[],
  active: () => boolean,
): GherkinWhen<Args, Row> {
  return (name, body) => {
    assertActive(active());
    const stepTitle = title(nonemptyString(name, 'When title'));
    pending.push(async () => {
      const assertions: Pending[] = [];
      let open = true;
      const phase = { seenThen: false };
      const assertion =
        (verb: 'Then' | 'And' | 'But') =>
        (
          assertionName: string,
          assertionBody: (fixtures: GherkinFixtures<Args> & Row) => void | Promise<void>,
        ) => {
          assertActive(open);
          if (verb !== 'Then' && !phase.seenThen) {
            throw declarationError(`${verb} requires a preceding Then`);
          }
          if (verb === 'Then' && phase.seenThen) {
            throw declarationError('use And after the first Then in a When phase');
          }
          phase.seenThen = true;
          const label = `${verb} ${title(nonemptyString(assertionName, `${verb} title`))}`;
          assertions.push(async () => {
            await context.step(label, () => assertionBody(context));
          });
          return Promise.resolve();
        };
      try {
        await context.step(`When ${stepTitle}`, () =>
          body(
            Object.freeze({
              ...context,
              stimulus: <Result>(
                callback: (scope: BlackboxStimulusScope) => Result | Promise<Result>,
              ) => context.step.stimulus(stepTitle, callback),
              Then: assertion('Then'),
              And: assertion('And'),
              But: assertion('But'),
            }),
          ),
        );
      } finally {
        open = false;
      }
      if (!phase.seenThen) {
        throw declarationError('When requires a Then assertion');
      }
      await drain(assertions);
    });
    return Promise.resolve();
  };
}
export function createGiven<Args extends object, Row extends object>(
  context: GherkinFixtures<Args> & Row,
  title: (value: string) => string,
  active: () => boolean,
): GherkinGiven<Args, Row> {
  return async (name, body) => {
    assertActive(active());
    const label = title(nonemptyString(name, 'Given title'));
    const pending: Pending[] = [];
    let open = true;
    try {
      await context.step(`Given ${label}`, () =>
        body(
          Object.freeze({
            ...context,
            When: createWhen(context, title, pending, () => open),
          }),
        ),
      );
    } finally {
      open = false;
    }
    if (pending.length === 0) {
      throw declarationError('scenario Given requires a When phase');
    }
    await drain(pending);
  };
}
