export const CHAT_MEMORY_CORRECTION_ACTION_RULES_V1 = [
  'memoryCorrections 是尚待本次行动核对的玩家修正摘要，每项附双方可见的真实原话。先对照来源和当前确定事实；修正本身不创造事实、同意、权限或已兑现承诺。若摘要与原话或确定事实矛盾，不把它当真，不为通过核对编造证据。',
  '检查自己的旧打算、猜测、目标及当前态度是否仍依赖被修正的误解。需要时通过 nextPossibilities、beliefUpdates、goalStatus/goalUpdates 调整自己的后续方向，依据仍引用已有可知事实；正文承认修正但保留相反打算不算处理。没有相关影响时可保持原状态，不强行插入道歉、解释系统或新的矛盾。自然回应当前情境并留下有意义、可改变的方向。',
  '修正摘要不授权撤销已发生事实、承诺或关系历史，不把旧错误自动当成新玩家行为。关系变化仍须本轮真实玩家消息和实际表达的依据；不能沿用已纠正误解来惩罚玩家，也不能仅因收到修正奖励关系。',
]

export const CHAT_MEMORY_CORRECTION_REVIEW_RULES_V1 = [
  '对 memoryCorrections 中属于本行动 actorKey 的每项待处理修正，独立给 memoryChecks={memoryId,sourceSequence,passed,reason}，必须完整覆盖其稳定ID和修正事件。先核对完整共同来源及确定事实，再审正文、保留或修改后的打算/猜测、目标和关系影响；摘要不是事实或新权限。来源不足、摘要与来源相反、正文仍依赖旧误解，或口头改口却保留冲突打算，均须 passed=false。',
  '具体说明本次行动如何消除该误解对后续行为的影响，或为什么与这次行动及保留状态无关。不得因为出现了“明白”“已纠正”等字眼就通过，也不要求强行改动无关目标或每次复述修正。旧摘要未提供时不能猜测其内容；以修正、真实原话和当前状态判断是否一致。不能自动回滚已发生事实、承诺和关系，不替玩家改变感受或同意。两条互斥候选必须各自完整核对，不共享其中一条的通过结论。',
]

export function chatMemoryCorrectionReviewSchemaV1(options: boolean): string {
  return (options
    ? '仅输出 JSON {"options":[{"optionKey":"option-1","checks":[],"disclosureChecks":[],"commitmentChecks":[],"memoryChecks":[]},{"optionKey":"option-2","checks":[],"disclosureChecks":[],"commitmentChecks":[],"memoryChecks":[]}]}。'
    : '仅输出 JSON {"checks":[],"disclosureChecks":[],"commitmentChecks":[],"memoryChecks":[]}。')
    + '每条 checks 包含 continuity、permissions、player-agency、visibility、consequences、meaningful-direction 六项各一次 {check,passed,reason}；disclosureChecks 对每个等义转述给 {factKey,passed,reason}；commitmentChecks 对每个承诺变化原数组索引给 {effectIndex,passed,reason}；memoryChecks 对每项待处理修正给 {memoryId,sourceSequence,passed,reason}。没有对应项则 []。不得缺项、修改候选或增加字段。'
}
