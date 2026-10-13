import { expect } from '@playwright/test';

import { createBlackboxSystemTest } from '../../fixtures.js';
import { record, startRespondingAttempt } from '../system-sandbox/runtime.fixture.js';

const test = createBlackboxSystemTest({ start: startRespondingAttempt });
test.system('orders', (system) => {
  system.sandbox('gherkin', ({ Feature }) => {
    Feature('Native Gherkin', ({ Background, Rule }) => {
      Background('feature setup', ({ Given }) => {
        Given('feature is ready', ({ sandbox }) => {
          record({ kind: 'feature-background', executionId: sandbox.executionId });
        });
      });
      Rule('rule setup and example isolation', ({ Background, Example, ScenarioTemplate }) => {
        Background('rule setup', ({ Given }) => {
          Given('rule is ready', ({ sandbox }) => {
            record({ kind: 'rule-background', executionId: sandbox.executionId });
          });
        });
        Example('native async action', async ({ Given }) => {
          let accepted = false;
          await Given('native setup', async ({ When }) => {
            await When('native request', async ({ request, sandbox, Then, But }) => {
              const response = await request.get(sandbox.entrypoint.url);
              await Then('native response', async () => {
                expect(await response.json()).toMatchObject({ executionId: sandbox.executionId });
              });
              await But('attempt is owned', () => {
                record({ kind: 'gherkin-scenario', executionId: sandbox.executionId });
                accepted = true;
              });
            });
            await When('another phase', async ({ Then }) => {
              await Then('another assertion', () => {
                expect(accepted).toBe(true);
              });
            });
          });
        });
        ScenarioTemplate('row <user>', ({ Given, Scenarios }) => {
          Given('user <user>', async ({ row, When }) => {
            await When('check <user>', async ({ Then }) => {
              await Then('row <user> preserved', ({ row: assertionRow, sandbox }) => {
                expect(assertionRow.user).toBe(row.user);
                record({ kind: 'gherkin-row', user: row.user, executionId: sandbox.executionId });
              });
            });
          });
          Scenarios('users', [{ user: 'alice' }, { user: 'bob' }]);
        });
      });
    });
  });
});
