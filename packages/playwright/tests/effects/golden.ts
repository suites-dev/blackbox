import type { TestInfo } from '@playwright/test';
import { expect } from '@suites/blackbox-playwright';

import type { EffectEvidenceArtifact } from '../../src/effects/evaluation/artifact-types.js';

interface EffectReport {
  readonly assertion: {
    readonly contract: Readonly<Record<string, unknown>>;
    readonly evaluation: string;
    readonly negated: boolean;
    readonly outcome: string;
  };
  readonly evidence: EffectEvidenceArtifact;
}

export function effectsGolden(info: TestInfo): void {
  const reports = info.attachments.filter(({ name }) => name === 'blackbox-effects');
  expect(reports.length).toBeGreaterThan(0);
  const golden = reports.map(({ body }) => {
    if (body === undefined) {
      throw new Error('Effects assertion omitted its report body');
    }
    const report = JSON.parse(body.toString('utf8')) as EffectReport;
    expect(report.evidence.kind).toBe('admitted');
    const { contract, evaluation, negated, outcome } = report.assertion;
    const witnessed = new Set(
      report.evidence.assessment.findings.flatMap(({ evidence }) => evidence),
    );
    const witnesses = report.evidence.projection.effects
      .filter(({ id }) => witnessed.has(id))
      .map(({ kind, actor, operation, target, outcome: observedOutcome }) => ({
        kind,
        actor,
        operation,
        target,
        outcome: observedOutcome,
      }));
    // Repeated arrivals and generated identities are not the assertion contract.
    // Keep the distinct semantic witnesses alongside the public verdict.
    const distinct = new Map(witnesses.map((witness) => [JSON.stringify(witness), witness]));
    return {
      contract,
      evaluation,
      negated,
      outcome,
      witnesses: [...distinct].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value),
    };
  });
  expect(`${JSON.stringify(golden, null, 2)}\n`).toMatchSnapshot(
    `${info.title.replaceAll(/[^\w-]+/g, '-')}.txt`,
  );
}
