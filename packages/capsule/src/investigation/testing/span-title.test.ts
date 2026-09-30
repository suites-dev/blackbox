import { describe, expect, it } from 'vitest';

import { spanResult, spanTitle } from '../span-title.js';
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
    [{ 'http.method': 'GET', 'http.target': '/orders/7?token=secret#frag' }, 'GET /orders/7'],
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
