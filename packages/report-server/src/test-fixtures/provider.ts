import type { ReportProvider } from '../model/provider.js';

export function fixtureProvider() {
  const calls: string[] = [];
  const provider = {
    kind: 'report-provider', type: 'capsule',
    view: { kind: 'report-client-view', styles: '.fixture{}', script: `BlackboxReportViews.capsule={render(root,document){root.textContent=document.title}};` },
    list() {
      calls.push('list');
      return Promise.resolve({ kind: 'report-list', reports: [
        { kind: 'report-summary', id: 'exact-one', type: 'capsule', title: 'Orders', state: 'stopped', createdAt: '2026-09-23T10:00:00Z' },
        { kind: 'report-summary', id: 'exact-two', type: 'capsule', title: 'Billing', state: 'running', createdAt: '2026-09-23T11:00:00Z' },
      ] } as const);
    },
    load(input) {
      calls.push(`load:${input.id}`);
      if (input.id === 'corrupt') { throw new Error('PRIVATE filesystem details'); }
      if (input.id !== 'exact-one' && input.id !== 'exact-two') {
        return Promise.resolve({ kind: 'report-failure', code: 'not-found', message: 'No such exact session.' } as const);
      }
      return Promise.resolve({ kind: 'report-document', document: { id: input.id, title: 'Orders' } } as const);
    },
    artifact(input) {
      calls.push(`artifact:${input.id}:${input.artifact}`);
      if (input.artifact !== 'activities.json') {
        return Promise.resolve({ kind: 'report-failure', code: 'artifact-unavailable', message: 'Artifact unavailable.' } as const);
      }
      return Promise.resolve({ kind: 'report-artifact', artifact: input.artifact, document: [] } as const);
    },
    render() { calls.push('render'); return '<!doctype html><h1>Shared renderer</h1>'; },
  } satisfies ReportProvider;
  return { provider, calls };
}
