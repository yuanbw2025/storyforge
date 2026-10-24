/** System-owned event metadata, never part of the model's action object. An
 * absent version preserves the historical two-call action/review allowance. */
export function parseChatActionChoiceVersionV1(value: unknown): 1 | undefined {
  if (value === undefined || value === 1) return value
  throw new Error('[chat-action-choice] 行动选择版本无效')
}

export function chatReviewedActionAllowanceV1(value: unknown): 2 | 3 {
  return parseChatActionChoiceVersionV1(value) === 1 ? 3 : 2
}

/** Freeze accounting to the actual run recipe, not the currently selected
 * Skill or a model-provided cost. The transaction checks the same run prefix. */
export function chatActionChoiceVersionForContractV1(contract: {
  executionBindings?: ReadonlyArray<{stepId: string; skillId: string; promptVersion: string}>
  budget: {maxModelCalls: number; maxAttemptsPerStep: number}
}): 1 | undefined {
  const bindings = contract.executionBindings ?? []
  const choices = bindings.filter(binding => binding.stepId === 'interaction:action-choice')
  if (!choices.length) return undefined
  const actions = bindings.filter(binding => binding.stepId === 'interaction:runtime-candidate')
  const reviews = bindings.filter(binding => binding.stepId === 'interaction:action-review')
  if (choices.length !== 1 || actions.length !== 1 || reviews.length !== 1
    || [choices[0], actions[0]].some(binding => binding.skillId !== 'character.chat-narrative-action' || !['chat-narrative-action-v45', 'chat-narrative-action-v46', 'chat-narrative-action-v47', 'chat-narrative-action-v48', 'chat-narrative-action-v50', 'chat-narrative-action-v51', 'chat-narrative-action-v52', 'chat-narrative-action-v53', 'chat-narrative-action-v54', 'chat-narrative-action-v55', 'chat-narrative-action-v56', 'chat-narrative-action-v57', 'chat-narrative-action-v58', 'chat-narrative-action-v59', 'chat-narrative-action-v60', 'chat-narrative-action-v61', 'chat-narrative-action-v62', 'chat-narrative-action-v63', 'chat-narrative-action-v64', 'chat-narrative-action-v65', 'chat-narrative-action-v66', 'chat-narrative-action-v67', 'chat-narrative-action-v68', 'chat-narrative-action-v69', 'chat-narrative-action-v70', 'chat-narrative-action-v71', 'chat-narrative-action-v72'].includes(binding.promptVersion))
    || choices[0].promptVersion !== actions[0].promptVersion
    || actions[0].promptVersion === 'chat-narrative-action-v46' && reviews[0].promptVersion !== 'chat-narrative-action-review-v33'
    || ['chat-narrative-action-v47', 'chat-narrative-action-v48', 'chat-narrative-action-v50', 'chat-narrative-action-v51'].includes(actions[0].promptVersion) && reviews[0].promptVersion !== 'chat-narrative-action-review-v34'
    || ['chat-narrative-action-v52', 'chat-narrative-action-v53', 'chat-narrative-action-v54', 'chat-narrative-action-v55', 'chat-narrative-action-v56'].includes(actions[0].promptVersion) && reviews[0].promptVersion !== 'chat-narrative-action-review-v35'
    || actions[0].promptVersion === 'chat-narrative-action-v57' && reviews[0].promptVersion !== 'chat-narrative-action-review-v36'
    || ['chat-narrative-action-v58', 'chat-narrative-action-v59', 'chat-narrative-action-v60'].includes(actions[0].promptVersion) && reviews[0].promptVersion !== 'chat-narrative-action-review-v37'
    || (actions[0].promptVersion === 'chat-narrative-action-v61' || (actions[0].promptVersion === 'chat-narrative-action-v62' || actions[0].promptVersion === 'chat-narrative-action-v63')) && reviews[0].promptVersion !== 'chat-narrative-action-review-v38'
    || actions[0].promptVersion === 'chat-narrative-action-v64' && reviews[0].promptVersion !== 'chat-narrative-action-review-v39'
    || (actions[0].promptVersion === 'chat-narrative-action-v66' || (actions[0].promptVersion === 'chat-narrative-action-v67' || (actions[0].promptVersion === 'chat-narrative-action-v68' || actions[0].promptVersion === 'chat-narrative-action-v69'))) && reviews[0].promptVersion !== 'chat-narrative-action-review-v41'
    || ['chat-narrative-action-v70', 'chat-narrative-action-v71', 'chat-narrative-action-v72'].includes(actions[0].promptVersion) && reviews[0].promptVersion !== 'chat-narrative-action-review-v42'
    || actions[0].promptVersion === 'chat-narrative-action-v65' && reviews[0].promptVersion !== 'chat-narrative-action-review-v40'
    || reviews[0].skillId !== 'character.chat-narrative-action-review'
    || contract.budget.maxModelCalls !== 3 || contract.budget.maxAttemptsPerStep !== 1) {
    throw new Error('[chat-action-choice] 行动选择步骤与冻结预算合同不一致')
  }
  return 1
}
