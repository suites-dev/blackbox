import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// Requirement (task 2.3 acceptance): the repository lint refuses expect.soft,
// catch and timeout or retry calls in the shared step library (hard rules 4
// and 5). Negative control: code that does each of these, linted by the
// repository's own ESLint configuration as if it were a library file, is
// reported once per construct; the same code at a runtime path is not, so the
// rule is scoped to the library rather than a general ban.

function repositoryRoot(): string {
  let directory = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(directory, 'pnpm-workspace.yaml'))) {
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error('pnpm-workspace.yaml not found above the step library');
    }
    directory = parent;
  }
  return directory;
}

const root = repositoryRoot();
const here = dirname(fileURLToPath(import.meta.url));

// Each line is one forbidden construct; the comment is the message it must produce.
const FORBIDDEN = `
import { setTimeout as sleep } from 'node:timers/promises'; // Timers:
import { expect, test } from '@suites/blackbox-playwright';

export async function forbidden(poll: () => Promise<number>, page: { waitForTimeout(ms: number): Promise<void> }) {
  await expect.soft(1).toBe(2); // expect.soft:
  await poll().catch(() => 0); // .catch():
  await poll().then(() => 0, () => 0); // .then(onFulfilled, onRejected):
  try { await poll(); } catch { /* swallowed */ } // catch:
  await Promise.allSettled([poll()]); // Promise.allSettled:
  test.setTimeout(60_000); // test.setTimeout:
  test.slow(); // test.slow:
  test.describe.configure({ retries: 2 }); // describe.configure / expect.configure:
  await page.waitForTimeout(500); // waitForTimeout:
  await expect(poll).toPass(); // toPass retries a block:
  await expect.poll(poll, { timeout: 30_000 }).toBe(1); // A literal timeout:
  setTimeout(() => undefined, 10); // setTimeout:
  await sleep(10); // reported through its import above
}
`;

const EXPECTED = [...FORBIDDEN.matchAll(/\/\/ (.+:)$/gmu)].map((match) => match[1]);

interface LintMessage {
  readonly ruleId: string | null;
  readonly message: string;
}

/** Lints `source` with the repository configuration as though it were the file at `path`. */
function lint(path: string, source: string): readonly LintMessage[] {
  const result = spawnSync(
    process.execPath,
    [
      join(root, 'node_modules', 'eslint', 'bin', 'eslint.js'),
      '--format',
      'json',
      '--stdin',
      '--stdin-filename',
      relative(root, path),
    ],
    { cwd: root, input: source, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  expect(result.error).toBeUndefined();
  const reports = JSON.parse(result.stdout) as readonly {
    readonly messages: readonly LintMessage[];
  }[];
  expect(reports, result.stderr).toHaveLength(1);
  return reports[0].messages;
}

const ruleMessages = (messages: readonly LintMessage[]) =>
  messages
    .filter((message) =>
      ['no-restricted-properties', 'no-restricted-globals', 'no-restricted-syntax'].includes(
        message.ruleId ?? '',
      ),
    )
    .map((message) => message.message);

describe('step library lint', () => {
  it('reports every catch, expect.soft, timer, timeout and retry construct in a library step', () => {
    const reported = ruleMessages(lint(join(here, 'steps', 'response.ts'), FORBIDDEN));
    for (const prefix of EXPECTED) {
      expect(
        reported.filter((message) => message.includes(prefix)),
        prefix,
      ).not.toHaveLength(0);
    }
    expect(EXPECTED).toHaveLength(13);
  }, 120_000);

  it('applies only to the step library', () => {
    const runtime = join(here, '..', 'step-runtime', 'run-step.ts');
    const reported = ruleMessages(lint(runtime, FORBIDDEN));
    expect(reported.filter((message) => message.includes('step library hard rule'))).toEqual([]);
  }, 120_000);
});
