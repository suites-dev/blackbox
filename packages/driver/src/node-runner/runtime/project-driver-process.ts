import { spawn } from 'node:child_process';

import { DriverPreparationTimeoutError, driverPreparationTimeoutMs } from '../../protocol/timeout.js';

const MAX_PROTOCOL_OUTPUT_BYTES = 1024 * 1024;

export interface RunProjectDriverProcessInput {
  readonly source: string;
  readonly projectDirectory: string;
  readonly requestJson: string;
}

export interface ProjectDriverProcessOutput {
  readonly stdout: string;
  readonly stderr: string;
}

export function runProjectDriverProcess(
  input: RunProjectDriverProcessInput,
): Promise<ProjectDriverProcessOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', input.source], {
      cwd: input.projectDirectory,
      env: process.env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      child.kill('SIGKILL');
      reject(new DriverPreparationTimeoutError());
    }, driverPreparationTimeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      stdout.push(chunk);
      if (outputBytes > MAX_PROTOCOL_OUTPUT_BYTES) {
        child.kill('SIGKILL');
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr.push(chunk);
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
      if (outputBytes > MAX_PROTOCOL_OUTPUT_BYTES) {
        reject(new Error('Driver protocol output exceeded 1 MiB'));
      } else if (code !== 0) {
        reject(new Error(`Driver runner exited with code ${code}, signal ${signal}: ${errorOutput}`));
      } else {
        resolve({ stdout: output, stderr: errorOutput });
      }
    });
    child.stdin.end(input.requestJson);
  });
}
