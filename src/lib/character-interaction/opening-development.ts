import {parseChatOpeningAgencyV2, type ChatOpeningAgencyV2} from './opening-agency'
import type {ChatSituationCandidatesV1} from './narrative-production'

/** A review witness, never a runtime fact or a guaranteed story outcome. */
export const CHAT_OPENING_DEVELOPMENT_GATE_V3 = 'chat.opening-development.v3'
export interface ChatOpeningDevelopmentV3 {
  mode: 'direct' | 'adaptive' | 'conversation' | 'wait'
  possibilityIndex: number
  basisFactKeys: string[]
  expectedChange: string
  unresolved: string
}

export function parseChatOpeningDevelopmentV3(value: unknown, option: ChatSituationCandidatesV1['options'][number], agency: ChatOpeningAgencyV2): ChatOpeningDevelopmentV3 {
  const fail = (message: string): never => {throw new Error(`[chat-opening-development] ${message}`)}
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'basisFactKeys,expectedChange,mode,possibilityIndex,unresolved') fail('发展依据字段不完整')
  const row = value as Record<string, unknown>
  if (typeof row.mode !== 'string' || !['direct', 'adaptive', 'conversation', 'wait'].includes(row.mode)) fail('发展依据模式无效')
  // Reuse the exact candidate/actor/goal/visible-fact checks of the first entry.
  parseChatOpeningAgencyV2({...row, actorKey: agency.actorKey, goalKey: agency.goalKey, mode: row.mode === 'wait' ? 'wait' : 'act'}, option)
  if ((row.mode === 'wait') !== (agency.mode === 'wait')) fail('合理等待须有当前等待依据，不能假设尝试失败后无路可走')
  if (row.mode === 'adaptive' && (row.possibilityIndex === agency.possibilityIndex
    || option.situation.possibilities[Number(row.possibilityIndex)].text.trim() === option.situation.possibilities[agency.possibilityIndex].text.trim())) fail('后续办法不能重复首个方向')
  return structuredClone(value) as ChatOpeningDevelopmentV3
}

export const CHAT_OPENING_DEVELOPMENT_REVIEW_RULE_V3 = `每个候选新增 development，绑定同一 agency.actorKey 和 goalKey，用来核验“这段局面为何足以演绎”，不是重述第一步能做什么。open-development 通过必须有 development；依据不足时 development=null、open-development=false，保留具体原因，不代替候选创作。
development={"mode":"direct|adaptive|conversation|wait","possibilityIndex":0,"basisFactKeys":["方向实际引用且该角色已知的事实"],"expectedChange":"这些具体条件怎样支持原事项的实质变化","unresolved":"尚未知的结果、真实阻碍和仍需决定或授权的条件"}。最多三项事实；open-development.evidence 分别引用该 possibility.text 和每项 basisFact 的 text，不能只引用原目标、收束愿望或来源中的幕后答案。
direct：现有条件已支持直接处理原事项；逐一核对从当前入口到处理原事项所依赖的接触、使用或询问条件。能看到物件不等于能打开，存在资料不等于它有相关内容，知道有某人不等于此人在场或可询问。未成立的后续权限和接触条件必须保留未知，不能据此判 direct 通过。幕后已写定的答案及其发现条件，仅表示真相存在，不证明角色具备抵达它的条件。
adaptive：首步仅能局部尝试时，选一个不同于 agency.possibilityIndex 的已有方向；其已知背景应支持不同问题、信息来源、取舍或关系需要。仅改变玩家旁观方式、重问同一许可、检查相邻位置或对同一动作换说法，不算独立办法。相同事实可能支持不同办法，事实数量不是质量指标；语义差异由你结合原文独立判断。
conversation：原事项本就是相处、表达、协商或关系需要，具体共同经历、关切或资源能支持真实互动；不能把尚未处理的调查目标改叫闲聊以通过。wait：agency 也须为 wait，且当前已有具体阻碍、休息或陪伴需要；不得把任何行动都可能失败当作当前只能等待。
四种模式均不预定结果、不保证成功，也不强造备用路线。expectedChange/unresolved 不得夹带该角色未知的答案；玩家拒绝、改变方向与真实选择保持开放。development 只供作者审查，不授予角色新知识、权限或行动。
`
