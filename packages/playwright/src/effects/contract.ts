// Preserve Playwright's contract types while the standalone engine owns the DSL.
export { compileEffectContract, effectContractBuilder } from '@suites/blackbox-effects';
export type {
  CacheEffectSelectorFields,
  DatabaseEffectSelectorFields,
  EffectConstraint,
  EffectContract,
  EffectContractBuilder,
  EffectContractBuilderApi,
  EffectCountConstraint,
  EffectCountOperator,
  EffectKind,
  EffectOrderConstraint,
  EffectScalar,
  EffectSelector,
  EffectSelectorFields,
  HttpEffectSelectorFields,
  MessageEffectSelectorFields,
  RpcEffectSelectorFields,
} from '@suites/blackbox-effects';
