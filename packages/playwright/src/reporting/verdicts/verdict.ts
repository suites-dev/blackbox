import { relative } from 'node:path';

import type { FullResult, TestCase, TestResult } from '@playwright/test/reporter';

import { attemptAttachment } from '../events.js';
import { reportText } from '../text.js';

/** Why a test is not supported; an empty list means it is supported. */
export type NotSupportedReason =
  'expected-to-fail' | 'skipped' | 'not-run' | 'interrupted' | 'flaky' | 'failed' | 'not-passed';

export interface ScenarioVerdict {
  readonly verdict: 'supported' | 'not-supported';
  readonly reasons: readonly NotSupportedReason[];
}

export interface ScenarioRecord extends ScenarioVerdict {
  readonly id: string;
  readonly titlePath: readonly string[];
  readonly location: { readonly file: string; readonly line: number; readonly column: number };
  readonly requirements: readonly string[];
  readonly expectedStatus: TestCase['expectedStatus'];
  readonly outcome: ReturnType<TestCase['outcome']>;
  readonly attempts: readonly {
    readonly retry: number;
    readonly status: TestResult['status'];
    readonly executionId: string | null;
  }[];
}

export interface RunManifest {
  readonly schemaVersion: 0;
  readonly verdicts: 'strict';
  readonly status: FullResult['status'];
  readonly scenarios: readonly ScenarioRecord[];
}

type VerdictInput = Pick<TestCase, 'expectedStatus' | 'outcome'> & {
  readonly results: readonly Pick<TestResult, 'status'>[];
};

/**
 * Strict mapping: only a test that was expected to pass, ran, and passed on its
 * first and only attempt is supported. Flaky, test.fail(), skipped, interrupted
 * and unrun tests are not supported even when Playwright counts them as ok.
 */
export function scenarioVerdict(test: VerdictInput): ScenarioVerdict {
  const statuses = test.results.map((result) => result.status);
  const outcome = test.outcome();
  const reasons: NotSupportedReason[] = [];
  if (test.expectedStatus === 'failed') {
    reasons.push('expected-to-fail');
  }
  if (test.expectedStatus === 'skipped' || statuses.includes('skipped')) {
    reasons.push('skipped');
  }
  if (statuses.length === 0) {
    reasons.push('not-run');
  }
  if (statuses.includes('interrupted')) {
    reasons.push('interrupted');
  }
  if (outcome === 'flaky') {
    reasons.push('flaky');
  }
  if (outcome === 'unexpected') {
    reasons.push('failed');
  }
  if (reasons.length === 0 && (outcome !== 'expected' || statuses.some((s) => s !== 'passed'))) {
    reasons.push('not-passed');
  }
  return { verdict: reasons.length === 0 ? 'supported' : 'not-supported', reasons };
}

/** Requirement IDs are copied for traceability and never read by the verdict. */
export function requirementIds(test: Pick<TestCase, 'annotations'>): string[] {
  const ids = test.annotations.flatMap((annotation) =>
    annotation.type === 'requirement' && annotation.description !== undefined
      ? [annotation.description]
      : [],
  );
  return [...new Set(ids)];
}

function attemptExecutionId(result: TestResult): string | null {
  const attachment = result.attachments.find(({ name }) => name === attemptAttachment);
  if (attachment === undefined || attachment.body === undefined) {
    return null;
  }
  try {
    const document: unknown = JSON.parse(attachment.body.toString('utf8'));
    if (typeof document !== 'object' || document === null || !('identity' in document)) {
      return null;
    }
    const identity = document.identity;
    return typeof identity === 'object' &&
      identity !== null &&
      'executionId' in identity &&
      typeof identity.executionId === 'string'
      ? identity.executionId
      : null;
  } catch {
    return null;
  }
}

export function scenarioRecord(test: TestCase, configDir: string): ScenarioRecord {
  return {
    id: test.id,
    titlePath: test.titlePath().filter((title) => title !== ''),
    location: {
      file: relative(configDir, test.location.file),
      line: test.location.line,
      column: test.location.column,
    },
    requirements: requirementIds(test),
    expectedStatus: test.expectedStatus,
    outcome: test.outcome(),
    attempts: test.results.map((result) => ({
      retry: result.retry,
      status: result.status,
      executionId: attemptExecutionId(result),
    })),
    ...scenarioVerdict(test),
  };
}

export function verdictLine(record: ScenarioRecord): string {
  const verdict =
    record.verdict === 'supported' ? 'supported' : `not supported (${record.reasons.join(', ')})`;
  const requirements = record.requirements.length > 0 ? record.requirements.join(', ') : '-';
  return reportText(`${verdict} [${requirements}] ${record.titlePath.join(' › ')}`);
}
