import {canonicalStringify} from '../agent/run/hash'
import {parseChatAuthoringSettings, type ChatAuthoringSettings} from './authoring-contract'

export const CHAT_PLAN_FIELDS = {
  playerRole: '玩家身份', openingSituation: '开场与当前矛盾', experience: '体验重点', contentBoundaries: '内容边界',
  targetPlayMinutes: '目标时长', maxTurns: '场景回合上限', replyBudget: '角色回复预算', maxMemoryEntries: '记忆上限', relationshipThreshold: '重大关系变化阈值',
  'narrative.personaName': '玩家称呼', 'narrative.location': '开场地点', 'narrative.timeLabel': '开场时间',
} as const
export type ChatPlanFieldV1 = keyof typeof CHAT_PLAN_FIELDS
/** Basic author-facing checklist; the production adapter still validates the complete Brief and source contract. */
export function chatPlanMissingInputsV1(settings: ChatAuthoringSettings, hasWorld: boolean): string[] {
  const count = settings.characters.length + (settings.version === 3 ? settings.privateCharacters?.length ?? 0 : 0)
  return [
    ...(!hasWorld ? ['选择冻结世界版本'] : []),
    ...(!settings.playerRole.trim() ? ['填写玩家虚构身份'] : []),
    ...(!settings.openingSituation.trim() ? ['填写开场情景或矛盾'] : []),
    ...(!count || settings.mode === 'single' && count !== 1 ? ['确认参与角色，单角色模式需要一人'] : []),
    ...(settings.version === 1 || !settings.sourceReview ? ['检查并确认角色资料知情范围'] : []),
  ]
}
export interface ChatPlanChangeV1 {
  field: ChatPlanFieldV1; value: string | number; reason: string
  basis: 'source' | 'proposal'
  evidence: Array<{fragmentKey: string; quote: string}>
}
export interface ChatPlanCandidateV1 {answer: string; changes: ChatPlanChangeV1[]}
export function chatPlanValuesV1(settings: ChatAuthoringSettings): Partial<Record<ChatPlanFieldV1, string | number>> {
  return Object.fromEntries(Object.keys(CHAT_PLAN_FIELDS).flatMap(field => {
    if (field.startsWith('narrative.')) return settings.version === 3 ? [[field, settings.narrative[field.slice(10) as 'personaName' | 'location' | 'timeLabel']]] : []
    return [[field, settings[field as keyof ChatAuthoringSettings]]]
  }))
}
export function applyChatPlanChangesV1(settings: ChatAuthoringSettings, changes: readonly Pick<ChatPlanChangeV1, 'field' | 'value'>[]) {
  const next = structuredClone(settings), seen = new Set<string>()
  for (const change of changes) {
    if (!Object.prototype.hasOwnProperty.call(CHAT_PLAN_FIELDS, change.field) || seen.has(change.field)) throw new Error('方案字段无效或重复')
    seen.add(change.field)
    if (change.field.startsWith('narrative.')) {
      if (next.version !== 3) throw new Error('旧版方案不支持主动叙事设置')
      Object.assign(next.narrative, {[change.field.slice(10)]: change.value})
    } else Object.assign(next, {[change.field]: change.value})
  }
  return parseChatAuthoringSettings(next)
}
/** Every registered settings write preserves identity, cast, source consent,
 * execution permissions and the author's public publication statements. */
export function assertChatPlanAdoptionV1(before: unknown, after: unknown) {
  const previous = parseChatAuthoringSettings(typeof before === 'string' ? JSON.parse(before) : before)
  const next = parseChatAuthoringSettings(typeof after === 'string' ? JSON.parse(after) : after)
  const allowed = applyChatPlanChangesV1(previous, Object.entries(chatPlanValuesV1(next)).map(([field, value]) => ({field: field as ChatPlanFieldV1, value: value!})))
  if (canonicalStringify(allowed) !== canonicalStringify(next)) throw new Error('方案采纳不能修改角色身份、来源、知情范围、运行权限或作品使用说明')
}
