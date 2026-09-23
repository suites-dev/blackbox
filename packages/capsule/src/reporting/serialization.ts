import type { SerializeCapsuleReportDocumentInput } from './types.js';

export function serializeCapsuleReportDocument(
  input: SerializeCapsuleReportDocumentInput,
): string {
  return `${JSON.stringify(input.document, null, 2)}\n`;
}
