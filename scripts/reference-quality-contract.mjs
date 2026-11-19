export const REFERENCE_QUALITY_ENTRY = 'eval.reference.content-quality'
export const REFERENCE_QUALITY_MAX_CALLS = 28
/**
 * @typedef {{entryId?: string, boundary?: string, adoptAllowed?: boolean,
 * adoptionTargets?: readonly unknown[], caller?: string, contract?: string,
 * transport?: string}} ReferenceOfflineEntry
 */
/** @param {{offlineEvaluations?: ReferenceOfflineEntry[]}} registry */
export function assertOfflineReferenceEntry(registry) {
  const entry = registry.offlineEvaluations?.find(row => row.entryId === REFERENCE_QUALITY_ENTRY)
  if (!entry || entry.boundary !== 'eval-only' || entry.adoptAllowed !== false || entry.adoptionTargets?.length
    || entry.caller !== 'scripts/evaluate-reference-quality.mjs' || entry.contract !== 'scripts/reference-quality-contract.mjs'
    || entry.transport !== 'configured-chat-text-v1') throw Error('Missing read-only reference evaluation contract')
}
