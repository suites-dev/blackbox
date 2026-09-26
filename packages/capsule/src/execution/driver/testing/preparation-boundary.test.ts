import { access, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { runCapsuleDriver } from '../../driver-execution.js';
import {
  cleanDriverProjects,
  driverInput,
  driverProject,
} from './execution.fixture.js';

const externalDirectories: string[] = [];

afterEach(async () => {
  await cleanDriverProjects();
  await Promise.all(
    externalDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

it('refuses a driver symlink outside the project before executing it', async () => {
  const projectDirectory = await driverProject('export default {};');
  const externalDirectory = await mkdtemp(join(tmpdir(), 'capsule-external-driver-'));
  externalDirectories.push(externalDirectory);
  const marker = join(externalDirectory, 'executed');
  const externalDriver = join(externalDirectory, 'driver.mjs');
  await writeFile(
    externalDriver,
    `import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(marker)}, 'executed');
export default {};`,
  );
  await unlink(join(projectDirectory, 'driver.mjs'));
  await symlink(externalDriver, join(projectDirectory, 'driver.mjs'));

  const result = await runCapsuleDriver(driverInput(projectDirectory));

  await expect(access(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(result).toMatchObject({
    kind: 'driver-prepare-failed',
    error: { message: expect.stringContaining('resolves outside the project directory') },
  });
});
