/**
 * Conservative limits for the initial internal admission boundary, matching the
 * bounded scope investigation. These are rejection thresholds, not sampling or
 * completeness guarantees. Public fixture sizing remains a separate decision.
 * Payload bytes include duplicate arrivals; record bytes include resource/scope.
 */
export const activityAdmissionLimits = Object.freeze({
  registeredActivities: 256,
  selectedTraces: 8,
  spanIdentities: 256,
  payloadBytes: 256 * 1024,
  recordBytes: 32 * 1024,
});
