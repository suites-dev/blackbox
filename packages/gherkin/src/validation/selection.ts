import type { CatalogEntrySummary } from '@suites/blackbox-catalog';

import type { DiagnosticSink, SourceLocation } from '../feature/diagnostics.js';
import type { NodeTags, TagValue } from '../feature/tags.js';

export interface SelectionContext {
  readonly catalog: readonly CatalogEntrySummary[];
  /** The Sandbox profile names blackbox.feature.yaml defines. */
  readonly sandboxProfiles: readonly string[];
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
      'selection',
      input.feature,
      `missing @${input.namespace}: tag; a Feature needs exactly one @${input.namespace}: tag`,
    );
    return null;
  }
  const [first, ...others] = tags;
  for (const other of others) {
    sink.report(
      'selection',
      other,
      `a Feature needs exactly one @${input.namespace}: tag; found @${input.namespace}:${first.value} and @${input.namespace}:${other.value}`,
    );
  }
  return others.length === 0 ? first : null;
}

/**
 * Checks that the Feature's `@system:` tag names a declared catalog entry and
 * its `@sandbox:` tag a profile of the project file.
 */
export function checkSelection(
  tags: NodeTags,
  feature: SourceLocation,
  context: SelectionContext,
  sink: DiagnosticSink,
): void {
  const system = exactlyOne(tags.system, { namespace: 'system', feature }, sink);
  const sandbox = exactlyOne(tags.sandbox, { namespace: 'sandbox', feature }, sink);
  if (system !== null && !context.catalog.some((candidate) => candidate.id === system.value)) {
    sink.report(
      'selection',
      system,
      `@system:${system.value} names no catalog entry (${known(context.catalog.map((candidate) => candidate.id))})`,
    );
  }
  if (sandbox !== null && !context.sandboxProfiles.includes(sandbox.value)) {
    sink.report(
      'selection',
      sandbox,
      `@sandbox:${sandbox.value} names no Sandbox profile (${known(context.sandboxProfiles)})`,
    );
  }
}
