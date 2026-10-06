import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Config, type Command } from '@oclif/core';
import type { vi } from 'vitest';

// Runs `blackbox gherkin` commands through oclif, as the CLI host runs them,
// from a bare oclif root so a test never loads a built command registry. The
// gate is the command's exit code: 0 passes, 1 is a failed check.

/** A catalog with the one system the rule-dodging features select. */
export const CATALOG = `schemaVersion: 1
catalog:
  default: subscription-system
  entries:
    subscription-system:
      kind: system
      acquisition: { adapter: docker-compose@1, files: [compose.yml] }
      entrypoint: { participant: api, protocol: http, containerPort: 3000, readiness: { path: /health, timeoutMs: 30000 } }
      participants:
        api: { service: api, role: entrypoint, runtime: node, activation: node-runtime }
      drivers: {}
      observation:
        policyId: api-v1
        boundaries:
          - { id: effects.http, kind: http, authoritativeFor: [HTTP effects] }
        requiredBoundaries: [effects.http]
        terminalObservationWindowMs: 500
        redaction: { requestBodies: not-captured, headers: [authorization], dynamicIdentifiers: normalized }
activations:
  node-runtime: { ref: bootstrap.mjs, adapter: node-factory, version: 1 }
`;

export interface CommandRun {
  readonly exit: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** A `blackbox gherkin` command class, run through its static `run` as the CLI host does. */
export type CommandClass = (new (argv: string[], config: Config) => Command) & Pick<typeof Command, 'run'>;

export type RunCommand = (command: CommandClass, argv: readonly string[]) => Promise<CommandRun>;

/** The exit code oclif attached to a thrown exit or error, or -1 for anything else. */
function oclifExit(error: unknown): number {
  const oclif = typeof error === 'object' && error !== null && 'oclif' in error ? error.oclif : null;
  return typeof oclif === 'object' && oclif !== null && 'exit' in oclif && typeof oclif.exit === 'number' ? oclif.exit : -1;
}

type Hook = (body: () => unknown) => void;

/**
 * Creates the bare oclif root before a test file's tests and removes it after
 * them. The test file passes its own runner hooks and spies.
 */
export function useCommands(beforeAll: Hook, afterAll: Hook, spies: typeof vi): RunCommand {
  let root = '';
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'blackbox-gherkin-oclif-'));
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'gherkin-command-test', version: '0.0.0', oclif: {} }));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return async (command, argv) => {
    let stdout = '';
    let stderr = '';
    const loaded = await Config.load({ root });
    spies.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => (stdout += String(chunk)) !== '');
    spies.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => (stderr += String(chunk)) !== '');
    spies.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => (stdout += `${parts.map(String).join(' ')}\n`));
    spies.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => (stderr += `${parts.map(String).join(' ')}\n`));
    let exit = 0;
    try {
      await command.run([...argv], loaded);
    } catch (error) {
      exit = oclifExit(error);
      if (exit === -1) {
        throw error;
      }
      // oclif's static run leaves rendering a failure to the bin's error handler.
      stderr += `${(error as Error).message}\n`;
    } finally {
      spies.restoreAllMocks();
    }
    return { exit, stdout, stderr };
  };
}
