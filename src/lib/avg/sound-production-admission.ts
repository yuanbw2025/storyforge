import Dexie from 'dexie'
import { db } from '../db/schema'
import type { ProductBuildArtifactRecordV1, ProductBuildRecordV1, ProductProductionBriefV3, ProductProductionPlanTaskV3, WorkspaceScope } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { readAgentRunV1 } from '../agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import { assembleContext } from '../registry/assemble-context'
import { preserveProductProductionContextV1 } from '../product-production/context'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { readVerifiedMediaBlobObjectData } from '../product-production/media-blob-store'
import { AVG_SOUND_CONTEXT_V1, type AvgSoundPlanningBriefV1 } from './sound-production-brief'
import { hashAvgSoundExactTextV1 } from './sound-planning-evidence'
import { avgSoundFromBase64V1 } from './sound-transport'
import { avgLocalMusicRouteV1, hashAvgSoundBytesV1, parseAvgLocalMusicCapabilityV1, validateAvgSoundProviderResultV1,
  AVG_LOCAL_MUSIC_ADAPTER_V1, type AvgCompiledSoundRequirementV1 } from './sound-provider-contract'
import { AVG_LOCAL_MUSIC_MODEL_V1 } from './sound-requirements'
import { hashAvgTaskRuntimeBindingV1 } from './task-claim'
import { buildAvgRawSoundArtifactV1 } from './sound-raw-contract'
import { inspectAvgSoundBytesV1, parseAvgSoundByteMeasurementV1 } from './sound-decoder'
import { avgHash, avgRecord } from './protocol-validation'

const same = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)
async function exactRunEvidence(scope: WorkspaceScope, runId: number, taskKey: string, kind: 'source-snapshot' | 'raw-response', hash: string) {
  const run = await readAgentRunV1(scope, runId), events = run.events.filter(e => e.type === 'evidence.artifact.recorded'
    && e.payload.artifactKind === kind && e.payload.stepId === taskKey && e.payload.attempt === 1)
  if (run.contract.scope.productProduction?.taskKey !== taskKey || run.projection.steps[taskKey]?.status !== 'succeeded'
    || events.length !== 1 || events[0].type !== 'evidence.artifact.recorded' || events[0].payload.contentHash !== hash) throw new Error('[avg-sound] 原声音输入/响应没有准确已完成Run事件')
  const text = await readAgentRunArtifactExactV1({ projectId: scope.projectId, artifactKind: kind, contentHash: hash })
  if (await hashAvgSoundExactTextV1(text) !== hash || new TextEncoder().encode(text).byteLength !== events[0].payload.byteLength) throw new Error('[avg-sound] 原声音输入/响应字节已改变')
  return { text, run, sequence: events[0].sequence }
}

/** Original response read, usable without service availability or credentials.
 * The caller separately proves actual producer/checkpoint/ledger and sources. */
export async function readAvgSoundOriginalMediaResponseV1(input: { scope: WorkspaceScope; producerRunId: number; taskKey: string;
  requirement: AvgCompiledSoundRequirementV1; responseEvidenceHash: string; idempotencyKey: string;
  musicBinding: AvgSoundPlanningBriefV1['musicBinding'] }) {
  const exact = await exactRunEvidence(input.scope, input.producerRunId, input.taskKey, 'raw-response', avgHash(input.responseEvidenceHash, 'original sound response'))
  const e = avgRecord(JSON.parse(exact.text), ['schema', 'version', 'operation', 'requestIdentityHash', 'requestBodyHash', 'endpointRouteHash',
    'capabilityBindingHash', 'bridgeHash', 'jobId', 'capability', 'status', 'contentType', 'resultHeader', 'result', 'bodyComplete', 'bodyHash',
    'bodyBase64', 'bodyOmitted', 'hashScope', 'automaticRetryAllowed'], 'original sound response')
  const req = input.requirement, generated = req.dispatch.operation === 'generate-music'
  if (e.schema !== 'storyforge.avg.sound-provider-response' || e.version !== 1 || e.operation !== req.dispatch.operation
    || e.requestIdentityHash !== req.identityHash || e.status !== 200 || e.bodyComplete !== true || e.bodyOmitted !== null
    || e.hashScope !== 'full-body' || e.automaticRetryAllowed !== false || typeof e.resultHeader !== 'string'
    || !same(JSON.parse(e.resultHeader), e.result)) throw new Error('[avg-sound] 原声音响应不是完整准确的原始结果')
  const data = avgSoundFromBase64V1(e.bodyBase64)
  if (await hashAvgSoundBytesV1(data) !== e.bodyHash) throw new Error('[avg-sound] 原声音响应内容hash不一致')
  let bridgeHash: string | null = null, jobId: string | null = null, providerJournalId: string | null = null
  if (generated) {
    const capability = parseAvgLocalMusicCapabilityV1(e.capability), route = await avgLocalMusicRouteV1(capability)
    providerJournalId = capability.journalId ?? null
    jobId = await hashAvgSoundExactTextV1(input.idempotencyKey); bridgeHash = capability.bridgeHash
    if (!input.musicBinding || route.bindingHash !== input.musicBinding.bindingHash || route.endpointRouteHash !== input.musicBinding.endpointRouteHash
      || e.capabilityBindingHash !== route.bindingHash || e.endpointRouteHash !== route.endpointRouteHash || e.bridgeHash !== bridgeHash || e.jobId !== jobId
      || e.requestBodyHash !== await hashProductProductionValueV2(req.dispatch.operation === 'generate-music' ? req.dispatch.body : null)) throw new Error('[avg-sound] 原音乐路由/桥接代码/准确请求与冻结声明不一致')
  } else if ([e.capability, e.jobId, e.bridgeHash, e.capabilityBindingHash, e.endpointRouteHash, e.requestBodyHash].some(v => v !== null)) throw new Error('[avg-sound] 原音效导入不能冒充音乐生成')
  const result = await validateAvgSoundProviderResultV1({ requirement: req, data, result: e.result, bridgeHash, jobId, providerJournalId })
  if (result.mimeType !== e.contentType) throw new Error('[avg-sound] 原声音MIME不一致')
  return { ...result, data, evidence: e, run: exact.run, evidenceSequence: exact.sequence }
}

/** Inside existing sealed producer transaction; no independent writer. */
type AvgSoundRawProofInputV1 = { scope: WorkspaceScope; build: ProductBuildRecordV1 & { id: number };
  task: ProductProductionPlanTaskV3; producerRunId: number; artifact: Pick<ProductBuildArtifactRecordV1,
    'artifactKey' | 'kind' | 'mediaKind' | 'payloadJson' | 'metadataJson' | 'qualityJson' | 'rightsJson' | 'contentHash' | 'mimeType' | 'byteSize' | 'blobObjectId'> }
export async function assertAvgSoundRawProducerAdmissionV1(input: AvgSoundRawProofInputV1, brief: ProductProductionBriefV3) {
  await verifyAvgSoundRawProducerV1(input, brief, true)
}
/** Read-only reinspection of an already sealed candidate. Original bytes and
 * author/Run/source proofs remain exact; device resampling and DSP estimates
 * are a new observation, never a rewrite of the original measurement. */
export async function readAvgSoundRawProducerSourceV1(input: AvgSoundRawProofInputV1, brief: ProductProductionBriefV3) {
  return verifyAvgSoundRawProducerV1(input, brief, false)
}
async function verifyAvgSoundRawProducerV1(input: AvgSoundRawProofInputV1, brief: ProductProductionBriefV3, exactMeasurement: boolean) {
  const planning = brief.avgSoundPlanning!, task = input.task, a = input.artifact
  const assembled = await assembleContext({ projectId: input.scope.projectId, scope: input.scope, productProductionId: input.build.productionId,
    productBuildId: input.build.id, productProductionTaskKey: task.taskKey, productArtifactKeys: task.inputArtifactKeys,
    sourceKeys: [AVG_SOUND_CONTEXT_V1], inputBudgetTokens: task.budgetReservation.inputTokens, sourceTransformer: preserveProductProductionContextV1 })
  if (assembled.overBudgetAfterTrim || assembled.segments.length !== 1 || !same(assembled.included, [AVG_SOUND_CONTEXT_V1])
    || !assembled.sourceEvidence?.length || assembled.sourceEvidence.some(s => s.status !== 'included' || s.delivery !== 'full')) throw new Error('[avg-sound] 原音频来源投影不完整')
  const packet = JSON.parse(assembled.segments[0].content), req = packet.requirement as AvgCompiledSoundRequirementV1
  if (!req || packet.operation !== 'produce-compiled-sound') throw new Error('[avg-sound] 缺少准确编译项')
  const generated = req.dispatch.operation === 'generate-music', bindings = generated ? [{ requirementKey: 'avg.media.music', adapterId: AVG_LOCAL_MUSIC_ADAPTER_V1,
    bindingHash: planning.musicBinding!.bindingHash, provider: 'storyforge-local-music', model: AVG_LOCAL_MUSIC_MODEL_V1 }] : []
  if (a.kind !== 'audio' || a.blobObjectId === null || task.taskKey !== `avg.sound.generate.${req.template.requirementKey}`
    || task.kind !== (generated ? 'avg-sound-music-generate' : 'avg-sound-library-import') || task.executionMode !== (generated ? 'media-provider' : 'deterministic')
    || task.skillId !== (generated ? 'avg.sound-request.v1' : null) || task.maxAttempts !== 1 || task.budgetReservation.mediaCalls !== (generated ? 1 : 0)
    || task.budgetReservation.modelCalls !== 0 || task.budgetReservation.maximumCostUsd !== 0) throw new Error('[avg-sound] 原音频producer任务/调用边界不一致')
  const q = JSON.parse(a.qualityJson), payload = JSON.parse(a.payloadJson)
  const originalInput = await exactRunEvidence(input.scope, input.producerRunId, task.taskKey, 'source-snapshot', avgHash(q.requestSnapshotHash, 'sound snapshot'))
  const ledger = JSON.parse(input.build.budgetLedgerJson).tasks?.[task.taskKey]
  const snapshot = JSON.parse(originalInput.text), boundary = originalInput.run.contract.scope.productProduction
  const response = await readAvgSoundOriginalMediaResponseV1({ scope: input.scope, producerRunId: input.producerRunId, taskKey: task.taskKey,
    requirement: req, responseEvidenceHash: avgHash(q.responseEvidenceHash, 'sound response'), idempotencyKey: ledger?.idempotencyKey, musicBinding: planning.musicBinding })
  if (boundary?.productBuildId !== input.build.id || boundary.controlEpoch !== input.build.controlEpoch || boundary.planHash !== input.build.planHash
    || ledger?.runId !== input.producerRunId || ledger.attempt !== 1 || originalInput.run.contract.runtimeBindingHash !== await hashAvgTaskRuntimeBindingV1({ planHash: input.build.planHash, task, capabilityBindings: bindings })
    || originalInput.sequence >= response.evidenceSequence
    || !same(snapshot, { schema: 'storyforge.avg.sound-media-input', version: snapshot.version === 2 ? 2 : 1,
      ...(snapshot.version === 2 ? { capability: response.evidence.capability } : {}), taskKey: task.taskKey, idempotencyKey: ledger.idempotencyKey,
      requirement: req, sourceInputHash: planning.scope.sourceInputHash, scopeHash: packet.scopeHash, planHash: packet.soundPlanHash,
      contextText: assembled.text, inputs: packet.artifacts, musicBinding: generated ? planning.musicBinding : null, capabilityBindings: bindings })) throw new Error('[avg-sound] 原声音输入与实际Harness/作者来源不闭合')
  const m = parseAvgSoundByteMeasurementV1(payload.measurement), expected = buildAvgRawSoundArtifactV1({ planning, requirement: req,
    scopeHash: packet.scopeHash, planHash: packet.soundPlanHash, measurement: m, providerResult: response.result, requestSnapshotHash: q.requestSnapshotHash,
    responseEvidenceHash: q.responseEvidenceHash, contextHash: await hashAvgSoundExactTextV1(assembled.text), inputs: packet.artifacts })
  if (expected.artifactKey !== a.artifactKey || expected.mediaKind !== a.mediaKind || expected.mimeType !== a.mimeType || expected.byteSize !== a.byteSize
    || expected.contentHash !== a.contentHash || !same(expected.payload, payload) || !same(expected.metadata, JSON.parse(a.metadataJson))
    || !same(expected.quality, q) || !same(expected.rights, JSON.parse(a.rightsJson))) throw new Error('[avg-sound] 原音频包络/权利/来源与实际响应不一致')
  const blob = await db.mediaBlobObjects.get(a.blobObjectId!)
  if (!blob || !await assertRecordInScope(input.scope, 'mediaBlobObjects', blob, { owner: 'work' }) || blob.contentHash !== response.contentHash
    || blob.mimeType !== response.mimeType || blob.byteSize !== response.data.byteLength) throw new Error('[avg-sound] 原音频Blob跨Work或与响应不一致')
  const inspect = async () => {
    const data = await readVerifiedMediaBlobObjectData(blob), original = new Uint8Array(response.data)
    if (data.byteLength !== original.length || !new Uint8Array(data).every((v, i) => v === original[i])) throw new Error('[avg-sound] Blob不是原始响应音频')
    return inspectAvgSoundBytesV1({ data, contentHash: response.contentHash, assetKey: req.template.assetKey, mimeType: response.mimeType })
  }
  const measured = (Dexie.currentTransaction ? await Dexie.waitFor(Dexie.ignoreTransaction(inspect), 20_000) : await inspect()).measurement
  if (exactMeasurement ? !same(measured, m) : measured.contentHash !== m.contentHash || measured.mimeType !== m.mimeType
    || measured.byteSize !== m.byteSize || measured.channelCount !== m.channelCount || Math.abs(measured.durationMs - m.durationMs) > 1) {
    throw new Error('[avg-sound] 接收时实际音频解码/信号指标与原测量不一致')
  }
  return { originalMeasurement: m, currentMeasurement: measured }
}
