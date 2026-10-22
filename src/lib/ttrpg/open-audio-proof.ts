/** Real event bytes and immutable ancestor evidence, independent of media availability. */
import type { ProductRuntimeEvent } from '../types'
import type { TtrpgRuntimeStateV2 } from './open-runtime-contract'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { hashProductProductionValueV2 as hash } from '../product-production/hash'
import { verifyTtrpgOpenBranchLineageV1 } from './open-branch-contract'
import { assertTtrpgOpenAudioScopeAuthorityV1 } from './open-audio-scope'
import { createTtrpgOpenAudioStopScopeV1, ttrpgOpenAudioSourceEqualV1 } from './open-audio-contract'
import { ttrpgOpenAudioPayload, parseTtrpgOpenAudioReceipt, assertTtrpgOpenAudioJournal } from './open-audio-receipt'
import * as p from './open-contract-parse'
import { ttrpgOpenScopedKeyV1 } from './open-coordination'

export async function verifyTtrpgOpenAudioReceiptsV1(input: { runtime: TtrpgRuntimeStateV2; runtimeSourceHash: string; events: readonly ProductRuntimeEvent[]; projectId?: number }): Promise<void> {
  const { runtime } = input
  if (runtime.branchLineage) await verifyTtrpgOpenBranchLineageV1(runtime.branchLineage, runtime.sessionKey)
  assertTtrpgOpenAudioJournal(runtime)
  for (const raw of runtime.openRun?.audioReceipts ?? []) {
    const receipt = parseTtrpgOpenAudioReceipt(raw), ref = receipt.envelope.sourceRef
    if (receipt.version === 2) {
      if (!input.projectId) p.fail('生成音频核验需要准确的证据拥有项目')
      await (await import('./open-generated-audio-evidence')).verifyTtrpgOpenGeneratedAudioOriginV1({projectId: input.projectId, receipt})
    }
    const ancestor = runtime.branchLineage?.ancestors.find(row => row.sessionKey === ref.sessionKey)
    const authority = ref.sessionKey === runtime.sessionKey ? runtime.authorization : ancestor?.snapshot.authorization
    if (!authority || receipt.runtimeSourceHash !== input.runtimeSourceHash) p.fail('音频缺少准确原授权或冻结来源')
    if (receipt.request.media.kind === 'stop') {
      const stopRef = receipt.request.media.sourceRef, original = runtime.openRun?.audioReceipts?.find(row => ttrpgOpenAudioSourceEqualV1(row.envelope.sourceRef, stopRef))
      if (!original || stable(createTtrpgOpenAudioStopScopeV1(authority, original, receipt.envelope.scope.issuerViewerKey)) !== stable(receipt.envelope.scope)) p.fail('停止未保留原准确接收者和当前主持授权')
    } else assertTtrpgOpenAudioScopeAuthorityV1(receipt.envelope.scope, authority)
    if (receipt.envelope.event.commandId !== await ttrpgOpenScopedKeyV1(ref.sessionKey, 'audio-control', [receipt.envelope.scope.issuerViewerKey, receipt.submissionKey])
      || receipt.request.media.kind === 'upload' && receipt.asset?.assetKey !== await ttrpgOpenScopedKeyV1(ref.sessionKey, 'audio-asset', [receipt.envelope.scope.issuerViewerKey, receipt.request.media.submissionKey])) p.fail('音频命令或原上传身份不是本次内核分配结果')
    const payload = ttrpgOpenAudioPayload(receipt)
    if (ref.sessionKey === runtime.sessionKey) {
      const event = input.events.find(row => row.sequence === ref.sequence), author = authority.seats.find(row => row.viewerKey === receipt.envelope.scope.issuerViewerKey)
      if (!event || event.type !== 'ttrpg.audio.cue.applied' || event.commandId !== receipt.envelope.event.commandId
        || event.actorKey !== author?.actorKey || event.targetKey !== receipt.request.privateActorKey || stable(JSON.parse(event.payloadJson)) !== stable(payload)) p.fail('音频缺少原准确正式事件')
    } else {
      const event = ancestor?.events[ref.sequence - 1]
      if (!ancestor || ancestor.runtimeSourceHash !== receipt.runtimeSourceHash || event?.type !== 'ttrpg.audio.cue.applied'
        || event.payloadHash !== await hash(payload) || !ancestor.snapshot.openRun?.audioReceipts?.some(row => stable(row) === stable(receipt))) p.fail('音频未在原祖先切点前真实提交')
    }
  }
}
