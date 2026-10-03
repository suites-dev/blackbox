import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { JSONReport } from '@playwright/test/reporter';

import { eventMarker } from '../system-sandbox/runtime.fixture.js';

export interface NativeEvent {
  readonly kind: string;
  readonly pid: number;
  readonly at: number;
  readonly raw: Readonly<Record<string, unknown>>;
}

interface NativeRunBase {
  readonly code: number;
  readonly output: string;
  readonly events: readonly NativeEvent[];
}

interface NativeRunWithReport extends NativeRunBase {
  readonly reportKind: 'json';
  readonly report: JSONReport;
}

interface NativeRunWithoutReport extends NativeRunBase {
  readonly reportKind: 'none';
}

export type NativeRun = NativeRunWithReport | NativeRunWithoutReport;

interface RunInput {
  readonly configFile: string;
  readonly testFile: string;
  readonly jsonReport: boolean;
  readonly scenario: string;
}

const directories: string[] = [];

export async function cleanupNativeRuns(): Promise<void> {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
}

export function eventsOf(run: NativeRun, kind: string): readonly NativeEvent[] {
  return run.events.filter((event) => event.kind === kind);
}

export function eventString(event: NativeEvent, key: string): string {
  const value = event.raw[key];
  if (typeof value !== 'string') {
    throw new TypeError(`Expected event field ${key} to be a string`);
  }
  return value;
}

export function eventNumber(event: NativeEvent, key: string): number {
  const value = event.raw[key];
  if (typeof value !== 'number') {
    throw new TypeError(`Expected event field ${key} to be a number`);
  }
  return value;
}

export function eventObject(
  event: NativeEvent,
  key: string,
): Readonly<Record<string, unknown>> {
  const value = event.raw[key];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Expected event field ${key} to be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function parseEvent(line: string): NativeEvent | undefined {
  const markerIndex = line.indexOf(eventMarker);
  if (markerIndex < 0) {
    return undefined;
  }
  const raw = JSON.parse(
    line.slice(markerIndex + eventMarker.length),
  ) as Readonly<Record<string, unknown>>;
  const kind = raw.kind;
  const pid = raw.pid;
  const at = raw.at;
  if (typeof kind !== 'string' || typeof pid !== 'number' || typeof at !== 'number') {
    throw new TypeError('Malformed native runner event');
  }
  return { kind, pid, at, raw };
}

function parseEvents(output: string): readonly NativeEvent[] {
  return output.split('\n').flatMap((line) => {
    const event = parseEvent(line);
    return event === undefined ? [] : [event];
  });
}

export async function runPlaywright(input: RunInput): Promise<NativeRun> {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-system-sandbox-'));
  directories.push(directory);
  const reportFile = join(directory, 'results.json');
  const require = createRequire(import.meta.url);
  const child = spawn(
    process.execPath,
    [
      require.resolve('@playwright/test/cli'),
      'test',
      input.testFile,
      '--config',
      join(import.meta.dirname, '..', input.configFile),
    ],
    {
      cwd: join(import.meta.dirname, '../../..'),
      env: {
        ...process.env,
        BLACKBOX_PLAYWRIGHT_OUTPUT_DIR: join(directory, 'output'),
        BLACKBOX_PLAYWRIGHT_JSON_REPORT: reportFile,
        BLACKBOX_SYSTEM_SANDBOX_SCENARIO: input.scenario,
        FORCE_COLOR: '0',
        NO_COLOR: undefined,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
  });
  child.stderr.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 25_000);
  let code: number;
  try {
    code = await new Promise<number>((resolveExit, rejectExit) => {
      child.once('error', rejectExit);
      child.once('close', (exitCode) => {
        resolveExit(exitCode ?? 1);
      });
    });
  } finally {
    clearTimeout(timer);
  }
  const events = parseEvents(output);
  if (!input.jsonReport) {
    return { code, output, events, reportKind: 'none' };
  }
  const report = JSON.parse(await readFile(reportFile, 'utf8')) as JSONReport;
  return { code, output, events, reportKind: 'json', report };
}
