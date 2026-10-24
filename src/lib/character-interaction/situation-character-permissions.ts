/** These instructions apply only to new frozen bindings. They clarify semantic
 * checks; they do not grant creative permission or replace structural guards. */
export function chatSituationCharacterRulesV1(version: string | undefined): string[] {
  if (!['chat-situation-construction-v9', 'chat-situation-construction-v10', 'chat-situation-construction-v11', 'chat-situation-construction-v12', 'chat-situation-construction-v13', 'chat-situation-construction-v14', 'chat-situation-construction-v15', 'chat-situation-construction-v16', 'chat-situation-construction-v17', 'chat-situation-construction-v18', 'chat-situation-construction-v19', 'chat-situation-construction-v20', 'chat-situation-construction-v21'].includes(version ?? '')) return []
  return [
    '人物权限按实际语义判断，不按 newFacts.kind 标签判断。没有 temporary-character 权限时，不得在 observation 中新造伙计、路人、传话者或匿名应答者；听到某人说话、让其出现或行动，同样可能是在引入人物。物品的用途、招牌、摇铃或呼唤只证明条件或动作，不自动授予新增人物权限，也不保证有人回应。',
    '严格区分已确立的人物身份、此刻在场可接触、知情和愿意回答。来源中曾提及某人，只能证明原文实际确立的内容，不能据此补造其当前到场、行动、意愿或知识。幕后来源不能直接成为角色或玩家的可见人物依据；秘密与历史仍按冻结发现条件处理。已由当前可见事实确立在场且可交谈的背景人物可以承接真实互动，无须再创建人物，但不能替玩家或可调度角色作答。',
    'pendingSituation.purpose=observation-result 只结算已完成观察的范围，不能借观察结果建立新人物，即使一般权限允许 temporary-character 也不例外。需要创建获准的临时人物时，须在另一次有依据的普通情境构建中按 temporary-character 登记并审查，不能把意向当作已发生。没有这种权限则在已有条件内换办法，不靠改标签或换成匿名声音绕过。',
    '只确认本次实际听见或看见的有限部分，并保留尚未知的范围。不得为避开人物权限而强制写成永久无人、所有人拒答或调查无路可走；也不得因为输入没有答案而重复等待同一个结果。选择符合已知事实和冻结权限的具体局部结果，把后续办法留给角色决定，不保证获得线索或成功。',
    '如果待处理的是已对在场背景人物实际提出的问题，并且有 allowInquiryResults 权限，使用 inquiryResult 及其人物、提问、听众和发现证据约束；不能把叫人、摇铃、计划提问直接改成实际询问结果，也不能以普通 observation 绕过答复审查。',
  ]
}

export function chatSituationCharacterReviewRulesV1(version: string | undefined): string[] {
  if (!['chat-situation-review-v8', 'chat-situation-review-v9', 'chat-situation-review-v10', 'chat-situation-review-v11', 'chat-situation-review-v12', 'chat-situation-review-v13', 'chat-situation-review-v14', 'chat-situation-review-v15', 'chat-situation-review-v16', 'chat-situation-review-v17', 'chat-situation-review-v18', 'chat-situation-review-v19'].includes(version ?? '')) return []
  return [
    'permissions 必须按实际内容识别人物引入，不能只看 kind=observation：新造伙计、路人、匿名声音或其行为均不能绕过 temporary-character 权限。摇铃、招牌或希望接触某人不授予人物创作权。observation-result 阶段即使通常允许临时人物，也不得借结算旧观察引入新人物；应检查是否在合适的情境步骤明确登记类型并获得授权。',
    '区分人物身份有来源、当前在场可交谈、知情范围及是否实际作答。来源提过某人不证明后三者；幕后提及不能直接成为公开人物依据。当前可见事实已确立的在场背景人物可以承接真实互动，但不能替玩家或可调度角色回应，不自动确认任何秘密。实际提问的 inquiryResult 仍需完整独立检查，摇铃、呼唤或打算问不能冒充问题。meaningful-direction 同时拒绝为回避权限而编造永久阻碍或重复无结果；合法有限观察可以保留未知，无须强造人物或保证线索。',
  ]
}
