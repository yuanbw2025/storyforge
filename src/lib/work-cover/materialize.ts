import Dexie from 'dexie'
import { db } from '../db/schema'
import type { AnyAgentRunEventV1, WorkspaceScope } from '../types'
import type { AgentRunSnapshotV1 } from '../agent/run/event-store'
import { appendAgentRunEventWithSettlementInTransactionV1, appendPrivilegedAgentRunEventInTransactionV1,
  readAgentRunV1, readVerifiedAgentRunInTransactionV1, withAgentRunMutationLockV1 } from '../agent/run/event-store'
import { beginAgentRunRecoveryV1, completeAgentRunRecoveryV1, createAgentRunCheckpointInTransactionV1 } from '../agent/run/checkpoint'
import { createVerificationReceiptV1 } from '../agent/run/verification-receipt'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { recordAgentRunArtifactV1 } from '../memory/artifact-store'
import { prepareMediaBlobV1, readVerifiedMediaBlobV1, sha256BinaryV1 } from '../media/blob-store'
import { resolveScope, scopeTransactionTables } from '../workspace/scope'
import { assertLongformCoverWorkV1, coverRecordInScopeV1 } from './drafts'
import { assertWorkCoverCandidateHashV1, parseWorkCoverImageCandidateV1 } from './contracts'
import { failCoverRunV1, WORK_COVER_STEP_V1 as STEP } from './run-evidence'
import type { WorkCoverAssetV1, WorkCoverImageCandidateV1 } from './types'
import { storeWorkCoverOriginalAssetInTransactionV1 } from './assets'

function imageBytes(payload: ArrayBuffer): ArrayBuffer {
  let value: unknown
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload)) } catch { throw new Error('图片服务未返回完整 JSON；原答已保留，不会重发。') }
  const result = value as { data?: Array<{ b64_json?: unknown; url?: unknown }>; status?: unknown }
  if (!result || typeof result !== 'object' || !Array.isArray(result.data) || result.data.length !== 1
    || !result.data[0] || typeof result.data[0] !== 'object' || result.data[0].url !== undefined
    || typeof result.data[0].b64_json !== 'string' || result.status === 'queued' || result.status === 'processing') throw new Error('此配方只接收同步单张 base64 图片；原答已保留，不下载或重发。')
  const base64 = result.data[0].b64_json
  if (!base64 || base64.length > 35_000_000 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error('图片 base64 非法或超过原图上限；不会重发。')
  let binary: string
  try { binary = atob(base64) } catch { throw new Error('图片 base64 无法解码；不会重发。') }
  if (binary.length > 25 * 1024 * 1024 || btoa(binary) !== base64) throw new Error('图片编码或原图大小不符合协议；不会重发。')
  return Uint8Array.from(binary, char => char.charCodeAt(0)).buffer
}

function event<T extends AnyAgentRunEventV1['type']>(snapshot: AgentRunSnapshotV1, type: T,
  payload: import('../types').AgentRunEventPayloadByTypeV1[T]): AnyAgentRunEventV1 {
  return { version: 1, type, payload, runId: snapshot.run.id, projectId: snapshot.run.projectId,
    worldGroupId: snapshot.run.worldGroupId ?? null, contractHash: snapshot.run.contractHash,
    generation: snapshot.run.generation, sequence: snapshot.projection.lastSequence + 1, createdAt: Date.now() } as AnyAgentRunEventV1
}

/** This recovery reads only the original local Buffer. It has no connection,
 * credential or fetch argument, and cannot reacquire a dispatch permission. */
export async function materializeCoverCandidateV1(input: { scope: WorkspaceScope; runId: number }): Promise<WorkCoverAssetV1 & { id: number }> {
  const scope = await resolveScope({ scope: input.scope })
  const buffer = await db.workCoverResponseBuffers.where('runId').equals(input.runId).first()
  if (!buffer || !coverRecordInScopeV1(scope, buffer)) throw new Error('没有本机原答；导入历史或未知请求不能重新发送。')
  if (buffer.state === 'candidate-ready' && buffer.assetId != null) {
    const asset = await db.workCoverAssets.get(buffer.assetId)
    if (!asset?.id || !coverRecordInScopeV1(scope, asset) || !asset.candidateJson) throw new Error('已保存的图片候选证据不完整。')
    const candidate = parseWorkCoverImageCandidateV1(asset.candidateJson)
    await assertWorkCoverCandidateHashV1(candidate)
    const blob = await readVerifiedMediaBlobV1({ scope, blobObjectId: asset.blobObjectId })
    if (blob.contentHash !== candidate.blobHash || asset.sourceRunId !== input.runId) throw new Error('图片候选与原请求不匹配。')
    return asset as WorkCoverAssetV1 & { id: number }
  }
  if (!['response-observed', 'materializing'].includes(buffer.state) || !buffer.payload || buffer.httpStatus == null
    || buffer.httpStatus < 200 || buffer.httpStatus >= 300 || !buffer.rawResponseHash) throw new Error('图片结果尚未确认或不能物化；不会自动重发。')
  if (await sha256BinaryV1(buffer.payload) !== buffer.rawResponseHash) throw new Error('已保存原答损坏；旧封面已保留。')
  let prepared: Awaited<ReturnType<typeof prepareMediaBlobV1>>
  try { prepared = await prepareMediaBlobV1(imageBytes(buffer.payload)) } catch (error) {
    await db.workCoverResponseBuffers.update(buffer.id!, { state: 'failed', errorCode: 'image-response-rejected', updatedAt: Date.now() })
    await failCoverRunV1(scope, input.runId, 'image-response-rejected')
    throw error
  }
  const responseReceipt = { schema: 'storyforge.work-cover.image-response@1', dispatchKey: buffer.dispatchKey,
    httpStatus: buffer.httpStatus, requestId: buffer.requestId, rawResponseHash: buffer.rawResponseHash,
    routeHash: buffer.routeHash, blobHash: prepared.contentHash }
  const providerReceiptHash = await hashCanonicalValue(responseReceipt)
  const preimage: Omit<WorkCoverImageCandidateV1, 'candidateHash'> = {
    schema: 'storyforge.work-cover.image-candidate@1', workCode: buffer.workCode,
    dispatchKey: buffer.dispatchKey, attempt: 1, ordinal: 0, briefHash: buffer.briefHash, routeHash: buffer.routeHash,
    assetKey: buffer.assetKey, blobHash: prepared.contentHash, responseHash: buffer.rawResponseHash,
    providerReceiptHash, rights: 'provider-terms-unverified',
  }
  const candidate: WorkCoverImageCandidateV1 = { ...preimage, candidateHash: await hashCanonicalValue(preimage) }
  let snapshot = await readAgentRunV1(scope, input.runId)
  if (snapshot.projection.state === 'paused' || snapshot.projection.state === 'recovering') {
    const recovery = await beginAgentRunRecoveryV1({ scope, runId: input.runId })
    snapshot = await completeAgentRunRecoveryV1({ scope, runId: input.runId, checkpointHash: recovery.checkpointHash })
  }
  if (snapshot.projection.state !== 'running') throw new Error('原运行不在可物化状态；原答已保留。')
  for (const [artifactKind, content] of [
    ['raw-response', canonicalStringify(responseReceipt)], ['tool-result', canonicalStringify(candidate)],
  ] as const) await recordAgentRunArtifactV1({ scope, runId: input.runId, artifactKind, content, stepId: STEP, attempt: 1 })

  return withAgentRunMutationLockV1(input.runId, () => db.transaction('rw', scopeTransactionTables(
    db.workCoverResponseBuffers, db.workCoverDrafts, db.workCoverAssets, db.mediaBlobObjects,
    db.agentRuns, db.agentRunEvents, db.agentRunCheckpoints,
  ), async () => {
    await resolveScope({ scope })
    const current = await db.workCoverResponseBuffers.get(buffer.id!)
    if (!current || !coverRecordInScopeV1(scope, current) || current.rawResponseHash !== buffer.rawResponseHash || current.dispatchKey !== buffer.dispatchKey) throw new Error('原答绑定已变化。')
    if (current.state === 'candidate-ready' && current.assetId != null) {
      const existing = await db.workCoverAssets.get(current.assetId)
      if (!existing?.id || existing.candidateJson !== canonicalStringify(candidate)) throw new Error('图片候选重复物化证据冲突。')
      return existing as WorkCoverAssetV1 & { id: number }
    }
    if (!['response-observed', 'materializing'].includes(current.state) || !current.payload
      || await Dexie.waitFor(sha256BinaryV1(current.payload)) !== buffer.rawResponseHash) throw new Error('原答内容已变化。')
    const work = await db.works.get(scope.workId)
    assertLongformCoverWorkV1(work, scope)
    if (work.code !== buffer.workCode) throw new Error('原请求不属于此作品身份。')
    let live = await readVerifiedAgentRunInTransactionV1(scope, input.runId)
    if (live.contract.runtimeBindingHash !== buffer.routeHash || !live.events.some(item => item.type === 'model.requested')) throw new Error('图片候选缺少实际原运行派发证据。')
    const asset = await storeWorkCoverOriginalAssetInTransactionV1(scope, prepared, { kind: 'model', runId: input.runId, candidate })
    const id = asset.id
    const row = asset
    live = await appendPrivilegedAgentRunEventInTransactionV1(live, event(live, 'model.responded', { stepId: STEP, attempt: 1, outputHash: providerReceiptHash }))
    live = await appendPrivilegedAgentRunEventInTransactionV1(live, event(live, 'candidate.persisted', { stepId: STEP, attempt: 1, candidateHash: candidate.candidateHash, requiresConfirmation: false }))
    live = await appendPrivilegedAgentRunEventInTransactionV1(live, event(live, 'step.succeeded', { stepId: STEP, attempt: 1, outputHash: candidate.candidateHash }))
    live = await appendPrivilegedAgentRunEventInTransactionV1(live, event(live, 'verification.started', { verifierSetVersion: 'work-cover-image-v1' }))
    const receipt = await Dexie.waitFor(createVerificationReceiptV1({ version: 1, runId: input.runId,
      generation: live.run.generation, contractHash: live.run.contractHash, contextManifestHashes: [buffer.contextManifestHash],
      candidateHashes: [candidate.candidateHash], adoptionEventIds: [], postStateHash: await Dexie.waitFor(hashCanonicalValue({ assetKey: row.assetKey, blobHash: row.blobHash })),
      verifierSetVersion: 'work-cover-image-v1', criteria: [
        { id: 'cover.candidate', status: 'passed', evidenceRefs: [`candidate:${candidate.candidateHash}`] },
        { id: 'cover.bytes', status: 'passed', evidenceRefs: [`blob:${row.blobHash}`] },
      ], acceptedAt: Date.now() }))
    live = (await createAgentRunCheckpointInTransactionV1({ snapshot: live, resumePayload: {
      version: 1, kind: 'work-cover.candidate-ready', portable: false, candidate, receipt,
    } })).snapshot
    await appendAgentRunEventWithSettlementInTransactionV1({ snapshot: live,
      event: event(live, 'verification.accepted', { receiptHash: receipt.receiptHash }), scope })
    const draft = await db.workCoverDrafts.get(buffer.draftId)
    if (draft && coverRecordInScopeV1(scope, draft) && draft.revision === buffer.draftRevision
      && draft.briefHash === buffer.briefHash && draft.lastRunId === input.runId && draft.expectedWorkUpdatedAt === work.updatedAt) {
      await db.workCoverDrafts.update(draft.id!, { selectedAssetId: id, revision: draft.revision + 1,
        pendingAdoptionJson: null, renderManifestHash: null, updatedAt: Date.now() })
    }
    // Clearing the only raw Buffer is last, in the same transaction as the
    // image, typed candidate, checkpoint and terminal receipt. Quota rolls back all.
    await db.workCoverResponseBuffers.update(buffer.id!, { state: 'candidate-ready', assetId: id, payload: null, updatedAt: Date.now() })
    return { ...row, id }
  }))
}
