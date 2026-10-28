import Dexie from 'dexie'
import { db } from '../db/schema'
import type { ProductBuildArtifactRecordV1, ProductBuildRecordV1, ProductProductionBriefV3, ProductProductionPlanTaskV3, WorkspaceScope } from '../types'
import { assembleContext } from '../registry/assemble-context'
import { preserveProductProductionContextV1 } from '../product-production/context'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { readAgentRunV1 } from '../agent/run/event-store'
import { assertRecordInScope } from '../workspace/scope'
import { readVerifiedMediaBlobObjectData } from '../product-production/media-blob-store'
import { AVG_SOUND_CONTEXT_V1, parseAvgSoundPlanningBriefV2 } from './sound-production-brief'
import { readAvgSoundReuseRetainedArtifactV1 } from './sound-reuse-source'
import { parseAvgSoundRevalidationEvidenceV1 } from './sound-reuse-contract'
import { hashAvgSoundExactTextV1 } from './sound-planning-evidence'
import { hashAvgTaskRuntimeBindingV1 } from './task-claim'
import { inspectAvgSoundBytesV1, parseAvgSoundByteMeasurementV1 } from './sound-decoder'

const same = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)
type Input = { scope: WorkspaceScope; build: ProductBuildRecordV1 & { id: number }; task: ProductProductionPlanTaskV3; producerRunId: number
  artifact: Pick<ProductBuildArtifactRecordV1, 'artifactKey' | 'kind' | 'mediaKind' | 'payloadJson' | 'metadataJson' | 'qualityJson' | 'rightsJson' | 'contentHash' | 'mimeType' | 'byteSize' | 'blobObjectId'> }

/** Called only after the existing sealed writer/reader proves the real new
 * producer, checkpoint, candidate and ledger. Origin proof never supplies a
 * new Run or adoption receipt. The original response stays in its old Run. */
export async function assertAvgSoundReuseProducerV1(input: Input, brief: ProductProductionBriefV3): Promise<null | {
  originalMeasurement: ReturnType<typeof parseAvgSoundByteMeasurementV1>; currentMeasurement: ReturnType<typeof parseAvgSoundByteMeasurementV1>
}> {
  const { repair } = parseAvgSoundPlanningBriefV2(brief.avgSoundPlanning), { task, artifact: a, build } = input
  const raw = task.kind === 'avg-sound-raw-reuse', compile = task.kind === 'avg-sound-requirements-reuse'
  const key = repair.source.requirementKey
  if ((!raw && !compile) || task.taskKey !== (raw ? `avg.sound.generate.${key}` : 'avg.sound.compile.requirements')
    || !same(task.outputArtifactKeys, [raw ? `avg.sound.raw.${key}` : 'avg.media.compiled-sound-requirements'])
    || a.artifactKey !== task.outputArtifactKeys[0] || task.executionMode !== 'deterministic' || task.skillId !== null
    || task.contextProfile !== 'avg-sound-planning-v1' || task.maxAttempts !== 1 || task.capabilityRequirementKeys.length
    || task.reuse !== null || task.fallbackTaskKey !== null || task.budgetReservation.modelCalls !== 0
    || task.budgetReservation.mediaCalls !== 0 || task.budgetReservation.outputTokens !== 0 || task.budgetReservation.maximumCostUsd !== 0
    || build.parentBuildNumber !== repair.parent.buildNumber || repair.parent.buildNumber >= build.buildNumber) {
    throw new Error('[avg-sound-repair] 复验必须属于准确父预览后的单次零调用新任务')
  }
  const assembled = await assembleContext({ projectId: input.scope.projectId, scope: input.scope,
    productProductionId: build.productionId, productBuildId: build.id, productProductionTaskKey: task.taskKey,
    productArtifactKeys: task.inputArtifactKeys, sourceKeys: [AVG_SOUND_CONTEXT_V1], inputBudgetTokens: task.budgetReservation.inputTokens,
    sourceTransformer: preserveProductProductionContextV1 })
  if (assembled.overBudgetAfterTrim || assembled.segments.length !== 1 || !same(assembled.included, [AVG_SOUND_CONTEXT_V1])
    || !assembled.sourceEvidence?.length || assembled.sourceEvidence.some(s => s.status !== 'included' || s.delivery !== 'full')) {
    throw new Error('[avg-sound-repair] 本地复验缺少准确完整登记上下文')
  }
  const packet = JSON.parse(assembled.segments[0].content), q = parseAvgSoundRevalidationEvidenceV1(a.qualityJson)
  const expected = parseAvgSoundRevalidationEvidenceV1({ schema: raw ? 'storyforge.avg.raw-sound-revalidation' : 'storyforge.avg.sound-requirements-revalidation',
    version: 1, noProviderRequest: true, retainedOrigin: repair.source, sourceBuildRevision: repair.sourceBuildRevision,
    repairHash: await hashProductProductionValueV2(repair), sourceContextHash: await hashAvgSoundExactTextV1(assembled.text),
    inputs: packet.artifacts, contentHashVerified: true, ...(raw ? { decoderVerified: true, hearing: 'unobserved', authorAdopted: false } : {}) })
  const retained = await readAvgSoundReuseRetainedArtifactV1({ scope: input.scope, repair, raw, packet })
  const original = retained.row
  if (packet.version !== 2 || packet.operation !== (raw ? 'reuse-original-sound' : 'reuse-original-sound-requirements')
    || !same(q, expected) || a.payloadJson !== original.payloadJson || a.metadataJson !== original.metadataJson
    || a.rightsJson !== original.rightsJson || a.contentHash !== original.contentHash || a.kind !== original.kind
    || a.mediaKind !== original.mediaKind || a.mimeType !== original.mimeType || a.byteSize !== original.byteSize
    || (!raw && a.blobObjectId !== null)) throw new Error('[avg-sound-repair] 复验不能改写完整原方案、请求、字节、元数据或许可')
  const run = await readAgentRunV1(input.scope, input.producerRunId), boundary = run.contract.scope.productProduction
  if (boundary?.productBuildId !== build.id || boundary.taskKey !== task.taskKey
    || boundary.planHash !== build.planHash || boundary.controlEpoch !== build.controlEpoch
    || run.contract.runtimeBindingHash !== await hashAvgTaskRuntimeBindingV1({ planHash: build.planHash, task, capabilityBindings: [] })
    || run.events.some(e => e.type === 'model.requested' || e.type === 'tool.called'
      || e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'raw-response')) {
    throw new Error('[avg-sound-repair] 本地复验必须有自己的真实零派发Run，不能伪造新供应商响应')
  }
  if (!raw) return null
  const blob = a.blobObjectId === null ? null : await db.mediaBlobObjects.get(a.blobObjectId)
  if (!blob?.id || !await assertRecordInScope(input.scope, 'mediaBlobObjects', blob, { owner: 'work' })
    || blob.contentHash !== original.contentHash || blob.mimeType !== original.mimeType || blob.byteSize !== original.byteSize) {
    throw new Error('[avg-sound-repair] 复验原件Blob缺失、跨作品或不等于准确原音频')
  }
  const inspect = async () => {
    const data = await readVerifiedMediaBlobObjectData(blob), expected = new Uint8Array(retained.data!)
    if (data.byteLength !== expected.byteLength || !new Uint8Array(data).every((v, i) => v === expected[i])) {
      throw new Error('[avg-sound-repair] 复验必须从准确原件开始，不能把旧加工结果当成原件')
    }
    return inspectAvgSoundBytesV1({ data, contentHash: a.contentHash, mimeType: 'audio/wav', assetKey: JSON.parse(original.metadataJson).assetKey })
  }
  const observation = await (Dexie.currentTransaction ? Dexie.waitFor(Dexie.ignoreTransaction(inspect), 20_000) : inspect())
  const m = parseAvgSoundByteMeasurementV1(JSON.parse(original.payloadJson).measurement), current = observation.measurement
  if (current.contentHash !== m.contentHash || current.byteSize !== m.byteSize || current.channelCount !== m.channelCount
    || Math.abs(current.durationMs - m.durationMs) > 1) throw new Error('[avg-sound-repair] 复验原件解码与原测量不一致')
  return { originalMeasurement: m, currentMeasurement: current }
}
