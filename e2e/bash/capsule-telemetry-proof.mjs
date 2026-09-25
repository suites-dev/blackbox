import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const httpTraceAttempts = 150;
const httpTraceIntervalMs = 100;

function object(value, location) {
  assert.equal(typeof value, 'object', `${location} must be an object`);
  assert.notEqual(value, null, `${location} must be an object`);
  assert.equal(Array.isArray(value), false, `${location} must be an object`);
  return value;
}

function array(value, location) {
  assert.ok(Array.isArray(value), `${location} must be an array`);
  return value;
}

function text(value, location) {
  assert.equal(typeof value, 'string', `${location} must be a string`);
  return value;
}

function attributeValue(value) {
  const record = object(value, 'attribute.value');
  for (const key of ['stringValue', 'intValue', 'doubleValue', 'boolValue']) {
    if (key in record) {
      return String(record[key]);
    }
  }
  return '';
}

function attributes(value) {
  const result = new Map();
  for (const entry of array(value, 'attributes')) {
    const record = object(entry, 'attribute');
    result.set(text(record.key, 'attribute.key'), attributeValue(record.value));
  }
  return result;
}

function spans(document) {
  const result = [];
  for (const fragment of array(document.fragments, 'fragments')) {
    const request = object(object(fragment, 'fragment').request, 'fragment.request');
    for (const resourceEntry of array(request.resourceSpans, 'resourceSpans')) {
      const resourceSpan = object(resourceEntry, 'resourceSpan');
      const resource = object(resourceSpan.resource, 'resourceSpan.resource');
      const resourceAttributes = attributes(resource.attributes);
      const service = resourceAttributes.get('service.name') ?? 'unknown';
      for (const scopeEntry of array(resourceSpan.scopeSpans, 'scopeSpans')) {
        const scopeSpan = object(scopeEntry, 'scopeSpan');
        const scope = object(scopeSpan.scope, 'scopeSpan.scope');
        const scopeName = text(scope.name, 'scope.name');
        for (const spanEntry of array(scopeSpan.spans, 'spans')) {
          const span = object(spanEntry, 'span');
          result.push({
            attributes: attributes(span.attributes),
            name: text(span.name, 'span.name'),
            parentSpanId: typeof span.parentSpanId === 'string' ? span.parentSpanId : '',
            scopeName,
            service,
            spanId: text(span.spanId, 'span.spanId'),
            traceId: text(span.traceId, 'span.traceId'),
          });
        }
      }
    }
  }
  return result;
}

function hasHttpPath(span, expectedPath) {
  if (span.name.includes(expectedPath)) {
    return true;
  }
  for (const key of ['http.target', 'http.route', 'http.url', 'url.path', 'url.full']) {
    const value = span.attributes.get(key);
    if (value !== undefined && value.includes(expectedPath)) {
      return true;
    }
  }
  return false;
}

function assertActivityRoot(input) {
  assert.equal(input.execution.kind, 'capsule-exec-completed');
  assert.equal(input.observation.kind, 'collector-activity-found');
  assert.equal(input.observation.activityId, input.execution.activityId);
  assert.equal(input.observation.traceIds.length, 1);
  const traceId = text(input.observation.traceIds[0], 'activity trace ID');
  const retained = spans(input.observation);
  assert.ok(retained.length > 0, 'activity trace must retain its Capsule root');
  assert.ok(
    retained.every((span) => span.traceId === traceId),
    'activity result mixed trace IDs',
  );
  const roots = retained.filter(
    (span) =>
      span.service === 'blackbox-capsule' &&
      span.attributes.get('blackbox.activity.id') === input.execution.activityId,
  );
  assert.equal(roots.length, 1, 'activity trace must contain one exact Capsule root');
  return { root: roots[0], retained, traceId };
}

export function validateHttpTrace(execution, observation, trace) {
  const activity = assertActivityRoot({ execution, observation });
  assert.equal(trace.kind, 'collector-trace-found');
  assert.equal(trace.traceId, activity.traceId);
  const retained = spans(trace);
  const publicApi = retained.filter(
    (span) => span.service === 'public-api' && hasHttpPath(span, '/subscriptions'),
  );
  assert.ok(publicApi.length > 0, 'trace must contain the public-api /subscriptions boundary');
  assert.ok(
    publicApi.some((span) => span.parentSpanId === activity.root.spanId),
    'public-api server span must descend from the exact Capsule activity root',
  );
  const services = new Set(retained.map((span) => span.service));
  for (const service of ['fraud-check', 'order-service', 'payment-mock', 'public-api']) {
    assert.ok(services.has(service), `trace must contain instrumented service ${service}`);
  }
  return {
    kind: 'propagated-http-telemetry-proof',
    activityId: execution.activityId,
    traceId: activity.traceId,
    services: [...services].sort(),
    spanCount: retained.length,
  };
}

function diagnostic(error) {
  if (error instanceof Error) {
    const stderr = 'stderr' in error && typeof error.stderr === 'string' ? error.stderr.trim() : '';
    return stderr.length > 0 ? `${error.message}\n${stderr}` : error.message;
  }
  return String(error);
}

async function pollHttpTrace(input) {
  const execution = await readJson(input.executionFile);
  const activity = await readJson(input.activityFile);
  let lastDiagnostic = 'exact trace has not been queried';
  for (let attempt = 1; attempt <= httpTraceAttempts; attempt += 1) {
    try {
      const result = await execute(
        input.blackboxBin,
        ['observations', '--session', input.sessionId, '--trace', input.traceId, '--json'],
        { maxBuffer: 16 * 1024 * 1024 },
      );
      await writeFile(input.traceFile, result.stdout);
      const trace = JSON.parse(result.stdout);
      const proof = validateHttpTrace(execution, activity, trace);
      return proof;
    } catch (error) {
      lastDiagnostic = diagnostic(error);
      await writeFile(input.diagnosticFile, `${lastDiagnostic}\n`);
    }
    if (attempt < httpTraceAttempts) {
      await delay(httpTraceIntervalMs);
    }
  }
  throw new Error(
    `HTTP telemetry proof did not become complete within ${
      (httpTraceAttempts * httpTraceIntervalMs) / 1000
    } seconds. Last diagnostic: ${lastDiagnostic}`,
  );
}

async function traceDocuments(directory) {
  const documents = [];
  for (const name of (await readdir(directory)).filter((entry) => entry.endsWith('.json')).sort()) {
    documents.push(JSON.parse(await readFile(join(directory, name), 'utf8')));
  }
  return documents;
}

async function validateSharedState(execution, observation, session, directory, proofId) {
  const activity = assertActivityRoot({ execution, observation });
  assert.equal(
    activity.retained.length,
    1,
    'shared-state activity trace must contain only its root',
  );
  assert.equal(session.kind, 'collector-session-found');
  assert.ok(
    session.traceIds.includes(activity.traceId),
    'session must retain the activity root trace',
  );
  const expectedPath = `/fixture/shared-state-proof/${encodeURIComponent(proofId)}`;
  const candidates = [];
  for (const document of await traceDocuments(directory)) {
    if (document.kind !== 'collector-trace-found' || document.traceId === activity.traceId) {
      continue;
    }
    const retained = spans(document);
    const services = new Set(
      retained.filter((span) => hasHttpPath(span, expectedPath)).map((span) => span.service),
    );
    if (services.has('public-api') && services.has('redis-proof-consumer')) {
      candidates.push({ document, retained, services });
    }
  }
  assert.equal(candidates.length, 1, 'one separate consumer -> public-api proof trace must exist');
  const candidate = candidates[0];
  assert.ok(session.traceIds.includes(candidate.document.traceId));
  assert.notEqual(candidate.document.traceId, activity.traceId);
  return {
    kind: 'shared-state-session-observation-proof',
    stimulusActivityId: execution.activityId,
    stimulusTraceId: activity.traceId,
    downstreamTraceId: candidate.document.traceId,
    downstreamPath: expectedPath,
    association: { kind: 'session-only' },
    services: [...candidate.services].sort(),
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), 'utf8'));
}

const [operation, ...arguments_] = process.argv.slice(2);
let proof;
if (operation === 'http' && arguments_.length === 3) {
  proof = validateHttpTrace(
    await readJson(arguments_[0]),
    await readJson(arguments_[1]),
    await readJson(arguments_[2]),
  );
} else if (operation === 'http-until' && arguments_.length === 7) {
  proof = await pollHttpTrace({
    blackboxBin: resolve(arguments_[0]),
    sessionId: arguments_[1],
    traceId: arguments_[2],
    executionFile: arguments_[3],
    activityFile: arguments_[4],
    traceFile: resolve(arguments_[5]),
    diagnosticFile: resolve(arguments_[6]),
  });
} else if (operation === 'shared-state' && arguments_.length === 5) {
  proof = await validateSharedState(
    await readJson(arguments_[0]),
    await readJson(arguments_[1]),
    await readJson(arguments_[2]),
    resolve(arguments_[3]),
    arguments_[4],
  );
} else {
  throw new Error(
    'Usage: capsule-telemetry-proof.mjs <http execution activity trace|http-until blackbox-bin session-id trace-id execution activity trace-output diagnostic-output|shared-state execution activity session trace-directory proof-id>',
  );
}
process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
