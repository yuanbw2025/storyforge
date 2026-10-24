import type {ChatSituationCandidatesV1} from './narrative-production'

/** Frozen plan gate; old plans and review receipts retain their v1 meaning. */
export const CHAT_OPENING_AGENCY_GATE_V2 = 'chat.opening-grounded-agency.v2'
export interface ChatOpeningAgencyV2 {
  actorKey: string
  goalKey: string
  possibilityIndex: number
  basisFactKeys: string[]
  mode: 'act' | 'wait'
  expectedChange: string
  unresolved: string
}
export function parseChatOpeningAgencyV2(value: unknown, option: ChatSituationCandidatesV1['options'][number]): ChatOpeningAgencyV2 {
  const fail = (message: string): never => {throw new Error(`[chat-opening-agency] ${message}`)}
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('缺少可核验的行动机会')
  const row = value as Record<string, unknown>
  if (Object.keys(row).sort().join(',') !== 'actorKey,basisFactKeys,expectedChange,goalKey,mode,possibilityIndex,unresolved') fail('行动机会字段不完整')
  const goal = option.situation.goals.find(g => g.goalKey === row.goalKey && g.actorKey === row.actorKey)
  if (!goal || !Number.isInteger(row.possibilityIndex) || Number(row.possibilityIndex) < 0) fail('行动机会的角色、目标或方向无效')
  const direction = option.situation.possibilities[Number(row.possibilityIndex)]
  if (!direction || direction.actorKey !== row.actorKey) fail('行动机会必须绑定该角色的实际方向')
  if (row.mode !== 'act' && row.mode !== 'wait') fail('行动机会模式无效')
  if (!Array.isArray(row.basisFactKeys) || !row.basisFactKeys.length || row.basisFactKeys.length > 3 || new Set(row.basisFactKeys).size !== row.basisFactKeys.length) fail('行动机会需要一至三项不重复的事实依据')
  for (const key of row.basisFactKeys as unknown[]) {
    const fact = option.situation.facts.find(f => f.factKey === key)
    if (!fact || !fact.audienceKeys.includes(String(row.actorKey)) || !direction.evidenceFactKeys.includes(String(key))) fail('行动机会不得借用未知、其他角色或方向未引用的事实')
  }
  for (const key of ['expectedChange', 'unresolved'] as const) if (typeof row[key] !== 'string' || !row[key].trim() || row[key].length > 600) fail('行动机会的预期变化和未知条件必须明确且有界')
  return structuredClone(value) as ChatOpeningAgencyV2
}

export const CHAT_OPENING_AGENCY_CREATION_RULE_V2 = '为原目标准备至少一个当前可接触、可执行且可能改变信息、选择、关系或处境的具体入口，写入 facts 与对应 possibilities。只有纸笔、泛称“查看公共区域”或“找个人问问”，不能单独证明存在这样的机会；指明已成立的对象/条件，以及角色实际能核实的问题。人物存在不等于在场、可接触、知情或愿意回答；未知条件只能保留未知。可以在作者许可与来源约束内起草普通背景，但不能泄露既定隐情、替换发现条件、制造未获准人物或预写行动结果。角色可从该入口尝试并依据实际结果换办法，不把一个方向写成唯一解法；陪伴、合理等待和暂缓也须有对应人物动机及当前依据，不强造冲突或保证成功。'
export const CHAT_OPENING_AGENCY_REVIEW_RULE_V2 = `本次逐项核对可行动机会，并在每个 optionKey 的 checks 之外返回 agency。viable-agency 通过时 agency 必须为 {"actorKey":"角色标识","goalKey":"该角色已有目标","possibilityIndex":0,"basisFactKeys":["该方向实际引用且角色已知的事实"],"mode":"act|wait","expectedChange":"本步能够核实或改变的具体问题，不是保证发生的结果","unresolved":"仍未知、可能失败或需要另行授权的部分"}；未找到成立的机会则 agency=null 并判 viable-agency=false。
act 须有当前可接触的对象、条件或互动入口，能针对原目标改变信息、选择、关系或处境。仅记笔记、商量、泛称可调查某区域，或在未知的对象/结果之间继续等待，不足以证明信息机会成立；准备可以是第一步，但须有后续实际入口的依据。不能把“可以试着找个人”审成“已有在场知情者可问”，也不能靠审查者的幕后答案倒推路线。wait 允许已有实际阻碍、人物需要或自然陪伴支持的等待/暂缓；不得要求穷尽想象中的所有办法。两种模式都允许失败、改道和玩家拒绝，不保证任务必达。
basisFactKeys 必须为一至三项不重复的已有事实，属于该方向的 evidenceFactKeys，且 actorKey 确实知情。viable-agency.evidence 必须分别引用该 possibility.text 和每项依据事实的 text，使用准确 JSON Pointer 与连续原文摘录；不能以目标愿望或无关纸笔替代入口证据。系统校验身份、引用和知情范围，你仍须独立判断依据是否真的支持所述机会、预期变化与未知限制。其余四项仍全部审查；agency 不授予新权限、不生成新背景、不写入运行事实。`
