import type { ReportProvider } from '../model/provider.js';
import { renderRegistryPage } from '../ui/registry-page.js';
import { listRegistry } from './registry.js';
import { failureResult, jsonResult, type HttpResult } from './response.js';

export function validSegment(input: { value: string }): boolean {
  return (
    /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(input.value) &&
    input.value !== '.' &&
    input.value !== '..'
  );
}

export function notFound(): HttpResult {
  return failureResult({
    failure: {
      kind: 'report-failure',
      code: 'not-found',
      message: 'The requested report resource was not found.',
    },
  });
}

function partsOf(input: { path: string }): string[] {
  const path = input.path.split('?')[0];
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new Error('Invalid path');
  }
  const parts = path.slice(1).split('/').map(decodeURIComponent);
  if (parts.some((value) => !validSegment({ value }))) {
    throw new Error('Invalid path segment');
  }
  return parts;
}

async function reportResult(input: {
  provider: ReportProvider;
  parts: string[];
  html: boolean;
}): Promise<HttpResult> {
  const { provider, parts, html } = input;
  const id = parts[html ? 2 : 3];
  if (!html && parts.length === 6 && parts[4] === 'artifacts') {
    const result = await provider.artifact({ kind: 'load-artifact', id, artifact: parts[5] });
    return result.kind === 'report-failure'
      ? failureResult({ failure: result })
      : jsonResult({ status: 200, document: result });
  }
  if (parts.length !== (html ? 3 : 4)) {
    return notFound();
  }
  const result = await provider.load({ kind: 'load-report', id });
  if (result.kind === 'report-failure') {
    return failureResult({ failure: result });
  }
  if (!html) {
    return jsonResult({ status: 200, document: result });
  }
  return {
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: provider.render({ kind: 'render-report', document: result.document }),
  };
}

export async function routeRequest(input: {
  path: string;
  providers: readonly ReportProvider[];
}): Promise<HttpResult> {
  if (input.path.split('?')[0] === '/') {
    return {
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: renderRegistryPage({ providers: input.providers }),
    };
  }
  let parts: string[];
  try {
    parts = partsOf(input);
  } catch {
    return failureResult({
      failure: { kind: 'report-failure', code: 'invalid-request', message: 'Invalid report path.' },
    });
  }
  const html = parts[0] === 'reports';
  if (!html && (parts[0] !== 'api' || parts[1] !== 'reports')) {
    return notFound();
  }
  if (!html && parts.length === 2) {
    return jsonResult({ status: 200, document: await listRegistry(input) });
  }
  const type = parts[html ? 1 : 2];
  const provider = input.providers.find((candidate) => candidate.type === type);
  if (provider === undefined) {
    return notFound();
  }
  if (!html && parts.length === 3) {
    return jsonResult({ status: 200, document: await listRegistry({ providers: [provider] }) });
  }
  return reportResult({ provider, parts, html });
}
