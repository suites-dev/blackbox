import { isAbsolute, posix } from 'node:path';

// A small strict reader for blackbox.gherkin.json. The file is a protected
// spec file that decides runner policy and credentials, so it accepts only
// the keys it documents: a misspelled key is an error, never silently ignored.

export type JsonObject = Readonly<Record<string, unknown>>;

export const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;

/** Collects every problem with its JSON path instead of stopping at the first. */
export class ConfigReader {
  readonly problems: string[] = [];

  report(path: string, message: string): void {
    this.problems.push(path === '' ? message : `${path}: ${message}`);
  }

  /** The object at `path`, reporting keys outside `allowed`; null when it is not an object. */
  object(value: unknown, path: string, allowed: readonly string[]): JsonObject | null {
    if (!isObject(value)) {
      this.report(path, 'must be an object');
      return null;
    }
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) {
        this.report(path === '' ? key : `${path}.${key}`, `is not a known setting (known: ${allowed.join(', ')})`);
      }
    }
    return value;
  }

  /** A record whose keys follow `keyPattern`; null when it is not an object. */
  record(value: unknown, path: string, keyPattern: RegExp): JsonObject | null {
    if (!isObject(value)) {
      this.report(path, 'must be an object');
      return null;
    }
    for (const key of Object.keys(value)) {
      if (!keyPattern.test(key)) {
        this.report(`${path}.${key}`, `is not a valid name (${String(keyPattern)})`);
      }
    }
    return value;
  }

  string(value: unknown, path: string): string {
    if (typeof value !== 'string' || value.trim() === '') {
      this.report(path, 'must be a non-empty string');
      return '';
    }
    return value;
  }

  /** A path relative to the project directory, with `/` separators. */
  relativePath(value: unknown, path: string): string {
    const text = this.string(value, path);
    if (text !== '' && (isAbsolute(text) || text.includes('\\'))) {
      this.report(path, 'must be a relative path with "/" separators');
    }
    return text;
  }

  /** Globs inside the project directory; `**` and `*` are the only wildcards. */
  globs(value: unknown, path: string, required: boolean): readonly string[] {
    if (value === undefined && !required) {
      return [];
    }
    if (!Array.isArray(value) || (required && value.length === 0)) {
      this.report(path, required ? 'must be a non-empty array of globs' : 'must be an array of globs');
      return [];
    }
    return value.map((glob: unknown, index) => {
      const text = this.relativePath(glob, `${path}[${index}]`);
      if (text.split('/').includes('..') || posix.normalize(text) !== text) {
        this.report(`${path}[${index}]`, 'must stay inside the project directory and be normalized');
      }
      return text;
    });
  }

  /** The name of a runner environment variable; the file never holds a value. */
  envName(value: unknown, path: string): string {
    const name = this.string(value, path);
    if (name !== '' && !ENV_NAME.test(name)) {
      this.report(path, 'must name an environment variable');
    }
    return name;
  }
}
