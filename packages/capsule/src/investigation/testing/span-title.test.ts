import { describe, expect, it } from 'vitest';

import { spanResult, spanTitle } from '../span-title.js';
import { projectInvestigationSpans } from '../spans.js';
import { span } from './span.fixture.js';

/** Titles a span with these attributes; an undefined value means the attribute is absent. */
function titled(
  attributes: Readonly<Record<string, string | number | undefined>>,
  name = 'span-name',
): string {
  const present = Object.fromEntries(
    Object.entries(attributes).flatMap(([key, value]) =>
      value === undefined ? [] : [[key, value]],
    ),
  ) as Record<string, string | number>;
  return spanTitle(span({ id: 'a', name, attributes: present }));
}

describe('spanTitle', () => {
  it.each([
    [{ 'http.request.method': 'POST', 'http.route': '/subscriptions' }, 'POST /subscriptions'],
    [{ 'http.method': 'GET', 'url.path': '/health' }, 'GET /health'],
    [{ 'http.method': 'GET', 'http.target': '/orders/7?token=secret#frag' }, 'GET /orders/{…}'],
    // Raw paths keep plain words and short versions; every other segment is redacted.
    [
      { 'http.method': 'POST', 'url.path': '/password-reset/Zq8vT3mKp1XwR7aB' },
      'POST /password-reset/{…}',
    ],
    [{ 'http.method': 'POST', 'url.path': '/v1/payment_intents' }, 'POST /v1/payment_intents'],
    // An all-lowercase token is not a plain word: long letter runs are redacted.
    [
      { 'http.method': 'POST', 'url.path': '/password-reset/abcdefghijklmnopqrstuvwxyz' },
      'POST /password-reset/{…}',
    ],
    [{ 'http.method': 'GET', 'url.path': '/invite/qwertyuiopasdfghj' }, 'GET /invite/{…}'],
    [{ 'http.method': 'POST', 'url.path': '/subscriptions' }, 'POST /subscriptions'],
    [
      { 'http.method': 'POST', 'url.path': '/fixture/shared-state-proof/proof-journey' },
      'POST /fixture/shared-state-proof/proof-journey',
    ],
    [
      { 'http.method': 'GET', 'url.path': '/users/3f9a2c41-7b00-4000-8000-00000000000a/keys' },
      'GET /users/{…}/keys',
    ],
    [{ 'http.method': 'GET', 'url.path': '/files/a%2Fb/Token.txt' }, 'GET /files/{…}/{…}'],
    // The server's route template is kept as is: it names parameters, not values.
    [{ 'http.method': 'GET', 'http.route': '/users/:id/keys' }, 'GET /users/:id/keys'],
    [
      { 'http.request.method': 'PUT', 'http.method': 'GET', 'http.route': '/r', 'url.path': '/p' },
      'PUT /r',
    ],
    [{ 'url.path': '/p', 'http.target': '/t' }, '/p'],
    [{ 'http.request.method': 'DELETE' }, 'DELETE'],
    [
      { 'db.operation.name': 'SELECT', 'db.collection.name': 'subscriptions' },
      'SELECT subscriptions',
    ],
    [{ 'db.operation': 'INSERT', 'db.sql.table': 'orders' }, 'INSERT orders'],
    [
      {
        'db.operation.name': 'SELECT',
        'db.operation': 'x',
        'db.collection.name': 'a',
        'db.sql.table': 'b',
      },
      'SELECT a',
    ],
    [{ 'db.sql.table': 'orders' }, 'orders'],
    [
      { 'messaging.operation.type': 'process', 'messaging.destination.name': 'jobs' },
      'process jobs',
    ],
    [{ 'messaging.operation': 'receive', 'messaging.destination.name': 'jobs' }, 'receive jobs'],
    [{ 'messaging.destination.name': 'jobs' }, 'jobs'],
  ])('titles %j as %s', (attributes, expected) => {
    expect(titled(attributes)).toBe(expected);
  });

  it('falls back to the span name when no title part is present', () => {
    expect(titled({ 'db.system': 'postgresql', 'http.status_code': 200 }, 'pg.connect')).toBe(
      'pg.connect',
    );
    expect(titled({ 'http.method': '' }, 'handler')).toBe('handler');
  });

  it('never prints undefined or null for a missing part', () => {
    const partial = [
      { 'http.method': 'GET' },
      { 'http.route': '/x' },
      { 'db.operation': 'SELECT' },
      { 'messaging.operation': 'send' },
      {},
    ] satisfies readonly Record<string, string>[];
    for (const attributes of partial) {
      expect(titled(attributes)).not.toMatch(/undefined|null/u);
    }
  });
});

describe('spanResult', () => {
  it.each([
    [{ 'http.response.status_code': 201 }, null, '201'],
    [{ 'http.status_code': 404 }, null, '404'],
    [{ 'http.response.status_code': 500, 'http.status_code': 200 }, 2, '500'],
    [{}, 2, 'error'],
    [{}, 1, ''],
    [{}, null, ''],
  ])('reads %j with status %s as %j', (attributes, statusCode, expected) => {
    expect(spanResult(span({ id: 'a', attributes, statusCode }))).toBe(expected);
  });
});

describe('projectInvestigationSpans', () => {
  it('keeps the system attributes that classify client spans, and nothing unlisted', () => {
    const value = (stringValue: string) => ({ stringValue });
    const [projected] = projectInvestigationSpans({
      traceId: 't1',
      fragments: [
        {
          sequence: 1,
          receivedAt: '2026-01-01T00:00:00.000Z',
          request: {
            resourceSpans: [
              {
                resource: { attributes: [{ key: 'service.name', value: value('api') }] },
                scopeSpans: [
                  {
                    spans: [
                      {
                        traceId: 't1',
                        spanId: 's1',
                        kind: 3,
                        name: 'grpc call',
                        attributes: [
                          { key: 'rpc.system', value: value('grpc') },
                          { key: 'db.system', value: value('postgresql') },
                          { key: 'db.system.name', value: value('postgresql') },
                          { key: 'messaging.system', value: value('kafka') },
                          { key: 'enduser.id', value: value('alice') },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ],
    });
    expect(projected.attributes.map((attribute) => attribute.key).sort()).toEqual([
      'db.system',
      'db.system.name',
      'messaging.system',
      'rpc.system',
    ]);
  });
});
