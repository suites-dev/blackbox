import type {
  EffectConstraint,
  EffectContract,
  EffectScalar,
  EffectSelector,
} from '../../effects/contract.js';

const contractLimits = Object.freeze({ constraints: 64, selectorWhereEntries: 16 });

export interface EffectContractAttachment {
  readonly schemaVersion: 1;
  readonly constraints: readonly EffectConstraint[];
  readonly omitted: {
    readonly constraints: number;
    readonly selectorWhereEntries: number;
  };
}

function selector(input: EffectSelector): {
  readonly value: EffectSelector;
  readonly omittedWhereEntries: number;
} {
  const entries = Object.entries(input.where ?? {});
  const where = Object.fromEntries(entries.slice(0, contractLimits.selectorWhereEntries)) as Readonly<
    Record<string, EffectScalar>
  >;
  return {
    value: 'where' in input ? { ...input, where } : input,
    omittedWhereEntries: Math.max(0, entries.length - contractLimits.selectorWhereEntries),
  };
}

function constraint(input: EffectConstraint): {
  readonly value: EffectConstraint;
  readonly omittedWhereEntries: number;
} {
  if (input.operator !== 'before') {
    const selected = selector(input.selector);
    return { value: { ...input, selector: selected.value }, omittedWhereEntries: selected.omittedWhereEntries };
  }
  const first = selector(input.first);
  const second = selector(input.second);
  return {
    value: { ...input, first: first.value, second: second.value },
    omittedWhereEntries: first.omittedWhereEntries + second.omittedWhereEntries,
  };
}

export function effectContractAttachment(contract: EffectContract): EffectContractAttachment {
  const constraints = contract.constraints.slice(0, contractLimits.constraints).map(constraint);
  return {
    schemaVersion: contract.schemaVersion,
    constraints: constraints.map(({ value }) => value),
    omitted: {
      constraints: Math.max(0, contract.constraints.length - constraints.length),
      selectorWhereEntries: constraints.reduce(
        (count, item) => count + item.omittedWhereEntries,
        0,
      ),
    },
  };
}
