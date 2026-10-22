import type { ProductRuntimeEvent, ProductRuntimeState } from '../types'
import type { ProductRuntimeJsonObjectV1 } from '../product/runtime-values'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { parseTtrpgOpenKnowledgeShareReceiptV1, parseTtrpgOpenKnowledgeShareRequestV1,
  assertTtrpgOpenKnowledgeShareActorV1, createTtrpgOpenSharedKnowledgeV1, ttrpgOpenKnowledgeDiscoveryOriginV1 } from './open-knowledge-share'
import * as p from './open-contract-parse'

export function applyTtrpgOpenKnowledgeShareEventV1(state: ProductRuntimeState, event: ProductRuntimeEvent, payload: ProductRuntimeJsonObjectV1): boolean {
  if (event.type !== 'ttrpg.open.knowledge.shared') return false
  p.exact(payload, ['receipt', 'privateChannelsAllowed', 'intent'], 'knowledge shared')
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg), run = runtime?.openRun, authorization = runtime?.authorization
  if (!runtime || !run || !authorization) p.fail('知识分享需要已授权团局')
  const receipt = parseTtrpgOpenKnowledgeShareReceiptV1(payload.receipt)
  if (receipt.knowledge.identityGrant) p.fail('旧 V1 分享不能隐式授予新版身份知识')
  const intent = p.record(payload.intent, ['viewerKey', 'request', 'confirmationHash'], 'share intent')
  const request = parseTtrpgOpenKnowledgeShareRequestV1(intent.request)
  const epoch = run.coordination.epochs.find(epoch => epoch.epochKey === receipt.authorizationEpochKey)
  const source = run.knowledge.find(entry => entry.knowledgeKey === receipt.sourceKnowledgeKey) ?? p.fail('分享知识尚未实际获得')
  const origin = ttrpgOpenKnowledgeDiscoveryOriginV1(runtime, source)
  assertTtrpgOpenKnowledgeShareActorV1(authorization, receipt.viewerKey, receipt.sharedByActorKey)
  if (!epoch || epoch.status !== 'active' || run.coordination.activeEpochKey !== epoch.epochKey || epoch.viewerKey !== receipt.viewerKey
    || runtime.product.safety.status !== 'active' || run.stage.status !== 'open'
    || event.actorKey !== receipt.sharedByActorKey || event.targetKey !== null || intent.viewerKey !== receipt.viewerKey
    || request.actorKey !== receipt.sharedByActorKey || intent.confirmationHash !== receipt.confirmationHash
    || stable(source.acquisitionRef) !== stable(receipt.sourceAcquisitionRef) || run.knowledge.some(entry => entry.knowledgeKey === receipt.knowledge.knowledgeKey)
    || receipt.knowledge.acquisitionRef.sessionKey !== runtime.sessionKey || receipt.knowledge.acquisitionRef.sequence !== event.sequence
    || payload.privateChannelsAllowed !== origin.frozenContent.campaign.informationPolicy.interPlayerWhispers) p.fail('分享没有当前角色、来源、窗口或真人确认')
  const expected = createTtrpgOpenSharedKnowledgeV1({ request, source, authorization, knowledgeKey: receipt.knowledge.knowledgeKey,
    acquisitionRef: { sessionKey: runtime.sessionKey, sequence: event.sequence }, privateChannelsAllowed: p.bool(payload.privateChannelsAllowed, 'share private-channel policy') })
  if (stable(expected) !== stable(receipt.knowledge)) p.fail('分享不能换内容、接收者或可靠性')
  run.knowledge.push(expected)
  run.knowledgeShares = [...(run.knowledgeShares ?? []), receipt]
  state.ttrpg = runtime
  return true
}
