import { missing, ownerLabel, readInventory, serviceLabel, type BuildInventory, type ImageEntry } from './inventory.js';

interface ImageInspection {
  readonly Id: string;
  readonly RepoTags: readonly string[];
  readonly Config: { readonly Labels: Readonly<Record<string, string>> | null };
}

export interface BuildImageDocker {
  readonly getImage: (tag: string) => {
    readonly inspect: () => Promise<ImageInspection>;
    readonly remove: (options: { readonly force: false; readonly noprune: true }) => Promise<unknown>;
  };
}

async function inspect(docker: BuildImageDocker, tag: string) {
  try {
    return await docker.getImage(tag).inspect();
  } catch (error) {
    if (missing(error)) {
      return null;
    }
    throw error;
  }
}

export async function requireUnusedTags(docker: BuildImageDocker, inventory: BuildInventory): Promise<void> {
  for (const { tag } of inventory.images) {
    if (await inspect(docker, tag) !== null) {
      throw new Error(`Refusing to replace existing Sandbox build tag ${tag}`);
    }
  }
}

async function ownedId(docker: BuildImageDocker, inventory: BuildInventory, entry: ImageEntry) {
  const image = await inspect(docker, entry.tag);
  if (image === null) {
    return null;
  }
  const labels = image.Config.Labels;
  if (!image.RepoTags.includes(entry.tag) || labels === null || labels[ownerLabel] !== inventory.owner ||
      labels[serviceLabel] !== entry.service || (entry.imageId !== null && entry.imageId !== image.Id)) {
    throw new Error(`Refusing to remove a changed or foreign build image at ${entry.tag}`);
  }
  return image.Id;
}

export async function observedInventory(docker: BuildImageDocker, inventory: BuildInventory): Promise<BuildInventory> {
  const images = await Promise.all(inventory.images.map(async (entry) => ({
    ...entry, imageId: await ownedId(docker, inventory, entry),
  })));
  return { ...inventory, images };
}

export async function removeRecordedImages(docker: BuildImageDocker, inventory: BuildInventory): Promise<void> {
  for (const entry of inventory.images) {
    if (await ownedId(docker, inventory, entry) === null) {
      continue;
    }
    try {
      // Remove only the recorded tag. Removing by ID or forcing could delete another tag.
      await docker.getImage(entry.tag).remove({ force: false, noprune: true });
    } catch (error) {
      if (!missing(error)) {
        throw error;
      }
    }
    if (await inspect(docker, entry.tag) !== null) {
      throw new Error(`Sandbox build tag remains after cleanup: ${entry.tag}`);
    }
  }
}

export async function recoverBuildImages(docker: BuildImageDocker, directory: string, projectName: string): Promise<void> {
  const inventory = await readInventory(directory, projectName);
  if (inventory !== null) {
    await removeRecordedImages(docker, inventory);
  }
}
