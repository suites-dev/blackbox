import { startCapsule, type CapsuleProgressMode } from '@suites/blackbox-capsule-internal';
import { nodeRuntimeActivationAdapters } from '@suites/blackbox-inst-runtime-node';

import { BlackboxCommand } from '../../cli/base-command.js';
import { EXIT_CODES } from '../../cli/exit-codes.js';
import { PackageFailure, cliFailure } from '../../cli/failure.js';
import { nextSteps } from '../../cli/next-steps.js';
import {
  entrypointHttpDriver,
  loadCatalogDetails,
  tryLoadCatalogEntry,
} from '../../catalog/catalog-details.js';
import { capsuleFailure } from '../../capsule/capsule-output.js';
import { createCapsuleProgressRenderer } from '../../capsule/capsule-progress.js';
import { setCurrentCapsule } from '../../context/current-capsule.js';
import {
  currentWriteFailure,
  upDocument,
  upLines,
  type CurrentOutcome,
  type StartedCapsule,
} from './up-output.js';

/** Sets the current capsule; a failure never rolls the started capsule back. */
async function makeCurrent(capsule: string): Promise<CurrentOutcome> {
  try {
    await setCurrentCapsule(process.cwd(), capsule);
    return { kind: 'set' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: 'not-set', error: currentWriteFailure(capsule, message) };
  }
}

export interface UpRequest {
  readonly system: string | null;
  readonly title: string | null;
  readonly description: string | null;
  readonly env: readonly string[];
  readonly json: boolean;
  readonly interactive: boolean;
  readonly nonInteractive: boolean;
  readonly silent: boolean;
  readonly noColor: boolean;
}

/** `up` and its `capsule start` alias. */
export abstract class UpCommand extends BlackboxCommand {
  protected async executeUp(request: UpRequest): Promise<void> {
    const modes = [request.interactive, request.nonInteractive, request.silent].filter(Boolean);
    if (modes.length > 1) {
      throw this.usageFailure('interactive, non-interactive, and silent are mutually exclusive');
    }
    const environment = this.environment(request.env);
    const system = request.system ?? (await this.defaultSystem());
    const presentation = request.silent
      ? 'silent'
      : request.interactive || (!request.nonInteractive && process.stderr.isTTY)
        ? 'interactive'
        : 'plain';
    const renderer = createCapsuleProgressRenderer({
      presentation,
      color: !request.noColor && !process.env.NO_COLOR && process.stderr.isTTY,
      write: (text) => process.stderr.write(text),
    });
    const progress: CapsuleProgressMode =
      presentation === 'silent'
        ? { kind: 'silent' }
        : presentation === 'interactive'
          ? { kind: 'interactive', sink: renderer.sink }
          : { kind: 'non-interactive', sink: renderer.sink };
    const started = Date.now();
    const result = await startCapsule({
      projectDirectory: process.cwd(),
      systemId: system,
      title: request.title ?? system,
      description:
        request.description === null
          ? { kind: 'omitted' }
          : { kind: 'provided', value: request.description },
      environment,
      runtimeActivationAdapters: nodeRuntimeActivationAdapters,
      progress,
    });
    const durationMs = Date.now() - started;
    renderer.finish();
    if (result.kind !== 'capsule-started') {
      throw new PackageFailure({
        document: {
          ...result,
          ...(result.sessionId === '' ? {} : { capsule: result.sessionId }),
          next: [],
        },
        text: capsuleFailure({ result, json: false }),
      });
    }
    await this.announce(request, result, durationMs);
  }

  private async announce(request: UpRequest, result: StartedCapsule, durationMs: number) {
    const capsule = result.sessionId;
    const current = await makeCurrent(capsule);
    const entry = await tryLoadCatalogEntry(process.cwd(), result.system);
    const runSuggestion = nextSteps.run({
      capsule,
      driver: entry === null ? null : entrypointHttpDriver(entry),
      readinessUrl: result.readiness.url,
    });
    if (request.json) {
      this.json(upDocument({ result, current, runSuggestion }));
    } else {
      this.human(upLines({ result, current, runSuggestion, durationMs }));
    }
    this.finish(current.kind === 'set' ? EXIT_CODES.success : EXIT_CODES.blackboxFailure);
  }

  private async defaultSystem(): Promise<string> {
    const { list } = await loadCatalogDetails(process.cwd());
    if (list.defaultEntry === '') {
      throw cliFailure('system-required', 'no system given and the catalog has no default', [
        'blackbox systems',
      ]);
    }
    return list.defaultEntry;
  }

  /** Parses repeated --env KEY=VALUE. Error text never echoes the value. */
  private environment(items: readonly string[]): Record<string, string> {
    const environment: Record<string, string> = {};
    for (const item of items) {
      const separator = item.indexOf('=');
      if (separator <= 0) {
        throw this.usageFailure('invalid --env; expected KEY=VALUE');
      }
      environment[item.slice(0, separator)] = item.slice(separator + 1);
    }
    return environment;
  }
}
