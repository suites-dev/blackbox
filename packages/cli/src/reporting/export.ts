import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { renderCapsuleHtml, serializeCapsuleReportDocument, type CapsuleReportDocument } from '@suites/blackbox-capsule-internal';

export interface ExportReportInput {
  kind: 'export-report';
  projectDirectory: string;
  format: 'html' | 'json';
  document: CapsuleReportDocument;
  destination: { kind: 'stdout' } | { kind: 'default' } | { kind: 'file'; path: string };
}

export type ExportReportResult = { kind: 'file'; path: string } | { kind: 'stdout'; content: string };

export async function exportReport(input: ExportReportInput): Promise<ExportReportResult> {
  const content = input.format === 'html'
    ? renderCapsuleHtml({ report: input.document })
    : serializeCapsuleReportDocument({ document: input.document });
  if (input.destination.kind === 'stdout') {
    if (input.format !== 'json') { throw new Error('Only JSON exports support stdout.'); }
    return { kind: 'stdout', content };
  }
  const path = resolve(input.projectDirectory, input.destination.kind === 'file'
    ? input.destination.path
    : `.blackbox/reports/capsule-${input.document.session.sessionId}/capsule-report.${input.format}`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
  return { kind: 'file', path };
}
