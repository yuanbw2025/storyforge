import type {WorkspaceScope} from '../types'
import {hashCanonicalValue} from '../agent/run/hash'
import {readLatestVerifiedAgentRunCheckpointV1} from '../agent/run/checkpoint'
import {readChatDraftV1} from './draft-service'
import {parseChatAuthoringSettings} from './authoring-contract'
import {readChatSourceReviewContextV1, type ChatSourceReviewRequestV1, type ChatSourceReviewContextV1} from './source-review-context'
import {chatPlanValuesV1, type ChatPlanCandidateV1} from './consultation-plan'

export interface ChatConsultationRequestV2 {
  draftRevision: number; question: string; source: ChatSourceReviewRequestV1 | null; priorRunId: number | null
}
export interface ChatConsultationContextV2 {
  schema: 'storyforge.chat-consultation-context'; version: 2; audience: 'author-only'
  draftRevision: number; settingsHash: string; question: string
  plan: ReturnType<typeof chatPlanValuesV1>; source: ChatSourceReviewContextV1 | null
  history: Array<{question: string; candidate: ChatPlanCandidateV1}>
}
export function validateChatConsultationRequestV2(request: ChatConsultationRequestV2) {
  if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).sort().join(',') !== 'draftRevision,priorRunId,question,source'
    || !Number.isSafeInteger(request.draftRevision) || request.draftRevision < 0
    || typeof request.question !== 'string' || !request.question.trim() || request.question.length > 5000
    || request.priorRunId !== null && (!Number.isSafeInteger(request.priorRunId) || request.priorRunId < 1)
    || request.source !== null && (!request.source || request.source.draftRevision !== request.draftRevision || request.source.actorKey !== undefined || request.source.fragmentKeys.length > 12)) throw new Error('请提供当前方案版本、会谈问题和本次资料选择')
}
/** Registered S2 author reader. Only explicitly selected passages enter this conversation. */
export async function readChatConsultationContextV2(scopeInput: WorkspaceScope, input: ChatConsultationRequestV2): Promise<ChatConsultationContextV2> {
  const scope = structuredClone(scopeInput), request = structuredClone(input)
  validateChatConsultationRequestV2(request)
  const draft = await readChatDraftV1(scope)
  if (draft.revision !== request.draftRevision) throw new Error('方案已变化，请刷新后讨论当前方案')
  const settings = parseChatAuthoringSettings(JSON.parse(draft.settingsJson))
  const source = request.source ? await readChatSourceReviewContextV1(scope, request.source) : null
  let history: ChatConsultationContextV2['history'] = []
  if (request.priorRunId !== null) {
    const previous = await readLatestVerifiedAgentRunCheckpointV1(scope, request.priorRunId)
    const payload = previous?.resumePayload as {kind?: string; context?: ChatConsultationContextV2; result?: {candidate: ChatPlanCandidateV1 | null}} | undefined
    if (!previous || previous.snapshot.contract.executionBindings?.[0]?.skillId !== 'chat.consult.v2'
      || payload?.kind !== 'storyforge.chat-consultation-run' || payload.context?.schema !== 'storyforge.chat-consultation-context' || !payload.result?.candidate
      || !previous.snapshot.events.some(event => event.type === 'candidate.persisted')) throw new Error('未找到本作品可承接的已保存方案候选')
    history = [...payload.context.history, {question: payload.context.question, candidate: payload.result.candidate}]
  }
  const current = await readChatDraftV1(scope)
  if (current.revision !== draft.revision || current.settingsJson !== draft.settingsJson || current.worldReleaseId !== draft.worldReleaseId) throw new Error('读取期间方案已变化，本次没有发送')
  return {schema: 'storyforge.chat-consultation-context', version: 2, audience: 'author-only', draftRevision: draft.revision,
    settingsHash: await hashCanonicalValue({settings, worldReleaseId: draft.worldReleaseId}), question: request.question,
    plan: chatPlanValuesV1(settings), source, history}
}
