import { describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';

import { capsuleProgressSchema } from '../progress/schema.js';
import {
  capsuleActivitiesSchema,
  capsuleOperationalReportSchema,
  capsuleSessionSchema,
} from './artifact-schemas.js';
import { report } from './report.fixture.js';

const ajv = new Ajv2020({ strict: true, allErrors: true });
ajv.addSchema(capsuleProgressSchema);
ajv.addSchema(capsuleSessionSchema);
ajv.addSchema(capsuleActivitiesSchema);
const validateReport = ajv.compile(capsuleOperationalReportSchema);

describe('Capsule operational report schema: causality additions', () => {
  const causal = {
    status: 'incomplete',
    reason: 'collector interrupted',
    activityCausality: [
      {
        activityId: 'activity-2',
        evidence: 'response',
        context: { kind: 'sent', carrier: 'http-headers' },
        causedTraces: [
          {
            traceId: 'trace-1',
            spanCount: 2,
            services: ['orders-api'],
            tree: [
              {
                spanId: 'span-1',
                service: 'orders-api',
                kind: 'server',
                title: 'POST /orders',
                result: '201',
                failure: null,
                orphan: 'not-retained',
                children: [
                  {
                    spanId: 'span-2',
                    service: 'orders-api',
                    kind: 'client',
                    title: 'insert orders',
                    result: '',
                    failure: null,
                    orphan: null,
                    children: [],
                  },
                ],
              },
            ],
          },
        ],
        limitations: [{ kind: 'orphan-span', spanId: 'span-1', trace: 'trace-1' }],
      },
    ],
    uncaused: [
      { trace: 'trace-2', placedAfter: 'activity-2', rootService: 'worker', rootTitle: 'consume' },
    ],
    limitations: [
      { kind: 'observation-incomplete', reason: 'collector interrupted' },
      { kind: 'causality-unknown', trace: 'trace-2' },
    ],
  };

  it('reads a report written without the causal fields', () => {
    for (const key of ['status', 'reason', 'activityCausality', 'uncaused', 'limitations']) {
      expect(Object.keys(report())).not.toContain(key);
    }
    expect(validateReport(report())).toBe(true);
  });

  it('validates the causal fields and still reads the temporal association', () => {
    expect(validateReport({ ...report(), ...causal })).toBe(true);
    const current = report();
    expect(JSON.stringify(current.observations)).toContain('"association"');
  });

  it('rejects a causal field of the wrong shape', () => {
    for (const invalid of [
      { ...causal, status: 'verified' },
      { ...causal, limitations: [{ kind: 'effect' }] },
      { ...causal, uncaused: [{ trace: 'trace-2' }] },
      { ...causal, activityCausality: [{ ...causal.activityCausality[0], evidence: 'effect' }] },
    ]) {
      expect(validateReport({ ...report(), ...invalid })).toBe(false);
    }
  });
});
