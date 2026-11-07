import type { EmissionAssertionReport } from '../../effects/emissions/types.js';
import { evidenceLimits } from '../../effects/evaluation/artifact.js';
import { reportTextLimit } from '../text.js';

export { attachExecutionArtifact, type AttachedEvidence, type ExecutionArtifactKind } from '../capture/execution-artifact.js';
export { evidenceForClaim, linkClaim } from '../../assertions/claims/context.js';

export const emissionAttachment = 'blackbox-emissions';

export function emissionAttachmentBody(input: {
  readonly sequence: number;
  readonly report: EmissionAssertionReport;
  readonly sanitize: (text: string) => { readonly text: string; readonly truncated: boolean };
}): string {
  const report = input.report;
  const assessment = report.assessment;
  const outcome = assessment.status === 'inconclusive' ? 'inconclusive'
    : (assessment.status === 'pass') === report.negated ? 'failed' : 'passed';
  const limit = evidenceLimits.evidencePerFinding;
  const identity = (value: typeof assessment.identity) => ({
    ...value, activityIds: value.activityIds.slice(0, evidenceLimits.activities),
  });
  const document = {
    schemaVersion: 1,
    assertion: {
      sequence: input.sequence, matcher: report.matcher, expected: report.expected,
      negated: report.negated, outcome, evaluation: assessment.status, diagnostic: assessment.reason,
    },
    assessment: {
      ...assessment,
      identity: identity(assessment.identity),
      coverage: { ...assessment.coverage, reasons: assessment.coverage.reasons.slice(0, evidenceLimits.qualityReasons) },
      evidence: assessment.evidence.slice(0, limit), possibleEvidence: assessment.possibleEvidence.slice(0, limit),
      relations: assessment.relations.slice(0, evidenceLimits.relations),
    },
    witnesses: report.witnesses.slice(0, limit).map(({ attributes, source, ...effect }) => ({
      ...effect, source: source.slice(0, evidenceLimits.sourcesPerEffect),
      fields: Object.entries(attributes).slice(0, 32).map(([key, value]) => ({ key, value })),
      omittedSources: Math.max(0, source.length - evidenceLimits.sourcesPerEffect),
      omittedFields: Math.max(0, Object.keys(attributes).length - 32),
    })),
    omitted: {
      evidence: Math.max(0, assessment.evidence.length - limit),
      possibleEvidence: Math.max(0, assessment.possibleEvidence.length - limit),
      activityIds: Math.max(0, assessment.identity.activityIds.length - evidenceLimits.activities),
      coverageReasons: Math.max(0, assessment.coverage.reasons.length - evidenceLimits.qualityReasons),
      witnesses: Math.max(0, report.witnesses.length - limit),
      relations: Math.max(0, assessment.relations.length - evidenceLimits.relations),
      otherActivityIds: report.otherCapture === null ? 0
        : Math.max(0, report.otherCapture.activityIds.length - evidenceLimits.activities),
    },
    ...(report.otherCapture === null ? {} : { otherCapture: identity(report.otherCapture) }),
    evidence: report.evidence ?? { kind: 'not-admitted' },
    display: { stringLimit: reportTextLimit, truncatedStrings: 0 },
  };
  JSON.stringify(document, (_key, value: unknown) => {
    if (typeof value === 'string' && input.sanitize(value).truncated) { document.display.truncatedStrings++; }
    return value;
  });
  return JSON.stringify(document, (_key, value: unknown) => typeof value === 'string' ? input.sanitize(value).text : value);
}
