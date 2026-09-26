import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import { DriverPreparationTimeoutError } from '../../protocol/timeout.js';

const MAX_PROTOCOL_OUTPUT_BYTES = 1024 * 1024;

export interface RunProjectDriverProcessInput {
  readonly source: string;
  readonly projectDirectory: string;
  readonly requestJson: string;
  readonly timeoutMs: number;
}

export interface ProjectDriverProcessOutput {
  readonly stdout: string;
  readonly stderr: string;
}

function terminateProjectDriver(child: ChildProcessWithoutNullStreams): void {
  if (process.platform === 'win32' || child.pid === undefined) {
    child.kill('SIGKILL');
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
  child.stdin.destroy();
  child.stdout.destroy();
  child.stderr.destroy();
}

export function runProjectDriverProcess(
  input: RunProjectDriverProcessInput,
): Promise<ProjectDriverProcessOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', input.source], {
      cwd: input.projectDirectory,
      detached: process.platform !== 'win32',
      env: process.env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let retainedBytes = 0;
    let outputLimitExceeded = false;
    let settled = false;
    let stdinError: Error | null = null;
    const retainOutput = (chunks: Buffer[], chunk: Buffer): void => {
      if (outputLimitExceeded) {
        return;
      }
      const remaining = MAX_PROTOCOL_OUTPUT_BYTES - retainedBytes;
      if (chunk.byteLength <= remaining) {
        chunks.push(chunk);
        retainedBytes += chunk.byteLength;
        return;
      }
      if (remaining > 0) {
        chunks.push(chunk.subarray(0, remaining));
        retainedBytes += remaining;
      }
      outputLimitExceeded = true;
      terminateProjectDriver(child);
    };
    const timeout = setTimeout(() => {
      settled = true;
      terminateProjectDriver(child);
      reject(new DriverPreparationTimeoutError());
    }, input.timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      retainOutput(stdout, chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      retainOutput(stderr, chunk);
    });
    child.stdin.on('error', (error) => {
      stdinError = error;
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      if (settled) {
        return;
      }
      settled = true;
      const output = Buffer.concat(stdout).toString('utf8');
      const errorOutput = Buffer.concat(stderr).toString('utf8');
      if (outputLimitExceeded) {
        reject(new Error('Driver protocol output exceeded 1 MiB'));
      } else if (code !== 0) {
        reject(
          new Error(`Driver runner exited with code ${code}, signal ${signal}: ${errorOutput}`),
        );
      } else if (stdinError !== null) {
        reject(stdinError);
      } else {
        resolve({ stdout: output, stderr: errorOutput });
      }
    });
    child.stdin.end(input.requestJson);
  });
}
