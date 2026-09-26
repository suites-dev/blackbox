import assert from 'node:assert/strict';
import type { SandboxHandle } from '../../types.js';

/** Real Docker execution must preserve argument boundaries, stream identity, and failure status. */
export async function verifyExecutionOutcomes(handles: readonly SandboxHandle[]): Promise<void> {
  const literal = 'spaces ; $HOME $(echo should-not-run)';
  for (const handle of handles) {
    const result = await handle.execute({
      kind: 'container-exec',
      service: 'echo',
      argv: ['sh', '-c', 'printf "%s" "$1"; printf "diagnostic" >&2; exit 7', 'probe', literal],
    });
    if (result.kind !== 'exited') {
      throw new Error(`Container execution did not complete: ${JSON.stringify(result)}`);
    }
    assert.equal(result.exitCode, 7);
    assert.equal(result.stdout, literal);
    assert.equal(result.stderr, 'diagnostic');
    assert.equal(result.combined.includes(literal), true);
    assert.equal(result.combined.includes('diagnostic'), true);
    const unknown = await handle.execute({
      kind: 'container-exec',
      service: 'foreign-service',
      argv: ['true'],
    });
    assert.deepEqual(unknown, {
      kind: 'execution-failed',
      failure: { kind: 'unknown-service', service: 'foreign-service' },
    });
  }
}
