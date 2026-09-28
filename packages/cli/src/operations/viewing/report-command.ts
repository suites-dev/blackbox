import { reportCapsule, type CapsuleReportDocument } from '@suites/blackbox-capsule-internal';

import { BlackboxCommand } from '../../cli/base-command.js';
import { EXIT_CODES } from '../../cli/exit-codes.js';
import { PackageFailure, cliFailure } from '../../cli/failure.js';
import { capsuleFailure } from '../../capsule/capsule-output.js';
import { InvocationContext } from '../../context/invocation.js';
import { resolveId } from '../../context/resolver.js';
import { exportReport } from '../../reporting/export.js';

export type ReportFormat = 'html' | 'json';

export interface ReportRequest {
  readonly positional: string | null;
  readonly capsuleFlag: string | null;
  readonly format: ReportFormat | null;
  readonly output: string | null;
  readonly json: boolean;
}

/** `report` and its `capsule report export` alias. */
export abstract class ReportCommand extends BlackboxCommand {
  protected async executeReport(request: ReportRequest): Promise<void> {
    this.validate(request);
    const capsule = await this.target(request);
    const result = await reportCapsule({ projectDirectory: process.cwd(), sessionId: capsule });
    if (result.kind !== 'capsule-report') {
      throw new PackageFailure({ document: result, text: capsuleFailure({ result, json: false }) });
    }
    if (request.output === '-') {
      const exported = await this.write(capsule, result.document, 'json', { kind: 'stdout' });
      if (exported.kind === 'stdout') {
        process.stdout.write(exported.content);
      }
      this.finish(EXIT_CODES.success);
      return;
    }
    const formats: readonly ReportFormat[] =
      request.format === null ? ['html', 'json'] : [request.format];
    const files: { format: ReportFormat; path: string }[] = [];
    for (const format of formats) {
      const exported = await this.write(
        capsule,
        result.document,
        format,
        request.output === null ? { kind: 'default' } : { kind: 'file', path: request.output },
      );
      if (exported.kind === 'file') {
        files.push({ format, path: exported.path });
      }
    }
    if (request.json) {
      this.json({ kind: 'capsule-report-written', capsule, files, next: [] });
    } else {
      this.human([`report for capsule ${capsule}`, ...files.map(({ path }) => `✔ ${path}`)]);
    }
    this.finish(EXIT_CODES.success);
  }

  private validate(request: ReportRequest): void {
    if (request.output === '-' && request.json) {
      throw cliFailure(
        'conflicting-output',
        '--json and --output - both write to stdout; choose one',
      );
    }
    if (request.output !== null && request.format === null) {
      throw this.usageFailure('--output requires --format');
    }
    if (request.output === '-' && request.format !== 'json') {
      throw this.usageFailure('--output - requires --format json.');
    }
  }

  /** A positional ID selects its capsule; otherwise the resolved capsule. */
  private async target(request: ReportRequest): Promise<string> {
    const context = new InvocationContext(process.cwd());
    if (request.positional === null) {
      return (await context.capsule(request.capsuleFlag)).capsule;
    }
    const resolved = await resolveId(await context.index(), request.positional, {
      kind: 'project',
    });
    return resolved.capsule.capsule;
  }

  private async write(
    capsule: string,
    document: CapsuleReportDocument,
    format: ReportFormat,
    destination: { kind: 'stdout' } | { kind: 'default' } | { kind: 'file'; path: string },
  ) {
    try {
      return await exportReport({
        kind: 'export-report',
        projectDirectory: process.cwd(),
        format,
        document,
        destination,
      });
    } catch (error) {
      const recorded =
        error instanceof Error
          ? { name: error.name, message: error.message }
          : { name: 'Error', message: String(error) };
      throw new PackageFailure({
        document: {
          kind: 'capsule-operation-failed',
          operation: 'report',
          sessionId: capsule,
          error: recorded,
        },
        text: `${recorded.name}: ${recorded.message}`,
      });
    }
  }
}
