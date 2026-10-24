/** New player situations need usable circumstances, not a prescribed plot.
 * Historical contracts, discovery permissions and settlement scopes stay frozen. */
export const CHAT_SITUATION_DEVELOPMENT_PRODUCER_V1 = 'chat-situation-construction-v19'
export const CHAT_SITUATION_DEVELOPMENT_REVIEWER_V1 = 'chat-situation-review-v18'

export function chatSituationDevelopmentGenerationRulesV1(version: string | undefined): string[] {
  if (version !== CHAT_SITUATION_DEVELOPMENT_PRODUCER_V1 && version !== 'chat-situation-construction-v20' && version !== 'chat-situation-construction-v21') return []
  return [
    '新情境背景准备：仅 constructionRequest.origin=player-request 或 player-followup 时，先确定原请求中的事情为何值得角色介入，以及目前哪些具体条件可供实际互动，再填写目标与可能方向。只复述种子中的现象，并附上“询问、检查、等待”的打算，不足以形成可演绎背景。可复用现有事实，也可在 allowedNewFactKinds 与数量限制内补足尚未写定的普通人物、物件或条件；不得重写原真相、把未知答案公开或另起无关危机。',
    '把支撑互动的当前条件写入 newFacts 或引用既有 facts，把角色尚未实施的办法写入 possibilities。若方向依赖与某人接触，应有受权限允许、角色可知的当前接触条件，不能把幕后存在、一个声音或未来肯定有人回应当成条件已经齐备；有 temporary-character 权限时，可在这次普通背景构建中明确登记合适的临时人物，不把人物藏入 observation。没有人物权限则依可用的既有条件安排方向，不暗增权限。此处准备接触条件不等于预写对方回答、合作或行动成功。',
    '新背景应让角色有依据地采取能改变信息、选择、目标或关系的行动；第一种办法若暂时得不到结果，不应仅因构建时没有准备内容就立即退化为原地重复或无路可走。必要时准备一个实质不同的可行条件，直接处理、日常互动和已有依据的等待则按实际需要即可，不凑事实数量或固定分支数。拒绝、暂停、未知与失败仍可以发生，不预写整个故事、玩家参与或必胜结局。这项背景准备不适用于既有 observation-result、inquiryResult 或 discovery 的结果结算，不得据此给旧观察追加人物、动作或答案。',
  ]
}

export function chatSituationDevelopmentReviewRulesV1(version: string | undefined): string[] {
  if (version !== CHAT_SITUATION_DEVELOPMENT_REVIEWER_V1 && version !== 'chat-situation-review-v19') return []
  return [
    '新情境背景审查：仅 constructionRequest.origin=player-request 或 player-followup 时，在 meaningful-direction 中核对候选的实际 newFacts、既有 facts、目标和 possibilities：哪些当前条件支持角色处理原事项，如何带来信息、选择、目标或关系变化？reason 引用决定性条件并解释其作用；只出现新现象加“去问、去看、等回应”的意向，没有支撑互动的具体背景时应判不通过。不能替候选补写条件、假定下轮会凭空生成内容，或以未来语气规避检查。',
    '分别检查条件存在、角色可知、能够接触与未来结果。人物的幕后存在、声音、名字或愿望本身不证明已具备接触和回应条件；获准临时人物应在普通新背景中明确登记，不能隐入 observation 或在后续观察结算时补造。既定秘密、发现条件、私聊、人物类型与数量权限继续约束背景和每个可见字段；背景完整性不得替代这些检查。',
    '不把第二条路线、更多事实、必然合作或成功当作硬指标：可直接处理的事情、自然伴聊、已有具体依据的等待都可能充分。真实拒绝、局部无结果与暂停仍可成立；本要求只检查新背景是否准备了实际可演绎条件，不据此否定合法 observation-result、inquiryResult、discovery 结算或迫使角色每轮制造进展。',
  ]
}
