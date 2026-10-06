import type { CatalogEntrySummary } from '@suites/blackbox-catalog';

import { compilerTestLibrary } from '../../library/testing/compiler-steps.js';
import type { Capability } from '../../runtime/step-types.js';
import type { CompileContext } from '../planning/model.js';
import { planFeature } from '../planning/plan.js';
import { FeatureCompileError } from '../planning/diagnostics.js';

export const testCatalog = [
  { id: 'payment-mock', kind: 'subsystem', isDefault: false },
  { id: 'subscription-system', kind: 'system', isDefault: true },
] as const satisfies readonly CatalogEntrySummary[];

export function testContext(capabilities: readonly Capability[] = []): CompileContext {
  return {
    catalog: testCatalog,
    sandboxProfiles: {
      default: { environment: { FIXTURE_CONTROL_TOKEN: { fromEnv: 'BLACKBOX_E2E_FIXTURE_TOKEN' } } },
      bare: { environment: {} },
    },
    library: compilerTestLibrary(capabilities),
  };
}

/** Plans a feature and returns its formatted diagnostics, or [] when it compiles. */
export function diagnosticsOf(source: string, capabilities: readonly Capability[] = []): readonly string[] {
  try {
    planFeature(source, 'features/probe.feature', testContext(capabilities));
    return [];
  } catch (error) {
    if (error instanceof FeatureCompileError) {
      return error.message.split('\n');
    }
    throw error;
  }
}

/** A minimal valid feature around the given scenario lines, with the given tag lines on top. */
export function featureWith(featureTags: string, body: string): string {
  return `${featureTags}\nFeature: probe\n\n${body}\n`;
}

export const SELECTED = '@system:subscription-system @sandbox:default';
