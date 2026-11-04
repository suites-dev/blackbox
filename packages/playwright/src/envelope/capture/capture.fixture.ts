import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const catalogYaml = `schemaVersion: 1
catalog:
  default: system
  entries:
    system:
      kind: system
      acquisition:
        adapter: docker-compose@1
        files:
          - .blackbox/catalog/system.yml
      entrypoint:
        participant: api
        protocol: http
        containerPort: 3000
        readiness:
          path: /health
          timeoutMs: 1000
      participants:
        api:
          service: api
          role: entrypoint
          runtime: node
          activation: node
        db:
          service: db
          role: dependency
          runtime: infra
      drivers:
        api:
          kind: project-driver
          runtime: node
          ref: .blackbox/drivers/api.mjs
          target:
            kind: participant
            participant: api
            protocol: http
            containerPort: 3000
          execution:
            kind: host
          propagation:
            kind: w3c-trace-context-propagation
            carrier: http-headers
      observation:
        policyId: policy-1
        boundaries:
          - id: effects.http
            kind: http
            authoritativeFor: [http effects]
        requiredBoundaries: [effects.http]
        terminalObservationWindowMs: 1000
        redaction:
          requestBodies: not-captured
          headers: [authorization]
          dynamicIdentifiers: normalized
activations:
  node:
    ref: .blackbox/instrumentation/instrumentation.js
    adapter: node-preload
    version: 1
`;

export const files = {
  'blackbox.config.yaml': catalogYaml,
  '.blackbox/catalog/system.yml': 'services:\n  api:\n    image: api:1\n',
  '.blackbox/drivers/api.mjs': 'export default {};\n',
  '.blackbox/instrumentation/instrumentation.js': 'module.exports = 1;\n',
  '.blackbox/instrumentation/package.json': '{"name":"inst","version":"1.0.0"}\n',
};

export async function project(extra: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'bb-envelope-'));
  await writeAll(root, { ...files, ...extra });
  return root;
}

export async function writeAll(root: string, content: Record<string, string>): Promise<void> {
  for (const [path, text] of Object.entries(content)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
}

export function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    encoding: 'utf8',
  }).trim();
}

export async function repository(content: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'bb-envelope-git-'));
  git(root, 'init', '-q');
  await writeAll(root, content);
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'initial');
  return root;
}

export const remove = (root: string): Promise<void> => rm(root, { recursive: true, force: true });
