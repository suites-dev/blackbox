import { Command } from '@oclif/core';

import { EXIT_CODES, type UsageExit } from './exit-codes.js';
import {
  CliFailure,
  PackageFailure,
  cliErrorDocument,
  cliErrorLines,
  cliFailure,
  cliFailureExit,
} from './failure.js';
import { writeHuman, writeJson } from './output.js';

/** Arguments before `--`; everything after it belongs to the child command. */
export function ownArgv(argv: readonly string[]): readonly string[] {
  const separator = argv.indexOf('--');
  return separator < 0 ? argv : argv.slice(0, separator);
}

/**
 * Base for every Blackbox command. A command implements `execute`; the base
 * turns flag-parse errors and CLI-layer failures into exactly one rendering
 * (human lines on stderr, or one `cli-error` document on stdout) and one exit
 * code from the shared table.
 */
export abstract class BlackboxCommand extends Command {
  /** `run` overrides this with 125 so a child's code 2 stays unambiguous. */
  protected readonly usageExit: UsageExit = EXIT_CODES.usage;

  protected abstract execute(): Promise<void>;

  public async run(): Promise<void> {
    try {
      await this.execute();
    } catch (error) {
      if (error instanceof PackageFailure) {
        this.renderPackageFailure(error);
        return;
      }
      this.renderFailure(
        error instanceof CliFailure
          ? error
          : cliFailure('operation-failed', error instanceof Error ? error.message : String(error)),
      );
    }
  }

  /**
   * Runs `this.parse(...)`; any parser error becomes a `usage` failure whose
   * message is oclif's own text, verbatim.
   */
  protected async parseInput<Parsed>(parse: () => Promise<Parsed>): Promise<Parsed> {
    try {
      return await parse();
    } catch (error) {
      throw new CliFailure({
        code: 'usage',
        message: error instanceof Error ? error.message : String(error),
        details: [],
        candidates: [],
        next: [`blackbox ${this.displayId()} --help`],
      });
    }
  }

  /** True when `--json` appears among this command's own arguments. */
  protected jsonRequested(): boolean {
    return ownArgv(this.argv).includes('--json');
  }

  protected displayId(): string {
    return (this.id ?? '').replaceAll(':', ' ');
  }

  protected finish(code: number): void {
    process.exitCode = code;
  }

  protected human(lines: readonly string[]): void {
    writeHuman(lines);
  }

  protected json(document: unknown): void {
    writeJson(document);
  }

  protected usageFailure(message: string): CliFailure {
    return new CliFailure({
      code: 'usage',
      message,
      details: [],
      candidates: [],
      next: [`blackbox ${this.displayId()} --help`],
    });
  }

  private renderPackageFailure(failure: PackageFailure): void {
    if (this.jsonRequested()) {
      this.json(failure.document);
    } else {
      this.human([`blackbox: ${failure.text}`]);
    }
    this.finish(EXIT_CODES.blackboxFailure);
  }

  private renderFailure(failure: CliFailure): void {
    if (this.jsonRequested()) {
      this.json(cliErrorDocument(failure.detail));
    } else {
      this.human(cliErrorLines(failure.detail));
    }
    this.finish(cliFailureExit(failure.detail.code, this.usageExit));
  }
}
