import { listCapsuleSessions, renderCapsuleHtml, reportCapsule, type CapsuleReportDocument, type CapsuleReportResult, type CapsuleRegistryEntry } from '@suites/blackbox-capsule-internal';
import type { ReportFailure, ReportProvider, ReportSummary } from '@suites/blackbox-report-server-internal';

function reportFailure(input: { result: Exclude<CapsuleReportResult, { kind: 'capsule-report' }> }): ReportFailure {
  if (input.result.kind === 'capsule-not-found') {
    return { kind: 'report-failure', code: 'not-found', message: 'The exact Capsule session does not exist.' };
  }
  return { kind: 'report-failure', code: 'artifact-unavailable', message: 'The retained Capsule report could not be read.' };
}

function summary(input: { entry: CapsuleRegistryEntry }): ReportSummary {
  if (input.entry.kind === 'capsule-session-summary') {
    const item = input.entry.summary;
    return {
      kind: 'report-summary',
      type: 'capsule',
      id: item.sessionId,
      title: item.title,
      description: item.description === undefined
        ? { kind: 'unavailable' }
        : { kind: 'available', value: item.description },
      state: item.state,
      createdAt: item.admittedAt,
    };
  }
  return { kind: 'report-summary', type: 'capsule', id: input.entry.directoryName.replace(/^capsule-/u, ''),
    title: 'Unreadable Capsule session', description: { kind: 'unavailable' }, state: input.entry.failure.kind, createdAt: 'unavailable' };
}

function renderDocument(input: { kind: 'render-report'; document: unknown }): string {
  if (typeof input.document !== 'object' || input.document === null || !('kind' in input.document) || input.document.kind !== 'capsule-operational-report') {
    throw new Error('Expected a Capsule operational report.');
  }
  // The only producer is reportCapsule; generic server transports this same value.
  return renderCapsuleHtml({ report: input.document as CapsuleReportDocument });
}

export function capsuleReportProvider(input: { projectDirectory: string }): ReportProvider {
  return {
    kind: 'report-provider', type: 'capsule',
    async list() {
      const result = await listCapsuleSessions(input);
      if (result.kind === 'capsule-registry-failed') {
        return { kind: 'report-failure', code: 'artifact-unavailable', message: 'The Capsule session registry could not be read.' };
      }
      return { kind: 'report-list', reports: result.entries.map(entry => summary({ entry })) };
    },
    async load(request) {
      const result = await reportCapsule({ projectDirectory: input.projectDirectory, sessionId: request.id });
      return result.kind === 'capsule-report' ? { kind: 'report-document', document: result.document } : reportFailure({ result });
    },
    async artifact(request) {
      if (request.artifact !== 'report.json') {
        return { kind: 'report-failure', code: 'not-found', message: 'Only the redacted report.json projection is available for this provider.' };
      }
      const result = await reportCapsule({ projectDirectory: input.projectDirectory, sessionId: request.id });
      return result.kind === 'capsule-report'
        ? { kind: 'report-artifact', artifact: 'report.json', document: result.document }
        : reportFailure({ result });
    },
    render: renderDocument,
  };
}
