/**
 * Shared P0 acceptance boundary. Source freezing, Creator handoff and
 * Production Plan budgeting must all consume these exact values so a source
 * cannot be accepted by one layer and become uncheckpointable in another.
 */
export const TEXT_OPEN_WORLD_SOURCE_PIN_LIMITS_V1 = Object.freeze({
  maximumUnits: 512,
  maximumTotalChars: 4_000_000,
})
