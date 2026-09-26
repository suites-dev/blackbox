import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { cliExecutable } from '../testing/cli-path.fixture.js';

export async function runningReportCli(input: { directory: string; argv: readonly string[] }) {
  const cli = cliExecutable();
  const argv = input.argv.includes('--port') ? [...input.argv] : [...input.argv, '--port', '0'];
  const child = spawn(process.execPath, [cli, 'capsule', 'report', 'serve', ...argv], {
    cwd: input.directory,
  });
  let stdout = '';
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk;
  });
  const closed = new Promise<number | null>((resolve) => {
    child.once('close', resolve);
  });
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Server startup timed out: ${stderr}`));
    }, 10_000);
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
      const match = /http:\/\/127\.0\.0\.1:\d+\/[^\s]*/u.exec(stdout);
      if (match !== null) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited (${String(code)}): ${stderr}`));
    });
  });
  return { url, child, stop: () => stopCli({ child, closed }) };
}

async function stopCli(input: {
  child: ChildProcessWithoutNullStreams;
  closed: Promise<number | null>;
}): Promise<number | null> {
  const timer = setTimeout(() => {
    input.child.kill('SIGKILL');
  }, 5000);
  input.child.kill('SIGINT');
  try {
    return await input.closed;
  } finally {
    clearTimeout(timer);
  }
}
