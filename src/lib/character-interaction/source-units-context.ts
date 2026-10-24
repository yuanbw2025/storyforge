import type {WorkspaceScope} from '../types'
import {readChatDraftV1} from './draft-service'
import {parseChatAuthoringSettings} from './authoring-contract'
import {readChatSourceReviewContextV1, type ChatSourceReviewContextV1, type ChatSourceReviewRequestV1} from './source-review-context'
import {parseChatSourceUnitsCandidateV1, validateChatSourceUnitsEvidenceV1, type ChatSourceUnitsCandidateV1} from './source-units'

export interface ChatSourceUnitsReviewRequestV1 {source: ChatSourceReviewRequestV1; candidate: ChatSourceUnitsCandidateV1}
export interface ChatSourceUnitsReviewContextV1 {source: ChatSourceReviewContextV1; candidate: ChatSourceUnitsCandidateV1}

export function validateChatSourceUnitsRequestV1(request: ChatSourceReviewRequestV1): void {
  if (!request || Object.keys(request).sort().join(',') !== 'draftRevision,fragmentKeys,projectionHash'
    || !Array.isArray(request.fragmentKeys) || request.fragmentKeys.length < 1 || request.fragmentKeys.length > 12)
    throw new Error('事实整理须选择1至12段完整原文，仅供作者审查')
}
export function validateChatSourceUnitsReviewRequestV1(request: ChatSourceUnitsReviewRequestV1): void {
  if (!request || Object.keys(request).sort().join(',') !== 'candidate,source') throw new Error('事实复核请求字段无效')
  validateChatSourceUnitsRequestV1(request.source); parseChatSourceUnitsCandidateV1(request.candidate)
}
export async function readChatSourceUnitsContextV1(scope: WorkspaceScope, input: ChatSourceReviewRequestV1): Promise<ChatSourceReviewContextV1> {
  const request = structuredClone(input); validateChatSourceUnitsRequestV1(request)
  const draft = await readChatDraftV1(scope)
  if (parseChatAuthoringSettings(JSON.parse(draft.settingsJson)).version !== 3) throw new Error('事实整理仅用于实验叙事方案')
  return readChatSourceReviewContextV1(scope, request)
}
export async function readChatSourceUnitsReviewContextV1(scope: WorkspaceScope, input: ChatSourceUnitsReviewRequestV1): Promise<ChatSourceUnitsReviewContextV1> {
  const request = structuredClone(input); validateChatSourceUnitsReviewRequestV1(request)
  const source = await readChatSourceUnitsContextV1(scope, request.source)
  return {source, candidate: validateChatSourceUnitsEvidenceV1(request.candidate, source)}
}
