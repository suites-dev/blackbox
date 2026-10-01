export interface BlackboxCliPluginManifest {
  readonly apiVersion: 1;
  readonly pluginId: string;
  readonly topic: string;
}

export interface BlackboxCliRegistration {
  readonly manifest: BlackboxCliPluginManifest;
  readonly commandIds: readonly string[];
}

export function isBlackboxCliPluginPackage(value: unknown): value is {
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

let runtimeAdapters: readonly unknown[] = [];

const cliSkillModules = Symbol.for('@suites/blackbox-cli-contract/skill-modules');

interface CliSkillModuleContext {
  [cliSkillModules]: readonly unknown[];
}

function skillModuleContext(config: object): object {
  if ('options' in config && typeof config.options === 'object' && config.options !== null) {
    return config.options;
  }
  return config;
}

/** Bind contributions once to this CLI invocation, including oclif config reloads. */
export function bindCliSkillModules(config: object, modules: readonly unknown[]): void {
  const context = skillModuleContext(config);
  if (Object.hasOwn(context, cliSkillModules)) {
    throw new Error('Skill modules already bound to this CLI config');
  }
  Object.defineProperty(context, cliSkillModules, {
    configurable: false,
    enumerable: true,
    value: Object.freeze([...modules]),
    writable: false,
  });
}

export function readCliSkillModules(config: object): readonly unknown[] {
  const context = skillModuleContext(config);
  return Object.hasOwn(context, cliSkillModules)
    ? (context as CliSkillModuleContext)[cliSkillModules]
    : [];
}

/** Plugin-owned runtime adapters shared with commands through the CLI composition root. */
export function registerRuntimeActivationAdapters(adapters: readonly unknown[]): void {
  runtimeAdapters = adapters;
}

export function readRuntimeActivationAdapters<T>(
  guard: (value: unknown) => value is T,
): readonly T[] {
  return runtimeAdapters.filter(guard);
}
