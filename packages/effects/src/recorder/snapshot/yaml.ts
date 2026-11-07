import type { EffectSnapshotValue } from '../model.js';

function quoted(value: string): string {
  return JSON.stringify(value).replace(
    /[\u0085\u2028\u2029]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

function inline(value: EffectSnapshotValue): string | null {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return quoted(value);
  }
  if (typeof value !== 'object') {
    return String(value);
  }
  if (Object.keys(value).length === 0) {
    return Array.isArray(value) ? '[]' : '{}';
  }
  return null;
}

function lines(value: EffectSnapshotValue, depth: number): readonly string[] {
  const prefix = ' '.repeat(depth);
  const scalar = inline(value);
  if (scalar !== null) {
    return [`${prefix}${scalar}`];
  }
  const entries = Array.isArray(value)
    ? (value as readonly EffectSnapshotValue[]).map((item) => ['-', item] as const)
    : Object.entries(value as Readonly<Record<string, EffectSnapshotValue>>).map(
        ([key, item]) => [`${quoted(key)}:`, item] as const,
      );
  return entries.flatMap(([key, item]) => {
    const content = inline(item);
    return content === null
      ? [`${prefix}${key}`, ...lines(item, depth + 2)]
      : [`${prefix}${key} ${content}`];
  });
}

/** Only accepts already bounded, JSON-compatible values; quoted scalars avoid YAML coercion. */
export function snapshotYaml(value: EffectSnapshotValue): string {
  const yaml = `${lines(value, 0).join('\n')}\n`;
  if (Buffer.byteLength(yaml, 'utf8') > 1_048_576) {
    throw new RangeError('Effect snapshot YAML exceeds one MiB');
  }
  return yaml;
}
