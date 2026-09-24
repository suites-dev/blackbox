import { gunzip } from 'node:zlib';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CollectorStore } from '../lifecycle/store.js';
import type { StartCollectorInput } from '../model/types.js';
import { readCollectorSession, readCollectorTrace } from '../storage/reader.js';
import { recordedFailure } from '../model/validation.js';
import { validateOtlpTraceRequest } from '../otlp/json.js';

class RequestFailure extends Error {
  readonly status: number;
  public constructor(status: number, message: string) {
    super(message);
    this.name = 'RequestFailure';
    this.status = status;
  }
}

function writeJson(input: {
  readonly response: ServerResponse;
  readonly status: number;
  readonly value: unknown;
}): void {
  const body = `${JSON.stringify(input.value)}\n`;
  input.response.writeHead(input.status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  input.response.end(body);
}

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

async function serveRead(input: {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly config: StartCollectorInput;
  readonly store: CollectorStore;
  readonly path: string;
}): Promise<void> {
  const prefix = `${input.config.endpoint.readPath}/traces/`;
  const knownPath =
    input.path === input.config.endpoint.readPath ||
    input.path === `${input.config.endpoint.readPath}/session` ||
    input.path.startsWith(prefix);
  if (!knownPath) {
    throw new RequestFailure(404, 'Collector endpoint not found.');
  }
  if (input.request.method !== 'GET') {
    throw new RequestFailure(405, 'Collector read endpoints require GET.');
  }
  if (input.path === input.config.endpoint.readPath) {
    writeJson({ response: input.response, status: 200, value: input.store.status() });
    return;
  }
  if (input.path === `${input.config.endpoint.readPath}/session`) {
    const result = await readCollectorSession(input.config);
    writeJson({
      response: input.response,
      status:
        result.kind === 'collector-session-missing'
          ? 404
          : result.kind === 'collector-session-corrupt'
            ? 500
            : 200,
      value: result,
    });
    return;
  }
  try {
    const traceId = decodeURIComponent(input.path.slice(prefix.length));
    const result = await readCollectorTrace({ ...input.config, traceId });
    writeJson({
      response: input.response,
      status:
        result.kind === 'collector-trace-missing'
          ? 404
          : result.kind === 'collector-trace-corrupt'
            ? 500
            : 200,
      value: result,
    });
  } catch (error) {
    throw new RequestFailure(400, recordedFailure(error).message);
  }
}

export async function handleCollectorRequest(input: {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly config: StartCollectorInput;
  readonly store: CollectorStore | null;
}): Promise<void> {
  try {
    if (input.store === null) {
      throw new RequestFailure(503, 'Collector storage is not ready.');
    }
    const path = new URL(input.request.url ?? '/', 'http://collector.invalid').pathname;
    if (path === input.config.endpoint.tracesPath) {
      await acceptTraces({ ...input, store: input.store });
    } else {
      await serveRead({ ...input, store: input.store, path });
    }
  } catch (error) {
    const failure = recordedFailure(error);
    const status = error instanceof RequestFailure ? error.status : 500;
    if (status === 500 && input.store !== null) {
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
