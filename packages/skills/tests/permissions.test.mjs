import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorize } from '../dist/src/index.js';

const grant = {
  id: 'grant', kind: 'approved', action: 'read-repository', scope: 'example/repo',
  requestedAt: '2026-01-01T10:00:00Z', approvedBy: 'owner', expiresAt: '2026-01-01T12:00:00Z',
};
const request = { action: 'read-repository', scope: 'example/repo', now: '2026-01-01T11:00:00Z' };

test('accepts an exact, current permission supplied by the caller', () => {
  assert.deepEqual(authorize({ ...request, approvals: [grant] }), { kind: 'approved', approvalId: 'grant' });
});

for (const [name, patch] of [
  ['different scope', { scope: 'example/other' }],
  ['different action', { action: 'execute-code' }],
  ['expiry', { now: '2026-01-01T12:00:00Z' }],
  ['future grant', { now: '2026-01-01T09:00:00Z' }],
  ['invalid clock', { now: 'not-a-date' }],
]) {
  test(`blocks ${name}`, () => {
    assert.equal(authorize({ ...request, ...patch, approvals: [grant] }).kind, 'blocked');
  });
}

test('a newer denial revokes a previous approval', () => {
  const denied = { id: 'denied', kind: 'denied', action: grant.action, scope: grant.scope,
    requestedAt: '2026-01-01T10:30:00Z', reason: 'revoked' };
  assert.equal(authorize({ ...request, approvals: [grant, denied] }).kind, 'blocked');
});

test('pending and absent permission cannot authorize execution', () => {
  const pending = { id: 'pending', kind: 'pending', action: grant.action, scope: grant.scope,
    requestedAt: grant.requestedAt, reason: 'awaiting user' };
  assert.equal(authorize({ ...request, approvals: [pending] }).kind, 'blocked');
  assert.equal(authorize({ ...request, approvals: [] }).kind, 'blocked');
});

test('equivalent timestamps with different offsets are an ambiguous grant', () => {
  const sameTime = { ...grant, id: 'other', requestedAt: '2026-01-01T12:00:00+02:00' };
  assert.equal(authorize({ ...request, approvals: [grant, sameTime] }).kind, 'blocked');
});
