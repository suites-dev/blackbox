import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { boundary } from './playwright-evidence.mjs';

const consumerRoot = dirname(fileURLToPath(import.meta.url));
const result = await boundary(consumerRoot);
result.playwrightExports = ['playwright', 'playwright/config', 'playwright/reporter'].map(
  (subpath) => {
    const entrypoint = fileURLToPath(import.meta.resolve(`@suites/blackbox/${subpath}`));
    if (!entrypoint.startsWith(`${consumerRoot}/node_modules/@suites/blackbox/dist/playwright/`)) {
      throw new Error(
        `Playwright ${subpath} did not resolve to the installed package: ${entrypoint}`,
      );
    }
    return { subpath, entrypoint };
  },
);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
