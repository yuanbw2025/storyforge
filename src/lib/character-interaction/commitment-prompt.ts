/** Product rules selected only for the new frozen producer/reviewer versions. */
export const CHAT_COMMITMENT_ACTION_RULES_V1 = [
  '先核对自身 goals 中的 commitments 和 sharedCommitments 中共同知晓的约定。resolution=null 表示尚未处理；在相关时机依据已知条件实际履行、说明具体阻碍或明确撤回，不反复重说承诺代替行动，不因为用户离开应用就认定迟到或失约。约定不会替玩家决定参与、情感或同意。',
  'commitmentEffects 默认 []，最多四项。只有本次对玩家明确作出的、可辨认履行条件的自身约定才用 {kind:"promise",terms:"逐字条款",evidenceExcerpt:"本次原话"}，terms 必须完整出现在摘录中；系统生成身份、听众和事件。普通意向、邀请、客套、推测和条件未定的提议不登记；不要为了填字段强造承诺。仅绑定自己的当前 active/paused 目标，同一目标只可有一个未处理承诺。',
  '实际履行旧承诺时用 {kind:"fulfill",commitmentKey:"原标识",evidenceExcerpt:"本次实际行为或交付的逐字证据"}；只有 kind=complete 且 waitingForPlayer=false 可履行。必须满足原条款，不用“已经办好”空话、下一步计划、一次尝试或玩家尚未做出的选择代替结果。明确撤回用 kind:"withdraw" 及原标识、撤回原话；不能因拒绝邀请或离线自动撤回或惩罚。',
  '改约必须同时明确 withdraw 原约并 promise 新条款，两份记录都保留；这只改变角色自己的承担，不表示玩家接受新安排。处置须包含原约全部听众，目标结束前必须履行或明确撤回未处理承诺。不要用完成整个 goal 代替处理具体约定；也不必为一次履约结束仍有其它事项的目标。所有摘录只来自本次 text。',
]

/** V2 clarifies when a future-condition undertaking is already established.
 * Older producers keep V1; this changes instructions, never review/adoption. */
export function supportsChatCommitmentPromptV2(version: string | undefined): boolean {
  return ['chat-narrative-action-v31', 'chat-narrative-options-v21', 'chat-action-revision-v13', 'chat-narrative-action-v32', 'chat-narrative-options-v22', 'chat-action-revision-v14', 'chat-narrative-action-v33', 'chat-narrative-options-v23', 'chat-action-revision-v15', 'chat-narrative-action-v34', 'chat-narrative-options-v24', 'chat-action-revision-v16', 'chat-action-revision-v17', 'chat-action-revision-v18', 'chat-action-revision-v19', 'chat-action-revision-v20', 'chat-action-revision-v21', 'chat-action-revision-v22', 'chat-action-revision-v23', 'chat-action-revision-v24', 'chat-action-revision-v25', 'chat-narrative-action-v35', 'chat-narrative-options-v25', 'chat-narrative-action-v36', 'chat-narrative-action-v37', 'chat-narrative-action-v38', 'chat-narrative-action-v39', 'chat-narrative-action-v40', 'chat-narrative-action-v41', 'chat-narrative-action-v42', 'chat-narrative-action-v43', 'chat-narrative-action-v44', 'chat-narrative-action-v45', 'chat-narrative-action-v46', 'chat-narrative-action-v47', 'chat-narrative-action-v48', 'chat-narrative-action-v50', 'chat-narrative-action-v51', 'chat-narrative-action-v52', 'chat-narrative-action-v53', 'chat-narrative-action-v54', 'chat-narrative-action-v55', 'chat-narrative-action-v56', 'chat-narrative-action-v57', 'chat-narrative-action-v58', 'chat-narrative-action-v59', 'chat-narrative-action-v60', 'chat-narrative-action-v61', 'chat-narrative-action-v62', 'chat-narrative-action-v63', 'chat-narrative-action-v64', 'chat-narrative-action-v65', 'chat-narrative-action-v66', 'chat-narrative-action-v67', 'chat-narrative-action-v68', 'chat-narrative-action-v69', 'chat-narrative-action-v70', 'chat-narrative-action-v71', 'chat-narrative-action-v72', 'chat-narrative-options-v26', 'chat-narrative-options-v27', 'chat-narrative-options-v28', 'chat-narrative-options-v29', 'chat-narrative-options-v30', 'chat-narrative-options-v31', 'chat-narrative-options-v32', 'chat-narrative-options-v33', 'chat-narrative-options-v34', 'chat-narrative-options-v35', 'chat-narrative-options-v36', 'chat-narrative-options-v37', 'chat-narrative-options-v38', 'chat-narrative-options-v39', 'chat-narrative-options-v40', 'chat-narrative-options-v41', 'chat-narrative-options-v42'].includes(version ?? '')
}

export const CHAT_COMMITMENT_ACTION_RULES_V2 = [
  CHAT_COMMITMENT_ACTION_RULES_V1[0],
  '先根据本次实际 text 判断是否成立、履行、撤回或改动自己的约定，再填写 commitmentEffects（最多四项）；确实没有变化才用 []。新约定用 {kind:"promise",terms:"完整逐字条款",evidenceExcerpt:"本次原话"}；terms 必须完整出现在摘录中，系统生成身份、听众和事件。仅绑定自己的当前 active/paused 目标，同一目标只能有一个未处理承诺，不替玩家或别人承担。',
  '约定成立的时点与履行条件发生的时点不同：角色现在明确接受的后续义务或持续限制已经成立，即使将来某个条件出现时才需履行。例如“转交资料之前我会先征求你的同意”已经约束自己的后续行为；不能因尚未转交就把它当作未定提议。核对完整范围、触发条件和保留给玩家的决定，不只截取“我会”或“好的”。',
  '仅描述本次已经完成的行为或当前动作范围，不自动成为以后仍须遵守的承诺；“如果你愿意，我们可以再商量”这类尚未明确承担的提议、普通打算、邀约、客套和猜测也不登记。不要为了填字段强造承诺，也不要删掉自然成立的约定来规避登记。明确作出的声明可用 speak/complete；等待玩家回答另一件事不推迟已经作出的声明，但不能把等待中的事项登记为履约。',
  CHAT_COMMITMENT_ACTION_RULES_V1[2],
  CHAT_COMMITMENT_ACTION_RULES_V1[3],
]

export const CHAT_COMMITMENT_OUTPUT_CHECK_V2 = '输出前以每条候选完整 text 为准复核 commitmentEffects：已明确接受的未来义务、先征求同意或持续限制须保留完整条款；只有当前动作范围或未定提议则不强造承诺。示例空数组不等于本次无需登记。修订或历史编辑仍保留规定不可改的正文及玩家选择边界，不借核对增加新台词；不要输出核对过程或额外字段。'

export const CHAT_COMMITMENT_REVIEW_RULES_V1 = [
  '承诺专审：先读本次正文，再核对 commitmentEffects 与自身目标中的原 commitments。明确的新约定、实际履行或明确撤回若漏记，在 consequences 判失败；普通计划、客套、邀约或条件未定的提议不得硬登记成承诺。不能只凭类型、摘录相符或摘要里写着“答应”就通过。',
  '对每个 commitmentEffects 的原数组索引给出 commitmentChecks={effectIndex,passed,reason}。promise 要有完整、明确、可履行的自身条款，适合当前目标和动机，不能替玩家或别人承担；fulfill 要逐项对照原 terms 与本次已完成行为/交付，确认范围、时点和必要条件，不接受自称完成却无实际依据、只完成部分、语义偷换、意向、尝试或等待选择。withdraw 必须实际明确撤回原约，不能因玩家拒绝、休息或离线推断失约。',
  '改约须明确处置旧约并形成新约，分别审查两项，不能抹去原历史、默认玩家接受或自动改变关系。等待玩家回答另一件事不妨碍已经明确作出的无条件声明/撤回，但不得把待玩家同意的条件约定记成已成立；履约仍不可等待玩家。公开条款及摘录不得夹带角色私有动机或未知秘密。任一项不通过时整条候选不采用。',
]
