import { open, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

async function removeTemporary(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      throw error;
    }
  }
}

export async function durableJsonWrite(input: {
  readonly target: string;
  readonly token: string;
  readonly value: unknown;
}): Promise<void> {
  const temporary = `${input.target}.${input.token}.tmp`;
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(`${JSON.stringify(input.value, null, 2)}\n`, 'utf8');
    await file.sync();
  } catch (error) {
    await file.close();
    await removeTemporary(temporary);
    throw error;
  }
  await file.close();
  try {
    await rename(temporary, input.target);
    const directory = await open(dirname(input.target), 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch (error) {
    await removeTemporary(temporary);
    throw error;
  }
}
