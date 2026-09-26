import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { activeTelemetry, retainedRecord } from '../../persistence/testing/record.fixture.js';
import { admitCapsuleRecord, readCapsuleActivities, readCapsuleRecord, writeCapsuleActivities } from '../../records.js';
import { reconcileDeadCapsuleManager } from './index.js';

it.each(['admitted', 'manager-starting', 'sandbox-starting', 'running', 'stopping', 'stop-failed'] as const)(
  'reconciles an exact exited manager PID in %s and proves no Sandbox cleanup is required', async (state) => {
    const projectDirectory = await mkdtemp(join(tmpdir(), 'capsule-dead-process-'));
    const child = spawn(process.execPath, ['-e', 'process.exit(0)']);
    await once(child, 'exit');
    const pid = child.pid;
    if (pid === undefined) {
      throw new Error('Manager test process did not receive a PID');
    }
    try {
      const record = { ...retainedRecord(projectDirectory), state, manager: { kind: 'started' as const, pid },
        entrypoint: { kind: 'available' as const, value: {
          url: 'http://localhost:4321', host: 'localhost', port: 4321, protocol: 'http',
        } },
        composeProject: { kind: 'available' as const, value: 'owned' },
        readiness: { kind: 'available' as const, value: {
          url: 'http://localhost:4321/health', status: 'ready' as const, durationMs: 1,
        } },
        cleanup: state === 'stop-failed'
          ? { kind: 'failed' as const, error: { name: 'CleanupError', message: 'owned resource remains' } }
          : { kind: 'not-attempted' as const },
      };
      const selector = { projectDirectory, sessionId: record.sessionId };
      await admitCapsuleRecord({ projectDirectory, record });
      await writeCapsuleActivities({ ...selector, activities: [{
        kind: 'running', activityId: 'pending', sequence: 1,
        name: { kind: 'omitted' }, purpose: 'stimulus',
        target: { kind: 'host' }, argv: ['true'], startedAt: record.admittedAt,
        telemetry: activeTelemetry('pending'),
      }] });
      await expect(reconcileDeadCapsuleManager(selector)).resolves.toMatchObject({
        kind: 'capsule-manager-reconciled', interruptedActivityIds: ['pending'],
        record: { state: 'manager-failed', manager: { pid }, cleanup: { kind: 'complete' } },
      });
      const persisted = await readCapsuleRecord(selector);
      expect(await readCapsuleActivities(selector)).toMatchObject([{ kind: 'interrupted',
        telemetry: { result: { kind: 'telemetry-scope-interrupted' } } }]);
      await expect(reconcileDeadCapsuleManager(selector)).resolves.toMatchObject({
        kind: 'capsule-manager-reconciliation-skipped', reason: 'terminal-session',
      });
      expect(await readCapsuleRecord(selector)).toEqual(persisted);
    } finally {
      await rm(projectDirectory, { recursive: true, force: true });
    }
  },
);
