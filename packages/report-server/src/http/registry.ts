import type { ReportProvider, ReportFailure, ReportSummary } from '../model/provider.js';
import type { ReportRegistry } from '../model/server.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyProperties(value: Record<string, unknown>, properties: readonly string[]): boolean {
  const allowed = new Set(properties);
  return (
    properties.every((property) => Object.hasOwn(value, property)) &&
    Object.keys(value).every((property) => allowed.has(property))
  );
}

function isReportSummary(value: unknown, providerType: string): value is ReportSummary {
  if (
    !isRecord(value) ||
    !hasOnlyProperties(value, ['kind', 'id', 'type', 'title', 'description', 'state', 'createdAt']) ||
    value.kind !== 'report-summary' ||
    value.type !== providerType
  ) {
    return false;
  }
  if (
    typeof value.id !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.state !== 'string' ||
    typeof value.createdAt !== 'string' ||
    !isRecord(value.description)
  ) {
    return false;
  }
  if (value.description.kind === 'unavailable') {
    return hasOnlyProperties(value.description, ['kind']);
  }
  return (
    value.description.kind === 'available' &&
    typeof value.description.value === 'string' &&
    hasOnlyProperties(value.description, ['kind', 'value'])
  );
}

function isReportFailure(value: unknown): value is ReportFailure {
  return (
    isRecord(value) &&
    hasOnlyProperties(value, ['kind', 'code', 'message']) &&
    value.kind === 'report-failure' &&
    typeof value.message === 'string' &&
    (value.code === 'not-found' ||
      value.code === 'invalid-request' ||
      value.code === 'artifact-unavailable' ||
      value.code === 'provider-error')
  );
}

function isReportListResult(value: unknown, providerType: string): value is
  | { kind: 'report-list'; reports: readonly ReportSummary[] }
  | ReportFailure {
  if (isReportFailure(value)) {
    return true;
  }
  return (
    isRecord(value) &&
    hasOnlyProperties(value, ['kind', 'reports']) &&
    value.kind === 'report-list' &&
    Array.isArray(value.reports) &&
    value.reports.every((report) => isReportSummary(report, providerType))
  );
}

export function providerFailure(): ReportFailure {
  return {
    kind: 'report-failure',
    code: 'provider-error',
    message: 'The report provider could not read the requested records.',
  };
}

export async function listRegistry(input: {
  providers: readonly ReportProvider[];
}): Promise<ReportRegistry> {
  const results = await Promise.all(
    input.providers.map(async (provider) => {
      try {
        const result = await provider.list({ kind: 'list-reports' });
        return {
          type: provider.type,
          result: isReportListResult(result, provider.type) ? result : providerFailure(),
        };
      } catch {
        return { type: provider.type, result: providerFailure() };
      }
    }),
  );
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
