import { access, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

import { isBlackboxCliPluginPackage } from '@suites/blackbox-cli-contract';

interface ProjectManifest {
  readonly dependencies: Record<string, string>;
  readonly devDependencies: Record<string, string>;
}

function dependencyMap(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) {
    return {};
  }
  return value as Record<string, string>;
}

async function nearestPackageDirectory(start: string): Promise<string | null> {
  let current = start;
  for (;;) {
    try {
      await access(join(current, 'package.json'));
      return current;
    } catch {
      const parent = dirname(current);
      if (parent === current) {return null;}
      current = parent;
    }
  }
}

export async function discoverProjectCliPlugins(
  startDirectory = process.cwd(),
): Promise<{ readonly path: string; readonly names: readonly string[] } | null> {
  const projectPath = await nearestPackageDirectory(startDirectory);
  if (projectPath === null) {return null;}
  const projectManifestPath = join(projectPath, 'package.json');
  const parsedManifest = JSON.parse(
    await readFile(projectManifestPath, 'utf8'),
  ) as Record<string, unknown>;
  const projectManifest = {
    dependencies: dependencyMap(parsedManifest.dependencies),
    devDependencies: dependencyMap(parsedManifest.devDependencies),
  } satisfies ProjectManifest;
  const names = Object.keys({
    ...projectManifest.dependencies,
    ...projectManifest.devDependencies,
  }).sort();
  const requireFromProject = createRequire(projectManifestPath);
  const plugins: string[] = [];
  for (const name of names) {
    if (!name.startsWith('@suites/blackbox-')) {continue;}
    try {
      const entry = requireFromProject.resolve(name);
      const packageDirectory = await nearestPackageDirectory(dirname(entry));
      if (packageDirectory === null) {continue;}
      const manifest = JSON.parse(
        await readFile(join(packageDirectory, 'package.json'), 'utf8'),
      ) as unknown;
      if (isBlackboxCliPluginPackage(manifest)) {plugins.push(name);}
    } catch {
      // An unresolved optional package is absent, not a host failure.
    }
  }
  return { path: projectPath, names: plugins };
}
