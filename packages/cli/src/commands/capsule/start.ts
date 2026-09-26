import { Command, Flags } from '@oclif/core';
import { startCapsule, type CapsuleProgressMode } from '@suites/blackbox-capsule-internal';
import { nodeRuntimeActivationAdapters } from '@suites/blackbox-inst-runtime-node';
import { capsuleFailure } from '../../capsule/capsule-output.js';
import { createCapsuleProgressRenderer } from '../../capsule/capsule-progress.js';

export default class CapsuleStart extends Command {
  static override description = 'Start an interactive Capsule for a catalog system.';
  static override flags = {
    system: Flags.string({ required: true }),
    title: Flags.string({ description: 'Human-readable title shown in the report registry' }),
    description: Flags.string({ description: 'Free-form context shown with the report' }),
    env: Flags.string({ multiple: true }),
    json: Flags.boolean({ default: false }),
    interactive: Flags.boolean(),
    'non-interactive': Flags.boolean(),
    silent: Flags.boolean(),
    'no-color': Flags.boolean(),
  };
  public async run(): Promise<void> {
    const { flags } = await this.parse(CapsuleStart);
    const modes = [flags.interactive, flags['non-interactive'], flags.silent].filter(
      Boolean,
    ).length;
    if (modes > 1) {
      this.error('interactive, non-interactive, and silent are mutually exclusive', { exit: 2 });
    }
    const presentation = flags.silent
      ? 'silent'
      : flags.interactive || (!flags['non-interactive'] && process.stderr.isTTY)
        ? 'interactive'
        : 'plain';
    const renderer = createCapsuleProgressRenderer({
      presentation,
      color: !flags['no-color'] && !process.env.NO_COLOR && process.stderr.isTTY,
      write: (text) => process.stderr.write(text),
    });
    const environment: Record<string, string> = {};
    for (const item of flags.env ?? []) {
      const separator = item.indexOf('=');
      if (separator <= 0) {
        this.error(`invalid --env ${item}; expected KEY=VALUE`, { exit: 2 });
      }
      environment[item.slice(0, separator)] = item.slice(separator + 1);
    }
    const progress: CapsuleProgressMode =
      presentation === 'silent'
        ? { kind: 'silent' }
        : presentation === 'interactive'
          ? { kind: 'interactive', sink: renderer.sink }
          : { kind: 'non-interactive', sink: renderer.sink };
    const result = await startCapsule({
      projectDirectory: process.cwd(),
      systemId: flags.system,
      title: flags.title ?? flags.system,
      description:
        flags.description === undefined
          ? { kind: 'omitted' }
          : { kind: 'provided', value: flags.description },
      environment,
      runtimeActivationAdapters: nodeRuntimeActivationAdapters,
      progress,
    });
    renderer.finish();
    if (result.kind !== 'capsule-started') {
      if (flags.json) {
        this.log(capsuleFailure({ result, json: true }));
      }
      this.error(capsuleFailure({ result, json: false }), { exit: 1 });
    }
    const output = {
      sessionId: result.sessionId,
      system: result.system,
      title: result.title,
      composeProject: result.composeProject,
      artifactRoot: result.artifactRoot,
      entrypoint: result.entrypoint,
      containers: result.containers,
      networks: result.networks,
      volumes: result.volumes,
      readiness: result.readiness,
    };
    if (flags.json) {
      this.log(JSON.stringify(output));
    } else {
      this.log(`Capsule ${result.sessionId} started for ${result.system}.`);
      this.log(`Compose: ${result.composeProject}`);
      this.log(`Entrypoint: ${result.entrypoint.url}`);
      this.log(
        `Containers: ${result.containers.map((container) => `${container.containerName} (${container.containerId})`).join(', ') || 'none'}`,
      );
      this.log(`Networks: ${result.networks.join(', ') || 'none'}`);
      this.log(`Volumes: ${result.volumes.join(', ') || 'none'}`);
      this.log(`Readiness: ${result.readiness.status} (${result.readiness.durationMs}ms)`);
    }
  }
}
