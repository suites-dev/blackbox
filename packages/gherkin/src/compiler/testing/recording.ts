import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

// A stand-in for the generated-code runtime. It records what a generated file
// declares through test.system(...).sandbox(...) and the steps each test runs,
// so the emitted code is executed rather than only compared as text. Hooks run
// outer scope first, as Playwright runs them. Each generated file runs in its
// own plain Node process, so nothing but the emitted module and this runtime
// is loaded.

export interface RecordedStep {
  readonly feature: string;
  readonly line: number;
  readonly column: number;
  readonly keyword: string;
  readonly text: string;
  readonly argument: unknown;
  /** The fixture names the hook or test body destructured. */
  readonly fixtures: readonly string[];
  /** What the generated file passed as `credentials`, or null when the step reads none. */
  readonly credentials: unknown;
}

export interface RecordedTest {
  readonly selection: unknown;
  readonly sandbox: string;
  readonly environment: unknown;
  readonly titlePath: readonly string[];
  readonly annotation: unknown;
  readonly steps: readonly RecordedStep[];
}

const RECORDING_RUNTIME = String.raw`
import { fileURLToPath } from 'node:url';

let steps = null;
let current = null;

export function sandboxEnvironment(spec) {
  return { spec };
}

export function sandboxCredentials(spec) {
  return { credentialSpec: spec };
}

export async function runStep(fixtures, site, text, argument) {
  steps.push({
    feature: fileURLToPath(site.feature),
    line: site.line,
    column: site.column,
    keyword: site.keyword,
    text,
    argument,
    fixtures: Object.keys(fixtures),
    credentials: 'credentials' in fixtures ? fixtures.credentials : null,
  });
}

function fixtureProxy() {
  return new Proxy({}, { get: (_target, name) => ({ fixture: String(name) }) });
}

export const test = {
  system(selection, declare) {
    const pending = [];
    declare({
      sandbox(name, options, body) {
        const scopes = [{ titles: [], hooks: [] }];
        const top = () => scopes[scopes.length - 1];
        body({
          describe(title, inner) {
            scopes.push({ titles: [...top().titles, title], hooks: [...top().hooks] });
            inner();
            scopes.pop();
          },
          beforeEach(title, hook) {
            if (title !== 'Background') {
              throw new Error('unexpected hook title ' + title);
            }
            top().hooks.push(hook);
          },
          test(title, details, run) {
            pending.push({
              selection,
              sandbox: name,
              environment: options.environment,
              titlePath: [...top().titles, title],
              annotation: details.annotation,
              hooks: [...top().hooks],
              run,
            });
          },
        });
      },
    });
    current = pending;
  },
};

export async function runDeclared() {
  const declared = current ?? [];
  current = null;
  const tests = [];
  for (const { hooks, run, ...test } of declared) {
    steps = [];
    for (const hook of hooks) {
      await hook(fixtureProxy());
    }
    await run(fixtureProxy());
    tests.push({ ...test, steps });
    steps = null;
  }
  return tests;
}
`;

const RUN_GENERATED = String.raw`
import { pathToFileURL } from 'node:url';

import { runDeclared } from './recording-runtime.mjs';

await import(pathToFileURL(process.argv[2]).href);
process.stdout.write(JSON.stringify(await runDeclared()));
`;

const runNode = promisify(execFile);

export interface RecordingRuntime {
  /** The module specifier generated files import their runtime from. */
  readonly module: string;
  /** Loads one generated file and runs every test it declares against the recording runtime. */
  run(file: string): Promise<readonly RecordedTest[]>;
}

export async function writeRecordingRuntime(root: string): Promise<RecordingRuntime> {
  const runtime = join(root, 'recording-runtime.mjs');
  const runner = join(root, 'run-generated.mjs');
  await writeFile(runtime, RECORDING_RUNTIME);
  await writeFile(runner, RUN_GENERATED);
  return {
    module: pathToFileURL(runtime).href,
    run: async (file) => {
      const { stdout } = await runNode(process.execPath, [runner, file]);
      return JSON.parse(stdout) as readonly RecordedTest[];
    },
  };
}
