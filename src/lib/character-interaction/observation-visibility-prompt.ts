/** Semantic audience guidance. These rules do not alter facts, audiences,
 * discovery eligibility or the independent review verdict. */
export function chatObservationVisibilityGenerationRulesV1(version: string | undefined): string[] {
  if (!['chat-situation-construction-v12', 'chat-situation-construction-v13', 'chat-situation-construction-v14', 'chat-situation-construction-v15', 'chat-situation-construction-v16', 'chat-situation-construction-v17', 'chat-situation-construction-v18', 'chat-situation-construction-v19', 'chat-situation-construction-v20', 'chat-situation-construction-v21'].includes(version ?? '')) return []
  return [
    'observation-result 中，动作的听众与结果的知情者分别判断。看见角色检查、站在同一地点或知道检查对象，不等于看清角色检查所得。逐项按实际观察条件确定普通 newFacts 的 audienceKeys；引用的事实对听众可知只是必要条件，不证明听众亲见了结果。有依据的共同可见开合、声音等普通结果可保持共享，不把所有观察机械改为私有。',
    '既定事实的发现只通过 discoveries 更新原 factKey 的调查角色知识，不在 newFacts 重述、改编号或间接暗示该秘密；即使仅给调查角色也不另造同义事实。公开描述“已核对到目标”等也可能透露结果。若 discoveries 已具体结算本次问题，newFacts 可以为 []；普通共同可见结果如需补充，应与私有发现分开。只有原条件实际满足才 discovered，负面或不确定结论仍限定实际检查范围。后续是否告知玩家由角色另行表达并登记披露，不在本步替角色说出答案。',
  ]
}

export function chatObservationVisibilityReviewRulesV1(version: string | undefined): string[] {
  if (!['chat-situation-review-v11', 'chat-situation-review-v12', 'chat-situation-review-v13', 'chat-situation-review-v14', 'chat-situation-review-v15', 'chat-situation-review-v16', 'chat-situation-review-v17', 'chat-situation-review-v18', 'chat-situation-review-v19'].includes(version ?? '')) return []
  return [
    'observation-result 的 visibility 逐项核对结果实际知情者，不能从动作公开、同处一地或共同知道调查对象推定大家看见结果。普通观察可以对有实际观察依据的听众共享，不要求一律私有；但公开事实、标题和措辞不得直接或间接透露仅调查角色获知的既定事实，引用编号合法不能代替语义判断。',
    '既定秘密由 discoveries 更新原事实知识，不接受 newFacts 中公开或私有的同义副本。若发现判定已在实际检查范围内给出具体所得，newFacts=[] 本身不是 meaningful-direction 失败，不要求额外写公开答案或提前安排角色披露；有依据的有限负面结果也可成立。不以此豁免真实发现条件、空转、无依据不确定或未完成动作，仍逐项独立审查，不改候选或听众来放行。',
  ]
}
