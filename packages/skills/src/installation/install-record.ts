import { createHash } from 'node:crypto';

/**
 * The provenance record Blackbox writes inside every skill directory it
 * installs. It is deterministic (no timestamps or absolute paths) so a committed
 * installation reads as `unchanged` on every teammate's checkout.
 */
export const INSTALL_RECORD_NAME = '.blackbox-install.json';
export const INSTALLER_PACKAGE = '@suites/blackbox-skills';

export interface InstallRecord {
  readonly skill: string;
  /** Null only for older records that did not identify the contributing package. */
  readonly sourcePackage: string | null;
  readonly version: string;
  /** Skill-relative `/` path → `sha256:<hex>`, excluding the record itself. */
  readonly files: Readonly<Record<string, string>>;
}

const HASH = /^sha256:[0-9a-f]{64}$/u;

/**
 * Hashes content with CRLF normalized to LF, so a Windows checkout with
 * `core.autocrlf` still matches the record written on another platform.
 */
export function contentHash(content: Uint8Array): string {
  const normalized = Buffer.from(content).toString('latin1').replaceAll('\r\n', '\n');
  return `sha256:${createHash('sha256').update(normalized, 'latin1').digest('hex')}`;
}

export function fileHashes(files: ReadonlyMap<string, Uint8Array>): Record<string, string> {
  return Object.fromEntries(
    [...files.keys()]
      .sort()
      .map((path) => [path, contentHash(files.get(path) ?? new Uint8Array())]),
  );
}

export function encodeInstallRecord(record: InstallRecord): Uint8Array {
  const document = {
    installer: INSTALLER_PACKAGE,
    skill: record.skill,
    ...(record.sourcePackage === null ? {} : { sourcePackage: record.sourcePackage }),
    version: record.version,
    files: Object.fromEntries(
      Object.keys(record.files)
        .sort()
        .map((path) => [path, record.files[path]]),
    ),
  };
  return Buffer.from(`${JSON.stringify(document, null, 2)}\n`);
}

/** The record, or null when it is not a well-formed Blackbox record. */
// eslint-disable-next-line complexity -- decodes an install record from untrusted JSON on disk; each condition rejects one malformed field
export function decodeInstallRecord(content: Uint8Array): InstallRecord | null {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(content).toString('utf8')) as unknown;
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const { installer, skill, version, files, sourcePackage } = value as Record<string, unknown>;
  if (
    installer !== INSTALLER_PACKAGE ||
    typeof skill !== 'string' ||
    (sourcePackage !== undefined &&
      (typeof sourcePackage !== 'string' || sourcePackage.length === 0)) ||
    typeof version !== 'string' ||
    typeof files !== 'object' ||
    files === null ||
    Array.isArray(files)
  ) {
    return null;
  }
  const entries = Object.entries(files as Record<string, unknown>);
  if (!entries.every(([, hash]) => typeof hash === 'string' && HASH.test(hash))) {
    return null;
  }
  return {
    skill,
    sourcePackage: typeof sourcePackage === 'string' ? sourcePackage : null,
    version,
    files: Object.fromEntries(entries) as Record<string, string>,
  };
}
