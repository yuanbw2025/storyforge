import {parseChatResolutionEvidenceVersionV1} from './resolution-evidence'
import {parseInteractionState} from './runtime'
import {parseChatFactEvidenceVersionV1} from './fact-evidence'
import {parseChatActionChoiceVersionV1} from './action-choice-budget'
import {parseChatInquiryEvidenceVersionV1} from './inquiry-evidence'
import {chatControlHandoffReviewPassedV1, parseChatControlHandoffReviewV1, parseChatControlHandoffV1} from './control-handoff-contract'

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
function serializedObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string') return undefined
  // Existing product import/replay owns the surrounding format. This hook
  // validates recognized new provenance without rewriting historical payloads.
  try {return object(JSON.parse(value))} catch {return undefined}
}
export function validateImportedChatNarrativeEvidenceStateV1(value: unknown, productKind: unknown): void {
  const interaction = object(serializedObject(value)?.interaction), story = object(interaction?.chatNarrative)
  if (!story || !['factEvidence', 'resolutionEvidence'].some(key => Object.prototype.hasOwnProperty.call(story, key))
    && !(Array.isArray(story.triggers) && story.triggers.some(trigger => Object.prototype.hasOwnProperty.call(object(trigger) ?? {}, 'controlHandoff')))) return
  if (productKind !== 'character-interaction') throw new Error('[chat-fact-evidence] 事实来源索引不能归入其他产品')
  parseInteractionState(interaction)
}
export function validateImportedChatNarrativeEvidenceEventV1(value: unknown, productKind: unknown, eventType: unknown): void {
  const body = serializedObject(value)
  if (eventType === 'interaction.narrative.control-handoff.committed') {
    if (productKind !== 'character-interaction' || !body
      || Object.keys(body).sort().join(',') !== 'actorKey,baseSequence,baseStateHash,commandId,handoff,review,triggerSequence') throw new Error('[chat-control-handoff] 交还控制导入路径或载荷无效')
    const handoff = parseChatControlHandoffV1(body.handoff), review = parseChatControlHandoffReviewV1(body.review, handoff)
    if (!chatControlHandoffReviewPassedV1(review, handoff)) throw new Error('[chat-control-handoff] 已提交交还控制缺少通过的审查')
    return
  }
  if (!body || !['factEvidenceVersion', 'resolutionEvidenceVersion', 'actionChoiceVersion', 'inquiryEvidenceVersion'].some(key => Object.prototype.hasOwnProperty.call(body, key))) return
  if (productKind !== 'character-interaction' || !['interaction.narrative.action-reviewed.committed', 'interaction.narrative.situation.committed'].includes(String(eventType))) {
    throw new Error('[chat-fact-evidence] 叙事依据提交路径无效')
  }
  parseChatFactEvidenceVersionV1(body.factEvidenceVersion)
  if (Object.prototype.hasOwnProperty.call(body, 'inquiryEvidenceVersion')) {
    if (eventType !== 'interaction.narrative.situation.committed') throw new Error('[chat-inquiry] 询问前提证据只能来自已审查情境')
    parseChatInquiryEvidenceVersionV1(body.inquiryEvidenceVersion)
  }
  if (Object.prototype.hasOwnProperty.call(body, 'actionChoiceVersion')) {
    if (eventType !== 'interaction.narrative.action-reviewed.committed') throw new Error('[chat-action-choice] 选择额度只能来自已审查行动')
    parseChatActionChoiceVersionV1(body.actionChoiceVersion)
  }
  if (Object.prototype.hasOwnProperty.call(body, 'resolutionEvidenceVersion')) {
    if (eventType !== 'interaction.narrative.action-reviewed.committed') throw new Error('[chat-resolution-evidence] 收束依据只能来自已审查行动')
    parseChatResolutionEvidenceVersionV1(body.resolutionEvidenceVersion)
  }
}
