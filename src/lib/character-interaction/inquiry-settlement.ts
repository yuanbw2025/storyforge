import type {CharacterInteractionRuntimeState} from '../types'
import type {ChatActorSituationRequestV1, ChatNarrativeActionV1} from '../types/chat-narrative'
import {isChatMessageRetrievableV1} from './narrative-retrieval'

export function supportsChatInquirySettlementV1(version: string | undefined): boolean {
  return ['chat-narrative-action-v70', 'chat-narrative-action-v71', 'chat-narrative-action-v72', 'chat-narrative-options-v42', 'chat-action-revision-v25'].includes(version ?? '')
}

export function assertChatInquirySettlementOutputV1(value: unknown, version: string | undefined): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const request = (value as Record<string, unknown>).situationRequest
  if (request && typeof request === 'object' && (request as Record<string, unknown>).purpose === 'inquiry-result'
    && !supportsChatInquirySettlementV1(version)) fail('旧输出合同不能添加已完成询问结算标记')
}
function fail(message: string): never {throw new Error(`[chat-inquiry-settlement] ${message}`)}

export function assertChatInquiryRespondentReferenceV1(value: Record<string, unknown>): void {
  if (typeof value.respondentFactKey !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value.respondentFactKey)
    || typeof value.respondentName !== 'string' || !value.respondentName.trim() || value.respondentName.length > 200
    || typeof value.respondentExcerpt !== 'string' || !value.respondentExcerpt.trim() || value.respondentExcerpt.length > 2000
    || !value.respondentExcerpt.includes(value.respondentName)) fail('询问对象必须有明确姓名及逐字人物依据')
}

type CompletedRequest = Extract<ChatActorSituationRequestV1, {purpose: 'inquiry-result'}>
function assertRespondent(state: CharacterInteractionRuntimeState, request: CompletedRequest, actorKey: string, at: number) {
  assertChatInquiryRespondentReferenceV1(request)
  const story = state.chatNarrative!, fact = story.situation.facts.find(f => f.factKey === request.respondentFactKey)
  if (story.permissions.allowInquiryResults !== true || story.permissions.allowActorSituationExpansion !== true
    || !story.permissions.allowedNewFactKinds.includes('observation') || story.permissions.maxNewFactsPerAction < 1) fail('作品未授权询问结果')
  if (!fact || !fact.audienceKeys.includes(actorKey) || fact.sourceEventSequence !== 0 && fact.sourceEventSequence >= at
    || !request.evidenceFactKeys.includes(fact.factKey) || !fact.text.includes(request.respondentExcerpt)) fail('询问对象须来自提问前已知且实际引用的原事实')
  if ([state.playerKey, story.persona.name].includes(request.respondentName)
    || state.profiles.some(p => p.name === request.respondentName || p.participantKey === request.respondentName)) fail('询问结算不能代替玩家或可调度角色回答')
}

/** Marks only an actual question in this candidate. Whether it is a question,
 * whether the person is present, and what they know require independent review. */
export function assertChatInquirySettlementActionV1(state: CharacterInteractionRuntimeState, action: ChatNarrativeActionV1, actorKey: string, at: number): void {
  const request = action.situationRequest
  if (request?.purpose !== 'inquiry-result') return
  if (!['speak', 'complete'].includes(action.kind) || action.waitingForPlayer || !action.text.includes(request.evidenceExcerpt)) fail('询问结算必须绑定本次已经问出的原话且不等待玩家决定')
  assertRespondent(state, request, actorKey, at)
}

/** Validate persisted identity without inferring an answer or rewriting history. */
export function assertChatInquirySettlementSourcesV1(state: CharacterInteractionRuntimeState): void {
  const pending = state.chatNarrative?.pendingSituation
  if (pending?.purpose !== 'inquiry-result') return
  const question = state.messages.find(m => m.eventSequence === pending.sourceEventSequence && m.role === 'character' && m.speakerKey === pending.actorKey)
  if (!question || !question.text.includes(pending.evidenceExcerpt)) fail('待询问结果缺少同一已提交问题原文')
  if (state.chatNarrative!.inquiryHistory?.some(r => r.questionSequence === pending.sourceEventSequence)) fail('已回答问题不能保留待结算标记')
  assertRespondent(state, pending, pending.actorKey, pending.sourceEventSequence)
}

/** The current marker has exactly one question and one respondent. Known-at-
 * question evidence is valid only while no later action or knowledge result
 * has changed that projection. No language heuristic grants this authority. */
export function chatInquirySettlementContextV1(state: CharacterInteractionRuntimeState) {
  const story = state.chatNarrative, pending = story?.pendingSituation, scene = state.activeScene
  if (!story || pending?.purpose !== 'inquiry-result' || !scene) return null
  assertChatInquirySettlementSourcesV1(state)
  const question = state.messages.find(m => m.eventSequence === pending.sourceEventSequence && m.role === 'character' && m.speakerKey === pending.actorKey)!
  if (!scene.activeParticipantKeys.includes(pending.actorKey) || question.eventSequence < scene.startedAtSequence
    || question.supersededBySequence != null || !isChatMessageRetrievableV1(state, question)
    || story.triggers.some(t => t.actionSequences.some(at => at > question.eventSequence))
    || story.discoveryHistory?.some(d => d.discoverySequence > question.eventSequence)
    || story.inquiryHistory?.some(i => i.resultSequence > question.eventSequence)
    || state.messages.some(m => m.eventSequence > question.eventSequence && (m.supersededBySequence != null || !isChatMessageRetrievableV1(state, m)))) return null
  const known = new Set(story.situation.facts.filter(f => f.audienceKeys.includes(pending.actorKey)
    && (f.sourceEventSequence === 0 || f.sourceEventSequence < question.eventSequence)).map(f => f.factKey))
  return {schema: 'storyforge.chat-inquiry-evidence', version: 5 as const, actorKey: pending.actorKey, requestSequence: question.eventSequence,
    dialogueMessageIds: state.messages.filter(m => m.eventSequence >= question.eventSequence).map(m => m.messageId),
    questions: [{messageId: question.messageId, questionSequence: question.eventSequence,
      questionEvidenceFactKeys: pending.evidenceFactKeys.filter(key => known.has(key)), respondentEvidenceFactKeys: [pending.respondentFactKey],
      targets: story.permissions.maxDiscoveriesPerSituation ? story.situation.facts.filter(f => !f.audienceKeys.includes(pending.actorKey)
        && f.discovery?.sceneKey === scene.sceneKey && f.discovery.actorKeys.includes(pending.actorKey)
        && f.discovery.prerequisiteFactKeys.every(key => known.has(key)))
        .map(f => ({factKey: f.factKey, requiredEvidenceFactKeys: [...f.discovery!.prerequisiteFactKeys]})) : []}],
  }
}

export const CHAT_INQUIRY_SETTLEMENT_ACTION_RULE_V1 = '向已有依据证明在场可交谈的非玩家、非可调度角色实际问出一个需要答复的问题时，在同一行动登记 situationRequest={purpose:"inquiry-result",threadKey,direction,evidenceFactKeys,evidenceExcerpt,respondentFactKey,respondentExcerpt,respondentName}。evidenceExcerpt 完整逐字摘录本次已问出的具体问题，respondentExcerpt 摘录提问前已知人物事实并含名字，evidenceFactKeys 包含这个 respondentFactKey；direction 只请求这个对象对原问题的有限回应，不预定回答、成功或秘密发现。纯问话可用 speech，不需要编造“问过”的 newFacts；已有 physical 后果仍按其规则登记。不要问完又只说“等他回答”或等玩家再催，也不能遗漏结果请求来制造一个悬空问题。只是打算去问、修辞问句、问玩家或其它可调度角色不使用此标记；未建立接触条件时沿普通情境路径处理，不创建不存在的人物。作品必须已授权 allowInquiryResults 与 allowActorSituationExpansion，目标和原线仍有效，不等待玩家决定。该标记只允许有界结算本问题，不增加本轮行动次数。'
export const CHAT_INQUIRY_SETTLEMENT_REVIEW_RULE_V1 = '本合同支持 purpose=inquiry-result：独立核对正文已实际向同一在场可交谈的非主角色提出具体问题、原目标/剧情线/权限、原事实及名字摘录、实际听众与问题原话完全对应，不能是打算、转述假设、修辞问句或请求玩家许可。实际需要结算的合规 NPC 问话须在同次附上结果请求，不能以缺省请求或之后重复等待冒充推进。问题只是已问过，不证明回答、合作、成功或秘密知情；不要求角色先知道答案或编造物理观察。允许在同次明确成立的新自身目标后提出这一个问题，仍须分别满足 followupGoal/threadFollowupGoal 授权；结果请求不授权新人物、后续动作或额外行动次数。'
export function chatInquirySettlementFollowupRulesV1(rule: string): string {
  return rule.replace('situationRequest 仅可为同一原线的已完成 observation-result。', 'situationRequest 仅可为同一原线已完成的 observation-result 或实际问出的 inquiry-result。')
    .replace('followupGoal 不能并用其他 situationRequest。', 'followupGoal 仅可并用同次已完成观察或实际询问的结果请求。')
}
