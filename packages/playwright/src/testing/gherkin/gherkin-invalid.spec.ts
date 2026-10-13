import { createBlackboxSystemTest } from '../../fixtures.js';
import type { GherkinRuleScope } from '../../gherkin/types.js';
import { startRespondingAttempt } from '../system-sandbox/runtime.fixture.js';

const test = createBlackboxSystemTest({ start: startRespondingAttempt });
const scenario = process.env.BLACKBOX_SYSTEM_SANDBOX_SCENARIO;
test.system('orders', (system) => {
  system.sandbox('invalid', ({ Feature }) => {
    if (scenario === 'async-feature') {
      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Negative declaration fixture deliberately violates the synchronous contract.
      Feature('async', async () => {
        await Promise.resolve();
      });
      return;
    }
    Feature('invalid grammar', ({ Rule, ScenarioOutline, Background }) => {
      if (scenario === 'escaped-rule') {
        let escaped: GherkinRuleScope<object>['Scenario'] | undefined;
        Rule('capture', ({ Scenario }) => {
          escaped = Scenario;
        });
        if (escaped === undefined) {
          throw new Error('missing scope');
        }
        escaped('late', async ({ Given }) => {
          await Given('setup', async ({ When }) => {
            await When('act', async ({ Then }) => {
              await Then('check', () => Promise.resolve());
            });
          });
        });
        return;
      }
      if (scenario === 'late-background') {
        Rule('first', () => {
          const declared = true;
          void declared;
        });
        Background('late', ({ Given }) => {
          Given('late setup', () => Promise.resolve());
        });
        return;
      }
      ScenarioOutline('rows', ({ Given, Examples }) => {
        Given('setup', async ({ When }) => {
          await When('act', async ({ Then }) => {
            await Then('check', () => Promise.resolve());
          });
        });
        if (scenario === 'empty-rows') {
          Examples('empty', []);
        }
        if (scenario === 'row-keys') {
          Examples('inconsistent', [{ user: 'a' }, { account: 'b' }]);
        }
      });
    });
  });
});
