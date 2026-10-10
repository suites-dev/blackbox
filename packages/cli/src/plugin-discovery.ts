import { access, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { selectPackageModules, type SelectedPackage } from './modules/package-modules.js';

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
      readonly packages: readonly SelectedPackage[];
    }
  | {
      readonly kind: 'installed-consumer';
      readonly path: string;
      readonly names: readonly string[];
      readonly packages: readonly SelectedPackage[];
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
): Promise<readonly SelectedPackage[]> {
  // A published CLI's own build/peer dependencies do not select consumer plugins.
  if (manifest.name === '@suites/blackbox-cli') {
    return [];
  }
  const names = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).sort();
  return selectPackageModules(projectPath, names);
}

async function discoverFromAncestors(startDirectory: string): Promise<CliPluginDiscovery | null> {
  let current = startDirectory;
  for (;;) {
    let manifest: Record<string, unknown> | undefined;
    try {
      const manifestPath = join(current, 'package.json');
      manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        throw error;
      }
    }
    // Package contributions are not consumer roots. Their build dependencies
    // must never replace the application's explicit module selection.
    if (manifest !== undefined && manifest.blackbox === undefined) {
      const plugins = await pluginsFromManifest(current, {
        name: manifest.name,
        dependencies: dependencyMap(manifest.dependencies),
        devDependencies: dependencyMap(manifest.devDependencies),
      });
      if (plugins.length > 0) {
        return {
          kind: 'installed-consumer',
          path: current,
          names: plugins.map(({ name }) => name),
          packages: plugins,
        };
      }
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
  // manifest owns the contributing packages even when a nested harness manifest
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
      return {
        kind: 'source-checkout',
        path: sourceRoot,
        names: plugins.map(({ name }) => name),
        packages: plugins,
      };
    }
  }

  // Choose the installed consumer before importing any working-directory
  // contributions. An unrelated project's modules must not execute speculatively.
  const installed = await discoverFromAncestors(installationDirectory);
  if (installed !== null) {
    return installed;
  }

  const projectPath = await nearestPackageDirectory(startDirectory);
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
      return {
        kind: 'installed-consumer',
        path: projectPath,
        names: plugins.map(({ name }) => name),
        packages: plugins,
      };
    }
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
  return plugins.length === 0
    ? null
    : {
        kind: 'source-checkout',
        path: root,
        names: plugins.map(({ name }) => name),
        packages: plugins,
      };
}
