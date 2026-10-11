import type { EffectAssertionReport, EffectEvaluation } from '../../effects/runtime.js';
import { reportTextLimit } from '../text.js';
import { effectContractAttachment } from './contract.js';

export const effectAttachment = 'blackbox-effects';

function outcome(report: EffectAssertionReport): 'passed' | 'failed' | 'inconclusive' {
  if (report.evaluation.kind === 'inconclusive') {
    return 'inconclusive';
  }
  const satisfied = report.evaluation.kind === 'satisfied';
  return satisfied === report.negated ? 'failed' : 'passed';
}

function diagnostic(evaluation: EffectEvaluation): string {
  return evaluation.kind === 'satisfied' ? '' : evaluation.message;
}

export function effectAttachmentBody(input: {
  readonly sequence: number;
  readonly report: EffectAssertionReport;
  readonly sanitize: (
    value: string,
  ) => { readonly text: string; readonly truncated: boolean };
}): string {
  let truncatedStrings = 0;
  const artifact = {
    schemaVersion: 1,
    assertion: {
      sequence: input.sequence,
      negated: input.report.negated,
      outcome: outcome(input.report),
      evaluation: input.report.evaluation.kind,
      diagnostic: diagnostic(input.report.evaluation),
      contract: effectContractAttachment(input.report.contract),
    },
    display: {
      stringLimit: reportTextLimit,
      truncatedStrings: 0,
    },
    evidence: input.report.evidence ?? { kind: 'not-admitted' },
  };
  JSON.stringify(artifact, (_key, value: unknown) => {
    if (typeof value !== 'string') {
      return value;
    }
    const sanitized = input.sanitize(value);
    if (sanitized.truncated) {
      truncatedStrings++;
    }
    return sanitized.text;
  });
  artifact.display.truncatedStrings = truncatedStrings;
  return JSON.stringify(artifact, (_key, value: unknown) => {
    return typeof value === 'string' ? input.sanitize(value).text : value;
  });
}
