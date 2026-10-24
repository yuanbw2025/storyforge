/** Clarify the existing authority to narrate ordinary self-actions. No inferred
 * result, new permission, skipped review, or retroactive prompt replacement. */
export function supportsChatOrdinarySelfActionV1(version: string | undefined): boolean {
  return ['chat-narrative-action-v63', 'chat-narrative-action-v64', 'chat-narrative-action-v65', 'chat-narrative-action-v66', 'chat-narrative-action-v67', 'chat-narrative-action-v68', 'chat-narrative-action-v69', 'chat-narrative-action-v70', 'chat-narrative-action-v71', 'chat-narrative-action-v72', 'chat-narrative-options-v39', 'chat-narrative-options-v40', 'chat-narrative-options-v41', 'chat-narrative-options-v42'].includes(version ?? '')
}

export const CHAT_ORDINARY_SELF_ACTION_SELECTION_RULE_V1 = '\n选择时区分具体的未决条件与泛泛的可能失败。unconfirmedConditions 只列确实影响本步的未知内容、真实阻碍、权限或他人决定；不能仅因动作尚未实施，就把“能否顺利做完尚待尝试”当成必须另开局面的条件。已有可见依据支持、权限明确且由角色自己控制的普通动作，可选择连贯完成这一局部目的，不必固定拆成尝试、确认是否成功、再复述结果。比如把自己手中的杯子放到已知可用的桌面上，可作为一次自身行动；未看过的容器内容、真实障碍、他人答复或玩家决定仍须保留各自判定边界。未写定失败不等于保证成功，不新增物件、许可或已完成结果；选择仍只是草稿，表达和独立审查决定能否采用。'

export const CHAT_ORDINARY_SELF_ACTION_RULE_V1 = '本次生成的是叙事候选，不要求先有一条“已经做完”的历史记录才可描写角色自己的新动作。对已有条件、权限和能力足以支持的普通自身行动，可在 text 中连贯演绎实际完成并登记 newFacts 及相应目标/事项后果；仍须原独立审查通过并采用后才发生。仅因尚未实施、人物谨慎或抽象地可能失败，不必把每次拿放、移动等普通动作都改成尝试加 observation-result；同一局部目的下不依赖新决定或未知内容的短动作可以连贯完成。不得由此保证困难行动成功、忽略实际危险或阻碍、虚构许可或预写玩家/他人选择。隐藏内容、未获知的既定事实、真实未决结果及他人答复仍沿原观察/发现/询问路径；确需有限尝试时保留其范围和停止条件，不能在普通动作中夹带未知发现。'

export const CHAT_ORDINARY_SELF_ACTION_PROPOSAL_RULE_V1 = '选择草稿列出的 unconfirmedConditions 也只是建议，不会自行确立一个阻碍。表达须按原始可见资料区分具体未决条件与泛泛的可能失败；在已有权限和条件内，可完整演绎自己的普通行动并登记后果，不能机械继承无依据的额外判定步骤。真正未知的内容、玩家决定和他人反应仍不得预定。'
