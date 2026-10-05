import type { SandboxEnvironmentSpec } from '../../runtime/environment.js';
import type { DiagnosticSink, SourceLocation } from './diagnostics.js';
import type { CompileContext, FeatureSelection } from './model.js';
import type { NodeTags, TagValue } from './tags.js';

export interface SelectedBoundary {
  readonly selection: FeatureSelection;
  readonly environment: SandboxEnvironmentSpec;
}

function known(values: readonly string[]): string {
  return values.length === 0 ? 'none are configured' : `known: ${[...values].sort().join(', ')}`;
}

/** A Feature names exactly one value in a selection namespace. */
function exactlyOne(
  tags: readonly TagValue[],
  input: { readonly namespace: string; readonly feature: SourceLocation },
  sink: DiagnosticSink,
): TagValue | null {
  if (tags.length === 0) {
    sink.report(
      input.feature,
      `missing @${input.namespace}: tag; a Feature needs exactly one @${input.namespace}: tag`,
    );
    return null;
  }
  const [first, ...others] = tags;
  for (const other of others) {
    sink.report(
      other,
      `a Feature needs exactly one @${input.namespace}: tag; found @${input.namespace}:${first.value} and @${input.namespace}:${other.value}`,
    );
  }
  return others.length === 0 ? first : null;
}

/**
 * Resolves the Feature's `@system:` tag to a declared catalog entry, reading
 * its kind from the catalog, and its `@sandbox:` tag to a configured profile.
 */
export function selectBoundary(
  tags: NodeTags,
  feature: SourceLocation,
  context: CompileContext,
  sink: DiagnosticSink,
): SelectedBoundary | null {
  const system = exactlyOne(tags.system, { namespace: 'system', feature }, sink);
  const sandbox = exactlyOne(tags.sandbox, { namespace: 'sandbox', feature }, sink);
  const entry =
    system === null ? undefined : context.catalog.find((candidate) => candidate.id === system.value);
  if (system !== null && entry === undefined) {
    sink.report(
      system,
      `@system:${system.value} names no catalog entry (${known(context.catalog.map((candidate) => candidate.id))})`,
    );
  }
  const profiles = context.sandboxProfiles;
  const profile =
    sandbox !== null && Object.hasOwn(profiles, sandbox.value) ? profiles[sandbox.value] : undefined;
  if (sandbox !== null && profile === undefined) {
    sink.report(
      sandbox,
      `@sandbox:${sandbox.value} names no Sandbox profile (${known(Object.keys(profiles))})`,
    );
  }
  if (sandbox === null || entry === undefined || profile === undefined) {
    return null;
  }
  return {
    selection: { kind: entry.kind, id: entry.id, sandbox: sandbox.value },
    environment: profile.environment,
  };
}
