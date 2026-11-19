export const PREPARATION_WORLDVIEW_MAX_CALLS = 24
export function assertPreparationWorldviewEvalEntry(registry) {
  const entry = registry.offlineEvaluations?.find(row => row.entryId === 'eval.longform.preparation-worldview')
  if (!entry || entry.boundary !== 'eval-only' || entry.adoptAllowed !== false || entry.adoptionTargets?.length || entry.caller !== 'scripts/evaluate-preparation-worldview.mjs' || entry.contract !== 'scripts/preparation-worldview-contract.mjs' || entry.transport !== 'configured-chat-text-v1') throw Error('Missing read-only evaluation contract')
}
