import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

function isContained(parent: string, candidate: string): boolean {
  const candidateRelativePath = relative(parent, candidate);
  return (
    candidateRelativePath !== '..' &&
    !candidateRelativePath.startsWith(`..${sep}`) &&
    !isAbsolute(candidateRelativePath)
  );
}

export async function canonicalDriverModule(input: {
  readonly projectDirectory: string;
  readonly reference: string;
}): Promise<string> {
  const projectDirectory = await realpath(input.projectDirectory);
  const driverModule = await realpath(resolve(projectDirectory, input.reference));
  if (!isContained(projectDirectory, driverModule)) {
    throw new Error(
      `Driver module ${JSON.stringify(input.reference)} resolves outside the project directory`,
    );
  }
  return driverModule;
}
