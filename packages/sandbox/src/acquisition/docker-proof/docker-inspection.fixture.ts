import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface DockerResources {
  readonly containers: readonly string[];
  readonly networks: readonly string[];
  readonly volumes: readonly string[];
}

export interface ContainerInspection {
  readonly Id: string;
  readonly Name: string;
  readonly State: { readonly Running: boolean; readonly Status: string };
  readonly Config: { readonly Labels: Readonly<Record<string, string>> };
  readonly NetworkSettings: {
    readonly Networks: Readonly<Record<string, object>>;
    readonly Ports: Readonly<
      Record<string, readonly { readonly HostIp: string; readonly HostPort: string }[] | undefined>
    >;
  };
}

async function dockerLines(input: { readonly arguments: readonly string[] }): Promise<string[]> {
  const { stdout } = await execFileAsync('docker', [...input.arguments], {
    encoding: 'utf8',
    timeout: 20_000,
  });
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .sort();
}

async function resources(input: {
  readonly kind: 'container' | 'network' | 'volume';
  readonly projectNames: readonly string[];
}): Promise<string[]> {
  const command = input.kind === 'container' ? ['ps', '-a'] : [input.kind, 'ls'];
  const format = input.kind === 'volume' ? '{{.Name}}' : '{{.ID}}';
  const rows = await Promise.all(
    input.projectNames.map((project) =>
      dockerLines({
        arguments: [
          ...command,
          '--filter',
          `label=com.docker.compose.project=${project}`,
          '--format',
          format,
        ],
      }),
    ),
  );
  return rows.flat().sort();
}

export async function resourcesForProjects(input: {
  readonly projectNames: readonly string[];
}): Promise<DockerResources> {
  const [containers, networks, volumes] = await Promise.all([
    resources({ kind: 'container', projectNames: input.projectNames }),
    resources({ kind: 'network', projectNames: input.projectNames }),
    resources({ kind: 'volume', projectNames: input.projectNames }),
  ]);
  return { containers, networks, volumes };
}

export async function inspectContainers(input: {
  readonly ids: readonly string[];
}): Promise<readonly ContainerInspection[]> {
  if (input.ids.length === 0) {
    return [];
  }
  const { stdout } = await execFileAsync('docker', ['inspect', ...input.ids], {
    encoding: 'utf8',
    timeout: 20_000,
  });
  return JSON.parse(stdout) as readonly ContainerInspection[];
}

export async function inspectNamedResources(input: {
  readonly kind: 'network' | 'volume';
  readonly names: readonly string[];
}): Promise<readonly unknown[]> {
  if (input.names.length === 0) {
    return [];
  }
  const { stdout } = await execFileAsync('docker', [input.kind, 'inspect', ...input.names], {
    encoding: 'utf8',
    timeout: 20_000,
  });
  return JSON.parse(stdout) as readonly unknown[];
}

export function inspectedHostPort(input: { readonly container: ContainerInspection }): number {
  const bindings = input.container.NetworkSettings.Ports['80/tcp'];
  if (bindings === undefined || bindings.length === 0) {
    throw new Error(`Container ${input.container.Id} has no 80/tcp host binding`);
  }
  const ports = new Set(bindings.map((binding) => binding.HostPort));
  if (ports.size !== 1) {
    throw new Error(`Container ${input.container.Id} maps 80/tcp to multiple host ports`);
  }
  return Number(bindings[0].HostPort);
}
