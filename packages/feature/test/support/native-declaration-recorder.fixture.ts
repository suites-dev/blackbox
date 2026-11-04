import { expect } from 'vitest';

export type RecordedTestBody = (fixtures: unknown) => Promise<void>;

/** Collect generated native tests and reject an unexpected selection or client binding. */
export function nativeDeclarationRecorder(tests: RecordedTestBody[], expectedOptions: unknown) {
  return Object.assign(
    (...args: unknown[]) => tests.push(args.at(-1) as RecordedTestBody),
    {
      describe: (...args: unknown[]) => { (args.at(-1) as () => void)(); },
      use: (options: unknown) => { expect(options).toEqual(expectedOptions); },
    },
  );
}
