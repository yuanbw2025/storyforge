/** Capacity evaluation reuses production batching with original fixtures only; it has no DB/write authority. */
export function assertOfflineReferenceCapacityEntry(registry) {
  const entry = registry.offlineEvaluations?.find(row => row.entryId === 'eval.reference.service-capacity')
  if (!entry || entry.boundary !== 'eval-only' || entry.adoptAllowed !== false || entry.adoptionTargets?.length
    || entry.caller !== 'scripts/evaluate-reference-capacity.mjs' || entry.contract !== 'scripts/reference-capacity-contract.mjs'
    || entry.transport !== 'configured-chat-text-v1') throw Error('Missing read-only reference capacity evaluation contract')
}
