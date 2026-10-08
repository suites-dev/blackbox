export function npmCommand(args: readonly string[]): {
  readonly command: string;
  readonly args: readonly string[];
} {
  return {
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args,
  };
}
