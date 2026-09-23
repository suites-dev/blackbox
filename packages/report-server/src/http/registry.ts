import type { ReportProvider, ReportFailure } from '../model/provider.js';
import type { ReportRegistry } from '../model/server.js';

export function providerFailure(): ReportFailure {
  return { kind: 'report-failure', code: 'provider-error', message: 'The report provider could not read the requested records.' };
}

export async function listRegistry(input: {
  providers: readonly ReportProvider[];
}): Promise<ReportRegistry> {
  const results = await Promise.all(input.providers.map(async (provider) => {
    try {
      return { type: provider.type, result: await provider.list({ kind: 'list-reports' }) };
    } catch {
      return { type: provider.type, result: providerFailure() };
    }
  }));
  const reports: ReportRegistry['reports'][number][] = [];
  const failures: ReportRegistry['failures'][number][] = [];
  for (const { type, result } of results) {
    if (result.kind === 'report-list') {
      reports.push(...result.reports);
    } else {
      failures.push({ type, failure: result });
    }
  }
  reports.sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
  return { kind: 'report-registry', schemaVersion: 1, reports, failures };
}
