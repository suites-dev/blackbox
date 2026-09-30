#!/usr/bin/env node
// Turns a real e2e recording into a stable, sanitized show fixture.
//
//   node sanitize-recording.mjs > recorded-capsule.json
//
// It reads the fixed recording directory `.blackbox/tmp/show-recording/` at the
// repository root (ignored by git), which holds, from one capsule after
// `blackbox capsule down`:
// session.json (`blackbox capsule show <capsule> --json`), record.json and
// activities.json (the capsule's own files) and trace-<id>.json
// (`blackbox capsule show <trace> --session <capsule> --json` per retained trace).
//
// Sanitizing keeps structure and relative timing exactly and replaces every
// identifier: the capsule becomes calm-comet-ada-000000000001, activity, trace
// and span IDs become sequential stand-ins, every time is shifted so the
// capsule starts at 2026-01-01T00:00:00Z, and each activity's argv, output and
// execution details are dropped (they can hold credentials). Spans are stored
// as the CLI projects them (projectInvestigationSpans), so attributes are
// already bounded and redacted.
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { projectInvestigationSpans } from '@suites/blackbox-capsule';

// A fixed location, never a path from the command line or the environment.
const directory = new URL('../../../../../../../../.blackbox/tmp/show-recording/', import.meta.url);
const TRACE_FILE = /^trace-[0-9a-f]{32}\.json$/u;
const read = async (name) => JSON.parse(await readFile(new URL(name, directory), 'utf8'));
const record = await read('record.json');
const session = await read('session.json');
const activities = await read('activities.json');
const BASE_MS = Date.parse('2026-01-01T00:00:00.000Z');
const shiftMs = BASE_MS - Date.parse(record.admittedAt);
const shiftIso = (iso) => new Date(Date.parse(iso) + shiftMs).toISOString();
const shiftNano = (nano) =>
  nano === null ? null : String(BigInt(nano) + BigInt(shiftMs) * 1_000_000n);

const ids = new Map();
const stand = (kind, id, width) => {
  const key = `${kind}:${id}`;
  if (!ids.has(key)) {
    const n = [...ids.keys()].filter((k) => k.startsWith(`${kind}:`)).length + 1;
    // The number sits right after the kind letter, so even an 8-hex short form is unique.
    const letter = { trace: 'e', span: 'd', activity: 'c' }[kind];
    ids.set(key, `${letter}${String(n).padStart(7, '0')}`.padEnd(width, '0'));
  }
  return ids.get(key);
};
const hexStand = stand;
const trace = (id) => hexStand('trace', id, 32);
const span = (id) => (id === null ? null : hexStand('span', id, 16));
const activityId = (id) => {
  const hex = hexStand('activity', id, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
};

function outcomeShape(outcome) {
  const propagation = 'propagation' in outcome ? { propagation: outcome.propagation } : {};
  const process = outcome.kind === 'driver-completed' ? outcome.process : outcome;
  const kept = {
    kind: process.kind,
    argv: ['<argv removed>'],
    location: process.location,
    ...(process.kind === 'exited' ? { exitCode: process.exitCode } : {}),
    ...(process.kind === 'signaled' ? { signal: process.signal } : {}),
    ...('remediation' in process ? { remediation: '<removed>' } : {}),
    ...(process.kind === 'exited' || process.kind === 'signaled'
      ? {
          stdout: '',
          stderr: '',
          retention: {
            stdout: { kind: 'complete', originalBytes: 0 },
            stderr: { kind: 'complete', originalBytes: 0 },
          },
        }
      : {}),
  };
  return outcome.kind === 'driver-completed'
    ? { ...outcome, process: kept, redaction: outcome.redaction }
    : { ...kept, ...propagation };
}

const sanitizedActivities = activities.map((activity) => ({
  ...activity,
  activityId: activityId(activity.activityId),
  argv: ['<argv removed>'],
  startedAt: shiftIso(activity.startedAt),
  ...('completedAt' in activity ? { completedAt: shiftIso(activity.completedAt) } : {}),
  ...('outcome' in activity ? { outcome: outcomeShape(activity.outcome) } : {}),
  telemetry: {
    ...activity.telemetry,
    executionId: activityId(activity.activityId),
    operationName: 'capsule.activity',
    startedAt: shiftIso(activity.telemetry.startedAt),
    ...('endedAt' in activity.telemetry ? { endedAt: shiftIso(activity.telemetry.endedAt) } : {}),
    context: {
      ...activity.telemetry.context,
      traceId: trace(activity.telemetry.context.traceId),
      spanId: span(activity.telemetry.context.spanId),
      traceparent: `00-${trace(activity.telemetry.context.traceId)}-${span(activity.telemetry.context.spanId)}-01`,
    },
  },
}));

const traces = [];
for (const file of (await readdir(fileURLToPath(directory)))
  .filter((name) => TRACE_FILE.test(name))
  .sort()) {
  const document = await read(file);
  const spans = projectInvestigationSpans({
    fragments: document.fragments,
    traceId: document.traceId,
  }).map((projected) => ({
    ...projected,
    traceId: trace(projected.traceId),
    spanId: span(projected.spanId),
    parentSpanId: span(projected.parentSpanId),
    startTimeUnixNano: shiftNano(projected.startTimeUnixNano),
    endTimeUnixNano: shiftNano(projected.endTimeUnixNano),
    links: [],
  }));
  traces.push({ traceId: trace(document.traceId), spans });
}

const lifecycle = session.kind === 'collector-session-found' ? session.lifecycle : null;
process.stdout.write(
  `${JSON.stringify(
    {
      capsule: {
        capsule: 'calm-comet-ada-000000000001',
        system: record.system,
        title: record.title,
        state: record.state,
        startedAt: shiftIso(record.admittedAt),
      },
      lifecycle:
        lifecycle === null
          ? null
          : {
              ...lifecycle,
              sessionId: 'calm-comet-ada-000000000001',
              executionId: '00000000-0000-4000-8000-000000000001',
              runs: lifecycle.runs.map((run, index) => ({
                ...run,
                instanceId: `00000000-0000-4000-8000-00000000010${String(index)}`,
                startedAt: shiftIso(run.startedAt),
                updatedAt: shiftIso(run.updatedAt),
                stoppedAt: run.stoppedAt === null ? null : shiftIso(run.stoppedAt),
                instrumentation:
                  run.instrumentation.kind === 'activated'
                    ? {
                        ...run.instrumentation,
                        activations: run.instrumentation.activations.map((activation) => ({
                          ...activation,
                          activatedAt: shiftIso(activation.activatedAt),
                        })),
                      }
                    : run.instrumentation,
              })),
              telemetry:
                lifecycle.telemetry.status === 'received'
                  ? {
                      ...lifecycle.telemetry,
                      lastReceivedAt: shiftIso(lifecycle.telemetry.lastReceivedAt),
                    }
                  : lifecycle.telemetry,
            },
      activities: sanitizedActivities,
      traces: traces.sort((a, b) => (a.traceId < b.traceId ? -1 : 1)),
    },
    null,
    2,
  )}\n`,
);
