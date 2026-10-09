import type { Capability } from './step-types.js';

/**
 * Capabilities this Blackbox runtime offers to library steps. None today:
 * effects verdicts stay gated until #26 and participant exec until #119 PW-5
 * or #39, so steps that need them are compile errors.
 */
export const OFFERED_CAPABILITIES: readonly Capability[] = [];
