#!/usr/bin/env node
// Maintainer tool: turn one retained Capsule session into a golden fixture, or
// regenerate a fixture's expected EffectSet on explicit request. It runs on the
// built packages (`pnpm build` first) and is not part of the published files.
//
//   FIXTURE_CONTROL_TOKEN=<token used by the run> node scripts/capture-fixture.mjs capture \
//     --project <e2e dir> --session <id> --out <fixture dir> [--write-expected]
//   node scripts/capture-fixture.mjs expected --case <fixture dir>
//
// Expected output is written only when asked. Never regenerate it to make a
// failing test pass: review the diff line by line instead.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { readCollectorFragments } from '@suites/blackbox-otel-collector-internal';

import { normalizeEffects, serializeEffectSet } from '../dist/index.js';

// Resource attributes that identify the capturing machine or process and never
// affect classification. Matched by exact key or by `<prefix>.` for prefixes.
const DROPPED_RESOURCE_PREFIXES = ['host', 'os'];
const DROPPED_RESOURCE_KEYS = ['container.id', 'process.command_args', 'process.executable.path'];

function fail(message) {
  console.error(`capture-fixture: ${message}`);
  process.exit(1);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function dropped(key) {
  return (
    DROPPED_RESOURCE_KEYS.includes(key) ||
    DROPPED_RESOURCE_PREFIXES.some((prefix) => key.startsWith(`${prefix}.`))
  );
}

function scrubRequest(request) {
  for (const resourceSpan of request.resourceSpans ?? []) {
    const resource = resourceSpan.resource;
    if (resource !== undefined && Array.isArray(resource.attributes)) {
      resource.attributes = resource.attributes.filter(({ key }) => !dropped(key));
    }
  }
  return request;
}

// Containers along this path are expanded one entry per line; everything below
// (resources, scopes, spans) stays on one line, so a fixture diff shows whole
// spans and stays reviewable.
const EXPANDED = new Set([
  '',
  'sources',
  'fragments',
  'request',
  'resourceSpans',
  'scopeSpans',
  'spans',
]);

function formatStored(value, key = '', indent = '') {
  if (value === null || typeof value !== 'object' || !EXPANDED.has(key)) {
    return JSON.stringify(value);
  }
  const inner = `${indent}  `;
  const itemKey = { sources: '', fragments: '', resourceSpans: '', scopeSpans: '', spans: 'span' };
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }
    const items = value.map((item) => `${inner}${formatStored(item, itemKey[key], inner)}`);
    return `[\n${items.join(',\n')}\n${indent}]`;
  }
  const entries = Object.entries(value).map(
    ([name, item]) => `${inner}${JSON.stringify(name)}: ${formatStored(item, name, inner)}`,
  );
  return `{\n${entries.join(',\n')}\n${indent}}`;
}

/** The reviewable rendering of canonical EffectSet bytes stored as the golden. */
function renderGolden(canonical) {
  return `${JSON.stringify(JSON.parse(canonical), null, 2)}\n`;
}

function storedToInput(stored) {
  return {
    scope: stored.scope,
    sources: stored.sources.map((source) => ({
      kind: source.kind,
      fragments: source.fragments.map(({ sequence, request }) => ({
        sequence,
        rawJson: JSON.stringify(request),
      })),
    })),
  };
}

/** Fail closed when anything that looks like a credential reaches fixture text. */
function assertNoSecrets(label, text, token) {
  const findings = [];
  if (token !== null && text.includes(token)) {
    findings.push('the FIXTURE_CONTROL_TOKEN value');
  }
  if (/bearer\s/iu.test(text)) {
    findings.push('a Bearer credential');
  }
  if (/authorization/iu.test(text)) {
    findings.push('an authorization header or attribute');
  }
  if (findings.length > 0) {
    fail(`${label} contains ${findings.join(', ')}; refusing to write it.`);
  }
}

function captureContext({ session, activities, lifecycle }) {
  return {
    note: 'Retained facts of the captured run, kept for later linkage and capture-status fixtures. Allow-listed fields only.',
    session: { state: session.state },
    activities: activities.map((activity) => ({
      activityId: activity.activityId,
      sequence: activity.sequence,
      name: activity.name.kind === 'provided' ? activity.name.value : null,
      purpose: activity.purpose,
      target: activity.target.kind === 'driver' ? `driver:${activity.target.driverId}` : 'host',
      kind: activity.kind,
      traceId: activity.telemetry.context.traceId,
      propagation: activity.outcome?.propagation?.outcome?.kind ?? null,
    })),
    collector: {
      runs: lifecycle.runs.map((run) => ({
        receiver: run.receiver,
        shutdown: run.shutdown,
        failure: run.failure,
        activations:
          run.instrumentation.kind === 'activated'
            ? run.instrumentation.activations.map(({ serviceName, runtime }) => ({
                serviceName,
                runtime,
              }))
            : [],
      })),
      telemetry: {
        acceptedRequests: lifecycle.telemetry.acceptedRequests ?? null,
        acceptedSpans: lifecycle.telemetry.acceptedSpans ?? null,
      },
    },
  };
}

function writeExpected(directory, stored, token) {
  const text = renderGolden(serializeEffectSet(normalizeEffects(storedToInput(stored))));
  assertNoSecrets('expected.effectset.json', text, token);
  writeFileSync(join(directory, 'expected.effectset.json'), text, 'utf8');
  console.log(`wrote ${join(directory, 'expected.effectset.json')} (${text.length} bytes)`);
}

async function capture(values) {
  const token = process.env.FIXTURE_CONTROL_TOKEN;
  if (token === undefined || token.length === 0) {
    fail('set FIXTURE_CONTROL_TOKEN to the token the captured run used so leaks can be detected.');
  }
  const project = resolve(values.project);
  const sessionId = values.session;
  const experiment = join(project, '.blackbox', 'experiments', `capsule-${sessionId}`);
  const session = readJson(join(experiment, 'session.json'));
  const executionId = session.executionId;
  // Mirrors capsule's collectorIdentity(): sandbox/<executionId>.compose/collector.
  const storageDirectory = join(experiment, 'sandbox', `${executionId}.compose`, 'collector');
  if (!existsSync(storageDirectory)) {
    fail(`no collector storage at ${storageDirectory}`);
  }
  const result = await readCollectorFragments({ storageDirectory, sessionId, executionId });
  if (result.kind !== 'collector-fragments-found') {
    fail(`collector fragments are ${result.kind}: ${JSON.stringify(result)}`);
  }
  const stored = {
    scope: { kind: 'capsule-session', sessionId },
    sources: [
      {
        kind: 'otlp-json-fragments',
        fragments: result.fragments.map(({ sequence, rawJson }) => ({
          sequence,
          request: scrubRequest(JSON.parse(rawJson)),
        })),
      },
    ],
  };
  const context = captureContext({
    session,
    activities: readJson(join(experiment, 'activities.json')),
    lifecycle: result.lifecycle,
  });
  const inputText = `${formatStored(stored)}\n`;
  const contextText = `${JSON.stringify(context, null, 2)}\n`;
  assertNoSecrets('input.json', inputText, token);
  assertNoSecrets('capture-context.json', contextText, token);
  const out = resolve(values.out);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'input.json'), inputText, 'utf8');
  writeFileSync(join(out, 'capture-context.json'), contextText, 'utf8');
  console.log(
    `wrote ${out}/input.json (${result.fragments.length} fragments) and capture-context.json`,
  );
  if (values['write-expected']) {
    writeExpected(out, stored, token);
  }
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    project: { type: 'string' },
    session: { type: 'string' },
    out: { type: 'string' },
    case: { type: 'string' },
    'write-expected': { type: 'boolean', default: false },
  },
});

switch (positionals[0]) {
  case 'capture':
    if (values.project === undefined || values.session === undefined || values.out === undefined) {
      fail('capture needs --project, --session, and --out.');
    }
    await capture(values);
    break;
  case 'expected': {
    if (values.case === undefined) {
      fail('expected needs --case <fixture dir>.');
    }
    const directory = resolve(values.case);
    const stored = readJson(join(directory, 'input.json'));
    assertNoSecrets(
      'input.json',
      JSON.stringify(stored),
      process.env.FIXTURE_CONTROL_TOKEN ?? null,
    );
    writeExpected(directory, stored, process.env.FIXTURE_CONTROL_TOKEN ?? null);
    break;
  }
  default:
    fail('usage: capture-fixture.mjs capture|expected [options]');
}
