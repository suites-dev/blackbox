import { test } from '@suites/blackbox-playwright';

import { declareBrowserCases } from './effects-acceptance-browser.js';
import { declareDatabaseCases, declareWithheldCase } from './effects-acceptance-database.js';
import { declareMessagingCases } from './effects-acceptance-messaging.js';

test.system('effects-acceptance', (system) => {
  system.sandbox('real dependencies', (suite) => {
    suite.describe('candidate effects acceptance', () => {
      declareDatabaseCases(suite);
      declareMessagingCases(suite);
      declareBrowserCases(suite);
    });
  });
});

test.system('effects-withheld', (system) => {
  system.sandbox('controlled telemetry withholding', (suite) => {
    declareWithheldCase(suite);
  });
});
