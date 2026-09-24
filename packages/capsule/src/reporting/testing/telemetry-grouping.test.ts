import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

import { capsuleTelemetryGroupingScript } from '../html/shell/telemetry-grouping.js';
import { capsuleTelemetryPresentationScript } from '../html/shell/telemetry-presentation.js';

describe('telemetry resource grouping', () => {
  it('keeps HTTP visible and groups only consecutive resource operations', () => {
    const context = { output: null };
    const spans = [
      {
        operation: 'POST',
        service: 'public-api',
        attributes: [
          { key: 'http.request.method', value: 'POST' },
          { key: 'url.path', value: '/subscriptions' },
        ],
      },
      {
        operation: 'redis.SET',
        service: 'public-api',
        attributes: [{ key: 'server.address', value: 'redis' }],
      },
      {
        operation: 'redis.GET',
        service: 'public-api',
        attributes: [{ key: 'server.address', value: 'redis' }],
      },
      {
        operation: 'GET',
        service: 'public-api',
        attributes: [{ key: 'http.request.method', value: 'GET' }],
      },
      {
        operation: 'redis.DEL',
        service: 'public-api',
        attributes: [{ key: 'server.address', value: 'redis' }],
      },
    ];
    const script = [
      capsuleTelemetryPresentationScript,
      capsuleTelemetryGroupingScript,
      `output = telemetryRuns(${JSON.stringify(spans)});`,
    ].join('\n');

    new Script(script).runInNewContext(context);

    expect(context.output).toEqual([
      { kind: 'span', span: spans[0] },
      {
        kind: 'resource-run',
        key: 'public-api → redis',
        label: 'redis',
        direction: 'public-api → redis',
        spans: [spans[1], spans[2]],
      },
      { kind: 'span', span: spans[3] },
      {
        kind: 'resource-run',
        key: 'public-api → redis',
        label: 'redis',
        direction: 'public-api → redis',
        spans: [spans[4]],
      },
    ]);
  });
});
