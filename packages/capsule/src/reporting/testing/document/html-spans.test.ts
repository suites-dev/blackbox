import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

import { capsuleInspectorDetailScript } from '../../html/shell/inspector-detail.js';
import { capsuleTelemetryOrderScript } from '../../html/shell/telemetry-order.js';
import { capsuleTelemetryPresentationScript } from '../../html/shell/telemetry-presentation.js';
import { capsuleTelemetryRowsScript } from '../../html/shell/telemetry-rows.js';

function evaluate(script: string, expression: string): unknown {
  const context = { output: null as unknown };
  new Script(`${script}\noutput = ${expression};`).runInNewContext(context);
  return JSON.parse(JSON.stringify(context.output)) as unknown;
}

const ms = (value: number) =>
  String(1_791_011_634_000_000_000n + BigInt(Math.round(value * 1_000_000)));
const span = (spanId: string, parentSpanId: string | null, start: number, end: number) => ({
  spanId,
  parentSpanId,
  startTimeUnixNano: ms(start),
  endTimeUnixNano: ms(end),
  attributes: [],
});

describe('HTML span lists keep structure and time (#111)', () => {
  // As the collector returns them: children before their root, siblings out of order.
  const spans = [
    span('find-2', 'repo-2', 120, 121),
    span('repo-1', 'server', 10, 28),
    span('find-1', 'repo-1', 12, 14.12),
    span('server', 'driver', 9, 231),
    span('repo-2', 'server', 118, 122),
    span('driver', null, 0, 236),
  ];

  it('lists each parent before its children, siblings by start, with depth', () => {
    expect(
      evaluate(
        capsuleTelemetryOrderScript,
        `spanTreeOrder(${JSON.stringify(spans)}).map((item) => [item.span.spanId, item.depth])`,
      ),
    ).toEqual([
      ['driver', 0],
      ['server', 1],
      ['repo-1', 2],
      ['find-1', 3],
      ['repo-2', 2],
      ['find-2', 3],
    ]);
  });

  it('keeps spans in a parent cycle instead of dropping them', () => {
    const cycle = [span('a', 'b', 0, 1), span('b', 'a', 1, 2)];
    expect(
      evaluate(
        capsuleTelemetryOrderScript,
        `spanTreeOrder(${JSON.stringify(cycle)}).map((item) => item.span.spanId)`,
      ),
    ).toEqual(['a', 'b']);
  });

  it('shows each span offset from the trace start and its duration', () => {
    const data = JSON.stringify(spans);
    const timing = (index: number) =>
      evaluate(
        capsuleTelemetryOrderScript,
        `spanTimingText(${data}[${String(index)}], traceOrigin(${data}))`,
      );
    expect(timing(5)).toBe('+0.00 ms · 236.0 ms');
    expect(timing(2)).toBe('+12.0 ms · 2.1 ms');
  });
});

describe('inspector labels (#111)', () => {
  it('reads a missing status as UNSET and shows start time and duration', () => {
    const data = JSON.stringify(span('driver', null, 0, 236));
    expect(evaluate(capsuleInspectorDetailScript, 'spanStatusText(null)')).toBe('UNSET');
    expect(evaluate(capsuleInspectorDetailScript, 'spanStatusText(2)')).toBe('ERROR (2)');
    expect(evaluate(capsuleInspectorDetailScript, `spanStartText(${data})`)).toBe(
      '2026-10-03T07:13:54.000Z',
    );
    expect(evaluate(capsuleInspectorDetailScript, `spanDurationText(${data})`)).toBe('236.0 ms');
  });
});

describe('readiness probes (#111)', () => {
  it('recognises traces whose spans carry the readiness user agent', () => {
    const script = `${capsuleTelemetryPresentationScript}\n${capsuleTelemetryRowsScript}`;
    const trace = (agent: string) =>
      JSON.stringify({
        kind: 'available',
        spans: [
          { ...span('s', null, 0, 1), attributes: [{ key: 'user_agent.original', value: agent }] },
        ],
      });
    expect(evaluate(script, `isReadinessProbe(${trace('blackbox-readiness/1')})`)).toBe(true);
    expect(evaluate(script, `isReadinessProbe(${trace('curl/8.5.0')})`)).toBe(false);
  });
});
