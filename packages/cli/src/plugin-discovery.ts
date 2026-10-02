import { access, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

import { isBlackboxCliPluginPackage } from '@suites/blackbox-cli-contract';

interface ProjectManifest {
  readonly name: unknown;
  readonly dependencies: Record<string, string>;
  readonly devDependencies: Record<string, string>;
}

const blackboxSourcePackageName = 'suites-blackbox-monorepo';

export type CliPluginDiscovery =
  | {
      readonly kind: 'source-checkout';
      readonly path: string;
      readonly names: readonly string[];
    }
  | {
      readonly kind: 'installed-consumer';
      readonly path: string;
      readonly names: readonly string[];
    };

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
      if (parent === current) {
        return null;
      }
      current = parent;
    }
  }
}

async function workspaceRoot(start: string): Promise<string | null> {
  let current = start;
  for (;;) {
    try {
      await access(join(current, 'pnpm-workspace.yaml'));
      return current;
    } catch {
      const parent = dirname(current);
      if (parent === current) {
        return null;
      }
      current = parent;
    }
  }
}

async function isBlackboxSourceRoot(directory: string): Promise<boolean> {
  try {
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    if (manifest.name !== blackboxSourcePackageName) {
      return false;
    }
    await access(join(directory, 'packages', 'cli', 'package.json'));
    return true;
  } catch {
    return false;
  }
}

async function pluginsFromManifest(
  projectPath: string,
  manifest: ProjectManifest,
): Promise<readonly string[]> {
  // A published CLI's own build/peer dependencies do not select consumer plugins.
  if (manifest.name === '@suites/blackbox-cli') {
    return [];
  }
  const names = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).sort();
  const requireFromProject = createRequire(join(projectPath, 'package.json'));
  const plugins: string[] = [];
  for (const name of names) {
    if (!name.startsWith('@suites/blackbox-')) {
      continue;
    }
    try {
      const entry = requireFromProject.resolve(name);
      const packageDirectory = await nearestPackageDirectory(dirname(entry));
      if (packageDirectory === null) {
        continue;
      }
      const packageManifest = JSON.parse(
        await readFile(join(packageDirectory, 'package.json'), 'utf8'),
      ) as unknown;
      if (isBlackboxCliPluginPackage(packageManifest)) {
        plugins.push(name);
      }
    } catch {
      // An unresolved optional package is absent, not a host failure.
    }
  }
  return plugins;
}

async function discoverFromAncestors(startDirectory: string): Promise<CliPluginDiscovery | null> {
  let current = startDirectory;
  for (;;) {
    try {
      const manifestPath = join(current, 'package.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
      const plugins = await pluginsFromManifest(current, {
        name: manifest.name,
        dependencies: dependencyMap(manifest.dependencies),
        devDependencies: dependencyMap(manifest.devDependencies),
      });
      if (plugins.length > 0) {
        return { kind: 'installed-consumer', path: current, names: plugins };
      }
    } catch {
      // An ancestor without a readable manifest is not a composition root.
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

export async function discoverProjectCliPlugins(
  startDirectory = process.cwd(),
  installationDirectory = startDirectory,
): Promise<CliPluginDiscovery | null> {
  // A source checkout is a deliberate composition root. Its workspace
  // manifest owns the feature packages even when a nested harness manifest
  // still lists only a subset of the current command surface.
  const workspace = await workspaceRoot(installationDirectory);
  const sourceRoot =
    workspace !== null && (await isBlackboxSourceRoot(workspace)) ? workspace : null;
  if (sourceRoot !== null) {
    const rootManifest = JSON.parse(
      await readFile(join(sourceRoot, 'package.json'), 'utf8'),
    ) as Record<string, unknown>;
    const plugins = await pluginsFromManifest(sourceRoot, {
      name: rootManifest.name,
      dependencies: dependencyMap(rootManifest.dependencies),
      devDependencies: dependencyMap(rootManifest.devDependencies),
    });
    if (plugins.length > 0) {
      return { kind: 'source-checkout', path: sourceRoot, names: plugins };
    }
  }

  const projectPath = await nearestPackageDirectory(startDirectory);
  let projectResult: CliPluginDiscovery | null = null;
  if (projectPath !== null) {
    const projectManifest = JSON.parse(
      await readFile(join(projectPath, 'package.json'), 'utf8'),
    ) as Record<string, unknown>;
    const plugins = await pluginsFromManifest(projectPath, {
      name: projectManifest.name,
      dependencies: dependencyMap(projectManifest.dependencies),
      devDependencies: dependencyMap(projectManifest.devDependencies),
    });
    if (plugins.length > 0) {
      projectResult = { kind: 'installed-consumer', path: projectPath, names: plugins };
    }
  }

  // A packed CLI is installed below the consumer's node_modules directory.
  // The consumer manifest, rather than the CLI package manifest, owns the
  // feature dependencies that compose its command surface.
  const installed = await discoverFromAncestors(installationDirectory);
  if (installed !== null) {
    return installed;
  }

  if (projectResult !== null) {
    return projectResult;
  }

  const root = await workspaceRoot(installationDirectory);
  if (root === null) {
    return null;
  }
  const rootManifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as Record<
    string,
    unknown
  >;
  const plugins = await pluginsFromManifest(root, {
    name: rootManifest.name,
    dependencies: dependencyMap(rootManifest.dependencies),
    devDependencies: dependencyMap(rootManifest.devDependencies),
  });
  return plugins.length === 0 ? null : { kind: 'source-checkout', path: root, names: plugins };
}
