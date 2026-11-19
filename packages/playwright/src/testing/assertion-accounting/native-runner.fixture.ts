import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

import type { JSONReport, JSONReportSpec, JSONReportSuite } from '@playwright/test/reporter';

export interface AssertionEvent {
  readonly kind: string;
  readonly value: unknown;
}

export async function runAssertions(
  file: string,
  titles: readonly string[] = [],
  listOnly = false,
) {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-assertion-accounting-'));
  const reportFile = join(directory, 'results.json');
  const require = createRequire(import.meta.url);
  const args = [
    require.resolve('@playwright/test/cli'),
    'test',
    file,
    '--config',
    join(import.meta.dirname, '../assertion-accounting.config.ts'),
  ];
  if (titles.length > 0) {
    const escaped = titles.map((title) => title.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'));
    args.push('--grep', `(?:${escaped.join('|')})$`);
  }
  if (listOnly) {
    args.push('--list');
  }
  const { exitCode, output } = await runAssertionProcess(args, {
    directory,
    cwd: join(import.meta.dirname, '../../..'),
    env: {
      ...process.env,
      BLACKBOX_ASSERTION_REPORT: reportFile,
      BLACKBOX_ASSERTION_OUTPUT: join(directory, 'output'),
      FORCE_COLOR: '0',
      NO_COLOR: undefined,
    },
  });
  let reportText: string;
  try {
    reportText = await readFile(reportFile, 'utf8');
  } catch (cause) {
    throw new Error(`Native assertion report missing; evidence: ${directory}\n${output}`, {
      cause,
    });
  }
  const report = JSON.parse(reportText) as JSONReport;
  const events = output.split('\n').flatMap((line): AssertionEvent[] => {
    const marker = 'BLACKBOX_ASSERTION_SCOPE_EVENT ';
    const position = line.indexOf(marker);
    return position < 0 ? [] : [JSON.parse(line.slice(position + marker.length)) as AssertionEvent];
  });
  process.stdout.write(
    `Native assertion evidence: ${JSON.stringify({ file, titles, listOnly, directory, exitCode, stats: report.stats })}\n`,
  );
  return { directory, exitCode, output, report, events };
}

export function discovered(suites: readonly JSONReportSuite[]): JSONReportSpec[] {
  return suites.flatMap((suite) => [...suite.specs, ...discovered(suite.suites ?? [])]);
}

/** This test harness owns exactly the detached process group it starts. */
export async function runAssertionProcess(
  args: readonly string[],
  options: {
    readonly directory: string;
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
  },
  deadlineMs = 50_000,
) {
  const log = createWriteStream(join(options.directory, 'execution.log'), { flags: 'wx' });
  const child = spawn(process.execPath, [...args], {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  let output = '';
  let failure: Error | undefined;
  const killOwnedGroup = () => {
    if (child.pid === undefined) {
      return;
    }
    try {
      if (process.platform === 'win32') {
        child.kill('SIGKILL');
      } else {
        process.kill(-child.pid, 'SIGKILL');
      }
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) {
        failure = error instanceof Error ? error : new Error(String(error));
      }
    }
  };
  log.on('error', (error) => {
    failure = error;
    killOwnedGroup();
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
      log.write(chunk);
    });
  }
  process.stdout.write(`Native assertion child evidence: ${options.directory}\n`);
  const timeout = setTimeout(() => {
    failure = new Error(
      `Native assertion child exceeded ${deadlineMs}ms; evidence: ${options.directory}`,
    );
    killOwnedGroup();
  }, deadlineMs);
  child.once('error', (error) => {
    failure = error;
  });
  const exitCode = await new Promise<number>((resolve) => {
    child.once('close', (code) => {
      resolve(code ?? 1);
    });
  });
  clearTimeout(timeout);
  await new Promise<void>((resolve) => {
    log.end(() => {
      resolve();
    });
  });
  if (failure !== undefined) {
    process.stderr.write(
      `Native assertion child failed; evidence: ${options.directory}\n${output}`,
    );
    throw failure;
  }
  return { exitCode, output };
}
