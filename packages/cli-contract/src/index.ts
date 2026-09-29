export interface BlackboxCliPluginManifest {
  readonly apiVersion: 1;
  readonly pluginId: string;
  readonly topic: string;
}

export interface BlackboxCliRegistration {
  readonly manifest: BlackboxCliPluginManifest;
  readonly commandIds: readonly string[];
}

export function isBlackboxCliPluginPackage(
  value: unknown,
): value is {
  readonly blackbox: { readonly cli: BlackboxCliPluginManifest };
} {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const blackbox = record.blackbox;
  if (typeof blackbox !== 'object' || blackbox === null) {
    return false;
  }
  const cli = (blackbox as Record<string, unknown>).cli;
  if (typeof cli !== 'object' || cli === null) {
    return false;
  }
  const manifest = cli as Record<string, unknown>;
  return (
    manifest.apiVersion === 1 &&
    typeof manifest.pluginId === 'string' &&
    manifest.pluginId.length > 0 &&
    typeof manifest.topic === 'string' &&
    manifest.topic.length > 0
  );
}
