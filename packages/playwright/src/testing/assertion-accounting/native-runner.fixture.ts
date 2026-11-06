import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

import type { JSONReport, JSONReportSpec, JSONReportSuite } from '@playwright/test/reporter';

export interface AssertionEvent {
  readonly kind: string;
  readonly value: unknown;
}

export async function runAssertions(file: string) {
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
  const child = spawn(process.execPath, args, {
    cwd: join(import.meta.dirname, '../../..'),
    env: {
      ...process.env,
      BLACKBOX_ASSERTION_REPORT: reportFile,
      BLACKBOX_ASSERTION_OUTPUT: join(directory, 'output'),
      FORCE_COLOR: '0',
      NO_COLOR: undefined,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
  });
  child.stderr.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
  });
  const timeout = setTimeout(() => {
    child.kill('SIGKILL');
  }, 60_000);
  let exitCode: number;
  try {
    exitCode = await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) => {
        resolve(code ?? 1);
      });
    });
  } finally {
    clearTimeout(timeout);
  }
  await writeFile(join(directory, 'execution.log'), output);
  const report = JSON.parse(await readFile(reportFile, 'utf8')) as JSONReport;
  const events = output.split('\n').flatMap((line): AssertionEvent[] => {
    const marker = 'BLACKBOX_ASSERTION_SCOPE_EVENT ';
    const position = line.indexOf(marker);
    return position < 0 ? [] : [JSON.parse(line.slice(position + marker.length)) as AssertionEvent];
  });
  process.stdout.write(
    `Native assertion evidence: ${JSON.stringify({ file, directory, exitCode, stats: report.stats })}\n`,
  );
  return { directory, exitCode, output, report, events };
}

export function discovered(suites: readonly JSONReportSuite[]): JSONReportSpec[] {
  return suites.flatMap((suite) => [...suite.specs, ...discovered(suite.suites ?? [])]);
}
