import type {WorkspaceScope} from '../types'
import type {ChatSourceReviewRequestV1, ChatSourceReviewContextV1} from './source-review-context'
import {readChatSourceUnitsContextV1, validateChatSourceUnitsRequestV1} from './source-units-context'
import {readChatDraftV1, loadChatSourceProjectionV1} from './draft-service'
import {parseChatAuthoringSettings} from './authoring-contract'
import {chatProjectionResourcesV1} from './source-projection'
import {parseChatSourceUnitsCandidateV1, type ChatSourceUnitsCandidateV1} from './source-units'
import {parseChatSourceUnitPermissionsV1, validateChatSourceUnitAuthorizationV1, type ChatSourceUnitPermissionV1} from './source-unit-authorization'

export interface ChatSourceUnitConfirmationRequestV1 {source: ChatSourceReviewRequestV1; candidate: ChatSourceUnitsCandidateV1; permissions: ChatSourceUnitPermissionV1[]}
export interface ChatSourceUnitConfirmationContextV1 {
  source: ChatSourceReviewContextV1; candidate: ChatSourceUnitsCandidateV1; permissions: ChatSourceUnitPermissionV1[]
  prerequisites: ChatSourceReviewContextV1['fragments']
}
export function validateChatSourceUnitConfirmationRequestV1(request: ChatSourceUnitConfirmationRequestV1) {
  if (!request || Object.keys(request).sort().join(',') !== 'candidate,permissions,source') throw new Error('事实确认请求字段无效')
  validateChatSourceUnitsRequestV1(request.source)
  parseChatSourceUnitPermissionsV1(request.permissions, parseChatSourceUnitsCandidateV1(request.candidate))
}
export async function readChatSourceUnitConfirmationContextV1(scope: WorkspaceScope, input: ChatSourceUnitConfirmationRequestV1): Promise<ChatSourceUnitConfirmationContextV1> {
  const request = structuredClone(input); validateChatSourceUnitConfirmationRequestV1(request)
  const source = await readChatSourceUnitsContextV1(scope, request.source)
  const {candidate, permissions} = validateChatSourceUnitAuthorizationV1(request.candidate, request.permissions, source)
  const draft = await readChatDraftV1(scope), settings = parseChatAuthoringSettings(JSON.parse(draft.settingsJson))
  if (draft.revision !== request.source.draftRevision || settings.version !== 3 || !settings.sourceReview) throw new Error('方案或原文分类已变化')
  if (permissions.some(row => row.discovery) && !settings.narrative.permissions.maxDiscoveriesPerSituation) throw new Error('请先在作品方案中启用调查发现额度')
  const projection = await loadChatSourceProjectionV1(scope, request.source.draftRevision)
  const resources = chatProjectionResourcesV1(projection), prerequisites: ChatSourceReviewContextV1['fragments'] = []
  const keys = new Set<string>()
  for (const permission of permissions) for (const key of permission.discovery?.prerequisiteFragmentKeys ?? []) {
    const resource = resources.find(row => row.fragments.some(fragment => fragment.fragmentKey === key)), fragment = resource?.fragments.find(row => row.fragmentKey === key)
    const classification = settings.sourceReview.classifications.find(row => row.fragmentKey === key)
    if (!fragment || !resource || request.source.fragmentKeys.includes(key) || !classification || classification.purpose !== 'knowledge'
      || !(classification.visibility === 'public' || classification.visibility === 'participants' && permission.discovery!.actorKeys.every(actor => classification.audienceKeys.includes(actor)))) throw new Error('发现前提须是调查角色已经知道的原文事实')
    if (!keys.has(key)) {
      keys.add(key); prerequisites.push({...fragment, sourceHash: resource.sourceHash, resourceKind: 'resourceKind' in resource ? String(resource.resourceKind) : 'character',
        ...(resource.origin ? {origin: resource.origin} : {}), confirmedClassification: classification})
    }
  }
  if ((await readChatDraftV1(scope)).revision !== request.source.draftRevision) throw new Error('读取期间方案已变化')
  return {source, candidate, permissions, prerequisites}
}
