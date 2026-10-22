import type { ProductRuntimeEvent, ProductRuntimeState } from '../types'
import type { ProductRuntimeJsonObjectV1 } from '../product/runtime-values'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { authorizeTtrpgOpenMemoryDraftV1 } from './open-memory-contract'
import { parseTtrpgOpenMemoryReceipt, ttrpgOpenMemoryIntent } from './open-memory-receipt'
import { assertTtrpgOpenModelActorV1 } from './open-model-purpose'
import * as p from './open-contract-parse'

export function applyTtrpgOpenMemoryEventV1(state: ProductRuntimeState, event: ProductRuntimeEvent, payload: ProductRuntimeJsonObjectV1): boolean {
  if (event.type !== 'ttrpg.memory.recorded') return false
  const body = p.record(payload, ['commandId', 'memory', 'sourceLineageHash', 'intent'], 'memory event'), receipt = parseTtrpgOpenMemoryReceipt(body.memory)
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg)
  if (!runtime?.authorization || !runtime.openRun || runtime.product.safety.status !== 'active') p.fail('记忆确认需要实际开团授权和未暂停的实例')
  const { seat, recipientActorKeys } = authorizeTtrpgOpenMemoryDraftV1(receipt.draft, runtime.authorization, receipt.viewerKey)
  if (receipt.version === 2) {
    const model = receipt.model, call = runtime.openRun.coordination.calls.find(call => call.requestKey === model.requestKey)
    const epoch = runtime.openRun.coordination.epochs.find(epoch => epoch.epochKey === model.epochKey)
    assertTtrpgOpenModelActorV1(runtime.authorization, 'prose.ttrpg-open-brief', 'gm', receipt.viewerKey)
    if (!call || call.skillId !== 'prose.ttrpg-open-brief' || call.status !== 'succeeded' || call.authorizationEpochKey !== model.epochKey
      || !epoch || epoch.status !== 'active' || epoch.triggerKind !== 'request-brief' || epoch.viewerKey !== receipt.viewerKey
      || runtime.openRun.coordination.activeEpochKey !== epoch.epochKey || call.responseArtifactHash !== model.rawResponseHash
      || call.runContractHash !== model.runContractHash || call.inputManifestHash !== model.inputManifestHash
      || call.visibilityHash !== model.contextHash || call.runtimeSourceHash !== receipt.runtimeSourceHash
      || receipt.draft.toEventSequence !== call.createdRef.sequence - 1
      || !call.terminalRef || call.terminalRef.sequence >= event.sequence
      || runtime.openRun.memoryReceipts?.some(prior => prior.version === 2 && prior.model.requestKey === model.requestKey)) p.fail('模型记忆必须来自当前被动窗口中的唯一真实成功复盘')
  }
  if (receipt.sourceRef.sessionKey !== runtime.sessionKey || receipt.sourceRef.sequence !== event.sequence
    || body.sourceLineageHash !== receipt.sourceLineageHash
    || receipt.commandId !== event.commandId || body.commandId !== event.commandId
    || receipt.draft.toEventSequence > state.lastSequence || event.baseSequence !== state.lastSequence
    || receipt.authorActorKey !== seat.actorKey || event.actorKey !== seat.actorKey
    || stable(receipt.authorizationRef) !== stable(runtime.authorization.sourceRef)
    || stable(receipt.recipientActorKeys) !== stable(recipientActorKeys)
    || receipt.recordedAtWorldTurn !== runtime.openRun.worldTime.worldTurn || receipt.recordedAt > event.createdAt
    || stable(body.intent) !== stable(ttrpgOpenMemoryIntent(receipt))) p.fail('记忆来源、本人确认或事件区间与当前实例不一致')
  if (runtime.openRun.memoryReceipts?.some(r => r.draft.revisionKey === receipt.draft.revisionKey)) p.fail('记忆版本已经存在，重算须使用新版本')
  runtime.openRun.memoryReceipts = [...(runtime.openRun.memoryReceipts ?? []), receipt]
  state.ttrpg = runtime
  return true
}
