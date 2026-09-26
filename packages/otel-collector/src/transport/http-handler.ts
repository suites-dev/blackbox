import { gunzip } from 'node:zlib';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CollectorStore } from '../lifecycle/store.js';
import type { StartCollectorInput } from '../model/types.js';
import { recordedFailure } from '../model/validation.js';
import { validateOtlpTraceRequest } from '../otlp/json.js';
import { parseActivation } from '../activation/validation.js';
import { requireAuthorization } from './authorization.js';
import { RequestFailure, writeJson } from './response.js';
import { serveCollectorRead } from './read-handler.js';
import { CollectorRetentionLimitError } from '../lifecycle/retention.js';

function readEncodedBody(input: {
  readonly request: IncomingMessage;
  readonly limit: number;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
    input.request.on('data', (chunk: Buffer) => {
      length += chunk.byteLength;
      if (length > input.limit) {
        reject(new RequestFailure(413, 'OTLP request exceeds the configured byte limit.'));
        chunks.length = 0;
      } else {
        chunks.push(chunk);
      }
    });
    input.request.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    input.request.on('aborted', () => {
      reject(new RequestFailure(400, 'OTLP request body was interrupted by the client.'));
    });
    input.request.on('error', () => {
      reject(new RequestFailure(400, 'OTLP request body could not be read.'));
    });
  });
}

function gunzipBody(input: { readonly bytes: Buffer; readonly limit: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    gunzip(input.bytes, { maxOutputLength: input.limit }, (error, result) => {
      if (error !== null) {
        const message = error.message.includes('larger than')
          ? 'Decompressed OTLP request exceeds the configured byte limit.'
          : 'OTLP gzip body is invalid.';
        reject(new RequestFailure(error.message.includes('larger than') ? 413 : 400, message));
      } else {
        resolve(result);
      }
    });
  });
}

function contentEncoding(request: IncomingMessage): 'identity' | 'gzip' {
  const value = request.headers['content-encoding'];
  if (value === undefined || value === 'identity') {
    return 'identity';
  }
  if (value === 'gzip') {
    return 'gzip';
  }
  throw new RequestFailure(415, 'Only identity and gzip content encodings are supported.');
}

function requireJsonContentType(request: IncomingMessage): void {
  const value = request.headers['content-type'];
  const mediaType = value === undefined ? '' : value.split(';', 1)[0];
  if (mediaType.trim().toLowerCase() !== 'application/json') {
    throw new RequestFailure(
      415,
      'This receiver supports OTLP/HTTP JSON only; use Content-Type: application/json.',
    );
  }
}

async function decodeTraceRequest(input: {
  readonly request: IncomingMessage;
  readonly limit: number;
}): Promise<{
  readonly rawJson: string;
  readonly encoding: 'identity' | 'gzip';
  readonly value: unknown;
}> {
  requireJsonContentType(input.request);
  const encoding = contentEncoding(input.request);
  const encoded = await readEncodedBody(input);
  const bytes =
    encoding === 'gzip' ? await gunzipBody({ bytes: encoded, limit: input.limit }) : encoded;
  if (bytes.byteLength > input.limit) {
    throw new RequestFailure(413, 'OTLP request exceeds the configured byte limit.');
  }
  const rawJson = bytes.toString('utf8');
  try {
    return { rawJson, encoding, value: JSON.parse(rawJson) as unknown };
  } catch {
    throw new RequestFailure(400, 'OTLP request body is not valid JSON.');
  }
}

async function acceptTraces(input: {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly config: StartCollectorInput;
  readonly store: CollectorStore;
}): Promise<void> {
  if (input.request.method !== 'POST') {
    throw new RequestFailure(405, 'The OTLP traces endpoint requires POST.');
  }
  const decoded = await decodeTraceRequest({
    request: input.request,
    limit: input.config.limits.maxRequestBytes,
  });
  let spanCount: number;
  try {
    spanCount = validateOtlpTraceRequest(decoded.value);
  } catch (error) {
    throw new RequestFailure(400, recordedFailure(error).message);
  }
  await input.store.accept({
    rawJson: decoded.rawJson,
    contentEncoding: decoded.encoding,
    spanCount,
  });
  writeJson({ response: input.response, status: 200, value: {} });
}

async function activateInstrumentation(input: {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly config: StartCollectorInput;
  readonly store: CollectorStore;
}): Promise<void> {
  if (input.request.method !== 'POST') {
    throw new RequestFailure(405, 'The instrumentation activation endpoint requires POST.');
  }
  const decoded = await decodeTraceRequest({
    request: input.request,
    limit: input.config.limits.maxRequestBytes,
  });
  const activation = parseActivation(decoded.value);
  if (
    activation.sessionId !== input.config.sessionId ||
    activation.executionId !== input.config.executionId
  ) {
    throw new RequestFailure(409, 'Instrumentation activation identity does not match collector.');
  }
  await input.store.activate(activation);
  writeJson({ response: input.response, status: 200, value: input.store.status() });
}

export async function handleCollectorRequest(input: {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly config: StartCollectorInput;
  readonly store: CollectorStore | null;
}): Promise<void> {
  try {
    const path = new URL(input.request.url ?? '/', 'http://collector.invalid').pathname;
    if (path === input.config.endpoint.readinessPath) {
      if (input.request.method !== 'GET') {
        throw new RequestFailure(405, 'The collector readiness endpoint requires GET.');
      }
      if (input.store === null || input.store.status().receiver !== 'ready') {
        throw new RequestFailure(503, 'Collector storage is not ready.');
      }
      writeJson({ response: input.response, status: 200, value: { kind: 'collector-ready' } });
      return;
    }
    if (input.store === null) {
      throw new RequestFailure(503, 'Collector storage is not ready.');
    }
    if (path === input.config.endpoint.tracesPath) {
      requireAuthorization({
        request: input.request,
        authorization: input.config.authorization,
        scope: { kind: 'ingest' },
      });
      await acceptTraces({ ...input, store: input.store });
    } else if (path === input.config.endpoint.activationPath) {
      requireAuthorization({
        request: input.request,
        authorization: input.config.authorization,
        scope: { kind: 'ingest' },
      });
      await activateInstrumentation({ ...input, store: input.store });
    } else {
      requireAuthorization({
        request: input.request,
        authorization: input.config.authorization,
        scope: { kind: 'control' },
      });
      await serveCollectorRead({ ...input, store: input.store, path });
    }
  } catch (error) {
    const failure = recordedFailure(error);
    const status =
      error instanceof RequestFailure
        ? error.status
        : error instanceof CollectorRetentionLimitError
          ? 507
          : 500;
    if ((status === 500 || status === 507) && input.store !== null) {
      await input.store.fail(error).catch(() => undefined);
    }
    if (!input.response.headersSent) {
      writeJson({
        response: input.response,
        status,
        value: { message: failure.message },
      });
    } else {
      input.response.destroy();
    }
  }
}
