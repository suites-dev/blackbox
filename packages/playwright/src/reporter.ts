import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';

import { decodeEvent, progressAttachment } from './reporting/events.js';
import {
  policyOption,
  sandboxLifecycleOption,
  strictVerdictsOption,
  type PolicySettings,
} from './reporting/options.js';
import { evaluateRunnerPolicy, type RunnerPolicyResult } from './reporting/policy/runner-policy.js';
import { reportText } from './reporting/text.js';
import { scenarioRecord, verdictLine, type RunManifest } from './reporting/verdicts/verdict.js';

/**
 * Native reporters own terminal rendering; Blackbox adds retained diagnostics and
 * surfaces the effective runner policy. Blackbox config metadata controls per-test
 * lifecycle output from fixtures. With strict verdicts, the reporter also fails a
 * run that contains any test that is not supported and writes the run manifest.
 */
export default class BlackboxReporter implements Reporter {
  private readonly policySettings: PolicySettings;
  private readonly verdicts: ReturnType<typeof strictVerdictsOption>;
  private runnerPolicy: RunnerPolicyResult | null = null;
  private run: { readonly configDir: string; readonly suite: Suite } | null = null;

  constructor(options: unknown = {}) {
    sandboxLifecycleOption(options);
    this.policySettings = policyOption(options);
    const verdicts = strictVerdictsOption(options);
    // Playwright constructs reporters with `_mode: 'list'` for `--list`, where no
    // test runs; a listing is not a verdict and must not fail or write a manifest.
    const listing =
      typeof options === 'object' &&
      options !== null &&
      '_mode' in options &&
      options._mode === 'list';
    this.verdicts = listing ? { kind: 'off' } : verdicts;
  }

  printsToStdio(): boolean {
    return false;
  }

  onBegin(config: FullConfig, suite: Suite): void {
    this.runnerPolicy = evaluateRunnerPolicy(config, suite, this.policySettings);
    // stderr keeps stdout reporters (json, junit without outputFile) parseable.
    process.stderr.write(`${this.runnerPolicy.report}\n`);
    // FullConfig.rootDir is the test directory; manifest paths are relative to the config file.
    const configDir = config.configFile === undefined ? process.cwd() : dirname(config.configFile);
    this.run = { configDir, suite };
  }

  onTestEnd(_test: TestCase, result: TestResult): void {
    if (this.runnerPolicy !== null) {
      result.attachments.push({
        name: 'blackbox-policy',
        contentType: 'text/plain',
        body: Buffer.from(this.runnerPolicy.report),
      });
    }
    const events = result.attachments.flatMap((attachment) => {
      if (attachment.name !== progressAttachment || attachment.body === undefined) {
        return [];
      }
      const event = decodeEvent(attachment.body);
      return event === null ? [] : [event];
    });
    if (events.length === 0) {
      return;
    }
    result.attachments.push({
      name: 'blackbox-diagnostics',
      contentType: 'text/plain',
      body: Buffer.from(
        events
          .map((event) =>
            reportText(`${event.phase}: ${event.status}; ${event.detail} (+${event.elapsedMs}ms)`),
          )
          .join('\n'),
      ),
    });
  }

  async onEnd(result: FullResult): Promise<{ status: FullResult['status'] } | undefined> {
    const failure = this.runnerPolicy === null ? null : this.runnerPolicy.failure;
    if (failure !== null) {
      process.stderr.write(`${failure}\n`);
    }
    const policyStatus = failure !== null && result.status === 'passed' ? 'failed' : result.status;
    const status = await this.reportVerdicts(policyStatus);
    return status === result.status ? undefined : { status };
  }

  private async reportVerdicts(status: FullResult['status']): Promise<FullResult['status']> {
    if (this.verdicts.kind === 'off' || this.run === null) {
      return status;
    }
    const { configDir, suite } = this.run;
    // Every selected test counts, including tests that never started.
    const scenarios = suite.allTests().map((test) => scenarioRecord(test, configDir));
    const verdictStatus =
      status === 'passed' && scenarios.some(({ verdict }) => verdict !== 'supported')
        ? 'failed'
        : status;
    for (const scenario of scenarios) {
      process.stdout.write(`${verdictLine(scenario)}\n`);
    }
    const manifest = {
      schemaVersion: 0,
      verdicts: 'strict',
      status: verdictStatus,
      scenarios,
    } satisfies RunManifest;
    const file = resolve(configDir, this.verdicts.runManifest);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`);
    return verdictStatus;
  }
}
