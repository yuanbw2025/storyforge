import type { ProductRuntimeEvent, ProductRuntimeState } from '../types'
import type { ProductRuntimeJsonObjectV1 } from '../product/runtime-values'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { parseTtrpgOpenKnowledgeEntryV1 } from './open-knowledge'
import { createTtrpgOpenIdentityKnowledgeV1, ttrpgOpenIdentityKnowledgeEventV1, ttrpgOpenIdentityKnowledgePayloadV1 } from './open-identity-knowledge'
import * as p from './open-contract-parse'

export function applyTtrpgOpenIdentityKnowledgeEventV1(state: ProductRuntimeState, event: ProductRuntimeEvent, payload: ProductRuntimeJsonObjectV1): boolean {
  if (!['ttrpg.open.knowledge.identity-confirmed', 'ttrpg.open.knowledge.identity-shared'].includes(event.type)) return false
  p.exact(payload, ['knowledge', 'shareReceipt', 'intent'], 'identity knowledge event')
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg), knowledge = parseTtrpgOpenKnowledgeEntryV1(payload.knowledge), grant = knowledge.identityGrant
  if (!runtime?.openRun || !runtime.authorization || !grant) p.fail('身份确认缺少真实运行和版本化来源')
  const expectedPayload = ttrpgOpenIdentityKnowledgePayloadV1(knowledge)
  const expected = createTtrpgOpenIdentityKnowledgeV1({ runtime, runtimeSourceHash: grant.runtimeSourceHash, viewerKey: grant.viewerKey,
    request: expectedPayload.intent.request, acquisitionRef: { sessionKey: runtime.sessionKey, sequence: event.sequence }, knowledgeKey: knowledge.knowledgeKey,
    sourceKnowledgeHash: grant.sourceKnowledgeHash, submissionKey: grant.submissionKey, baseStateHash: grant.baseStateHash, confirmationHash: grant.confirmationHash })
  if (event.type !== ttrpgOpenIdentityKnowledgeEventV1(grant.mode) || event.actorKey !== grant.actorKey || event.targetKey !== null
    || runtime.openRun.knowledge.some(row => row.knowledgeKey === knowledge.knowledgeKey)
    || stable(expected) !== stable(knowledge) || stable(payload) !== stable(expectedPayload)) p.fail('身份确认的角色、来源、接收者或原审阅内容不一致')
  runtime.openRun.knowledge.push(expected)
  if (expectedPayload.shareReceipt) runtime.openRun.knowledgeShares = [...(runtime.openRun.knowledgeShares ?? []), expectedPayload.shareReceipt]
  state.ttrpg = runtime
  return true
}
