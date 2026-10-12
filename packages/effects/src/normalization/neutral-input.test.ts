import { expect, test } from 'vitest';

import { compileEffectContract, evaluateEffects, projectEffects } from '../index.js';
import { attribute, payload, span } from './test-fixtures/otlp.js';

test.each([
  ['db', 'db.system', 'postgresql', 'INSERT'],
  ['db', 'db.system.name', 'postgresql', 'INSERT'],
  ['cache', 'db.system.name', 'redis', 'SET'],
  ['message', 'messaging.system', 'rabbitmq', 'send'],
] as const)(
  'recognizes %s activity from %s without inventing its operation',
  (kind, key, system, operation) => {
    const input = payload([
      span(1, {
        name: operation,
        kind: 4,
        attributes: [
          attribute(key, system),
          attribute('db.statement', 'INSERT INTO orders VALUES (1)'),
        ],
      }),
    ]);
    const before = JSON.stringify(input);
    const graph = projectEffects({ format: 'otlp-json', scopeId: 'neutral', payloads: [input] });
    expect(graph.effects[0]).toMatchObject({ kind, operation: 'unknown', target: 'unknown' });
    const activity = compileEffectContract((e) => [e.exists(e[kind]({}))]);
    expect(evaluateEffects(graph, activity).status).toBe('pass');
    for (const count of ['exists', 'absent'] as const) {
      const specific = compileEffectContract((e) => [e[count](e[kind]({ operation }))]);
      expect(evaluateEffects(graph, specific)).toMatchObject({
        status: 'inconclusive',
        findings: [{ evidence: [] }],
      });
    }
    expect(JSON.stringify(input)).toBe(before);
  },
);

test.each(['db.system.name', 'messaging.system'])(
  'ignores empty %s and rejects malformed system evidence',
  (key) => {
    const project = (value: unknown) =>
      projectEffects({
        format: 'otlp-json',
        scopeId: 'neutral',
        payloads: [payload([span(1, { attributes: [{ key, value }] })])],
      });
    expect(project({ stringValue: '' }).effects[0].kind).toBe('unknown');
    expect(() => project({ intValue: 1 })).toThrow('Semantic attribute');
  },
);
