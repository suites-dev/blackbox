import { spawn } from 'node:child_process';

export interface OpenBrowserInput {
  kind: 'open-browser';
  url: string;
}
export type BrowserCommand =
  | { kind: 'command'; executable: string; args: string[] }
  | { kind: 'unsupported'; platform: string };

export function browserCommand(input: OpenBrowserInput & { platform: string }): BrowserCommand {
  const url = new URL(input.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') {
    throw new Error('Expected a local report URL.');
  }
  switch (input.platform) {
    case 'darwin':
      return { kind: 'command', executable: 'open', args: [url.href] };
    case 'linux':
      return { kind: 'command', executable: 'xdg-open', args: [url.href] };
    case 'win32':
      return {
        kind: 'command',
        executable: 'rundll32.exe',
        args: ['url.dll,FileProtocolHandler', url.href],
      };
    default:
      return { kind: 'unsupported', platform: input.platform };
  }
}

export async function openBrowser(input: OpenBrowserInput): Promise<void> {
  const command = browserCommand({ ...input, platform: process.platform });
  if (command.kind === 'unsupported') {
    throw new Error(`Browser opening is unsupported on ${command.platform}.`);
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.executable, command.args, { stdio: 'ignore', shell: false });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Browser opener timed out.'));
    }, 5000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Browser opener exited with ${String(code)}.`));
      }
    });
  });
}
