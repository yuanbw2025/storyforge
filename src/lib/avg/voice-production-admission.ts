import Dexie from 'dexie'
import { db } from '../db/schema'
import type { ProductBuildArtifactRecordV1, ProductBuildRecordV1, ProductProductionPlanTaskV3, WorkspaceScope } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { productProductionTaskExecutionIdentityHashV1 } from '../product-production/scheduler'
import { readVerifiedMediaBlobObjectData } from '../product-production/media-blob-store'
import { readAvgSystemPlanForCompilationV1 } from './author-artifacts'
import { assertAvgStoredAssemblyBriefV3 } from './voice-assembly-storage'
import { assertAvgVoiceProductionPolicyV3 } from './voice-production-policy'
import { AVG_VOICE_CAPABILITY_REQUIREMENT_KEY_V1 } from './voice-assembly-contract'
import { assertAvgRawVoiceArtifactV1 } from './voice-raw-contract'
import { validateAvgVoiceProductionSourcesV1 } from './voice-production-source'
import { assertAvgVoiceProducerResponseV1 } from './voice-response-proof'
import { inspectAvgVoiceBytesV1 } from './voice-decoder'
import { readAvgVoiceRecoverySourceV1, validateAvgVoiceRecoveryV1 } from './voice-recovery'
import { avgVoiceRecoveryParentNumber } from './voice-local-repair-contract'

/** AVG-only additional admission inside the existing sealed-producer write
 * transaction. No new writer, Skill, table, author pass or runtime binding. */
export async function assertAvgVoiceRawProducerAdmissionV3(input: {
  scope: WorkspaceScope; build: ProductBuildRecordV1 & { id: number }; task: ProductProductionPlanTaskV3; producerRunId: number
  artifact: Pick<ProductBuildArtifactRecordV1, 'artifactKey' | 'kind' | 'mediaKind' | 'payloadJson' | 'metadataJson' | 'qualityJson'
    | 'rightsJson' | 'contentHash' | 'mimeType' | 'byteSize' | 'blobObjectId'>
}) {
  const row = await db.productProductionBriefs.where('[productionId+revision]').equals([input.build.productionId, input.build.briefRevision]).first()
  if (!row || !await assertRecordInScope(input.scope, 'productProductionBriefs', row, { owner: 'work' })
    || row.status !== 'authorized' || row.briefHash !== input.build.briefHash || row.authorizedAt !== input.build.authorizedAt) {
    throw new Error('[avg-voice] 接收缺少准确的已授权配音 Brief')
  }
  const brief = parseProductProductionBriefV3(row.briefJson)
  if (brief.avgAssembly?.version !== 3 || await hashProductProductionValueV2(brief) !== input.build.briefHash) throw new Error('[avg-voice] 接收的完整 Brief 已 stale')
  const parse = async () => {
    const resolved = await assertAvgStoredAssemblyBriefV3(brief.avgAssembly)
    assertAvgVoiceProductionPolicyV3({ ...brief, avgAssembly: resolved.assembly })
    const capability = brief.capabilityRequirements.find(c => c.requirementKey === AVG_VOICE_CAPABILITY_REQUIREMENT_KEY_V1)!
    const raw = await assertAvgRawVoiceArtifactV1({ assembly: resolved.assembly, capability, row: input.artifact })
    return { ...resolved, raw }
  }
  const resolved = Dexie.currentTransaction ? await Dexie.waitFor(Dexie.ignoreTransaction(parse), 20_000) : await parse()
  await validateAvgVoiceRecoveryV1({ scope: input.scope, productionId: input.build.productionId, brief,
    targetBuild: input.build, checkProspectiveRequests: false })
  const { assembly, raw } = resolved, r = raw.payload.requirement, task = input.task
  const retained = assembly.voice.recovery?.retained.some(item => item.requirementKey === r.requirementKey) ?? false
  if (task.taskKey !== `avg.voice.generate.${r.requirementKey}` || task.kind !== (retained ? 'avg-media-voice-reuse' : 'avg-media-voice-generate')
    || task.executionMode !== (retained ? 'deterministic' : 'media-provider') || task.skillId !== (retained ? null : 'avg.media-request.v1') || task.maxAttempts !== 1
    || retained && task.contextProfile !== 'avg-task-v1'
    || task.budgetReservation.mediaCalls !== (retained ? 0 : 1) || task.budgetReservation.modelCalls !== 0
    || canonicalProductProductionJsonV2(task.capabilityRequirementKeys) !== canonicalProductProductionJsonV2([AVG_VOICE_CAPABILITY_REQUIREMENT_KEY_V1])
    || canonicalProductProductionJsonV2(task.outputArtifactKeys) !== canonicalProductProductionJsonV2([input.artifact.artifactKey])) {
    throw new Error('[avg-voice] producer 不属于准确单句、单次、已登记配音任务')
  }
  const binding = { requirementKey: assembly.voice.binding.requirementKey, adapterId: assembly.voice.binding.adapterId,
    bindingHash: assembly.voice.binding.bindingHash, provider: assembly.voice.protocol.provider, model: assembly.voice.protocol.model }
  const runtimeBindingHash = await hashProductProductionValueV2({ schema: 'storyforge.product-production-task-runtime', version: 1,
    executor: 'product-production-scheduler', planHash: input.build.planHash, taskKey: task.taskKey, taskKind: task.kind,
    executionMode: task.executionMode, skillId: task.skillId, executionIdentityHash: await productProductionTaskExecutionIdentityHashV1(task),
    capabilityBindingHash: await hashProductProductionValueV2([binding]) })
  const run = await db.agentRuns.get(input.producerRunId)
  if (!run || (JSON.parse(run.contractJson) as { runtimeBindingHash?: string }).runtimeBindingHash !== runtimeBindingHash) throw new Error('[avg-voice] producer 与实际 Harness 能力绑定不一致')
  const source = await readAvgSystemPlanForCompilationV1({ scope: input.scope, buildId: input.build.id,
    expectedBuildRevision: input.build.stateRevision, controlEpoch: input.build.controlEpoch, includeSceneScripts: true })
  const required = new Set(assembly.voice.batch.requirements.map(r => r.script.artifactKey))
  const checkSource = () => validateAvgVoiceProductionSourcesV1(assembly.voice.batch,
    { systemPlan: source.plan, scripts: source.scripts.map(s => s.payload) },
    source.scripts.filter(s => required.has(s.artifact.artifactKey)).map(s => ({ ...s.artifact, payload: s.payload })))
  if (Dexie.currentTransaction) await Dexie.waitFor(Dexie.ignoreTransaction(checkSource), 20_000)
  else await checkSource()
  const quality = JSON.parse(input.artifact.qualityJson) as Record<string, unknown>
  if (quality.contentHashVerified !== true || quality.decoderVerified !== true
    || canonicalProductProductionJsonV2(quality.sourceRule) !== canonicalProductProductionJsonV2(source.artifact)
    || canonicalProductProductionJsonV2(quality.sourceScripts) !== canonicalProductProductionJsonV2(source.scripts.map(s => s.artifact))) {
    throw new Error('[avg-voice] 配音接收不能替换真实已采用的规则、脚本或字节证据')
  }
  let response: Awaited<ReturnType<typeof assertAvgVoiceProducerResponseV1>>
  if (retained) {
    if (input.build.parentBuildNumber !== avgVoiceRecoveryParentNumber(assembly.voice.recovery!)) throw new Error('[avg-voice] 配音复验不属于准确父版本')
    const prior = await readAvgVoiceRecoverySourceV1({ scope: input.scope, productionId: input.build.productionId,
      assembly, requirementKey: r.requirementKey })
    if (quality.schema !== 'storyforge.avg.raw-voice-revalidation' || quality.version !== 1 || quality.noProviderRequest !== true
      || canonicalProductProductionJsonV2(quality.retainedOrigin) !== canonicalProductProductionJsonV2(prior.proof)
      || input.artifact.payloadJson !== prior.artifact.payloadJson || input.artifact.metadataJson !== prior.artifact.metadataJson
      || input.artifact.rightsJson !== prior.artifact.rightsJson || input.artifact.contentHash !== prior.artifact.contentHash) {
      throw new Error('[avg-voice] 配音复验不能改写原字节、需求、权利或冒充新请求')
    }
    response = prior.origin
  } else {
    if (quality.received !== true || quality.rawResponseRecorded !== true) throw new Error('[avg-voice] 新配音缺少实际响应记录')
    response = await assertAvgVoiceProducerResponseV1({ scope: input.scope, buildId: input.build.id,
      controlEpoch: input.build.controlEpoch, producerRunId: input.producerRunId, quality, raw: raw.payload })
  }
  const blob = input.artifact.blobObjectId == null ? null : await db.mediaBlobObjects.get(input.artifact.blobObjectId)
  if (!blob || !await assertRecordInScope(input.scope, 'mediaBlobObjects', blob, { owner: 'work' }) || blob.contentHash !== raw.asset.contentHash
    || blob.mimeType !== raw.asset.mimeType || blob.byteSize !== raw.asset.byteSize) throw new Error('[avg-voice] 接收缺少同作品的准确音频 Blob')
  const inspect = async () => {
    const data = await readVerifiedMediaBlobObjectData(blob), expected = new Uint8Array(response.data)
    if (data.byteLength !== expected.length || !new Uint8Array(data).every((v, i) => v === expected[i])) throw new Error('[avg-voice] 实际 Blob 与原始配音响应不一致')
    return inspectAvgVoiceBytesV1({ data, contentHash: raw.asset.contentHash, assetKey: raw.asset.assetKey, maximumDurationMs: r.maximumDurationMs })
  }
  const measured = (Dexie.currentTransaction ? await Dexie.waitFor(Dexie.ignoreTransaction(inspect), 20_000) : await inspect()).measurement
  if (measured.channelCount !== raw.payload.measurement.channelCount || measured.sourceSampleRateHz !== raw.payload.measurement.sourceSampleRateHz
    || measured.sampleCount !== raw.payload.measurement.sampleCount || Math.abs(measured.durationMs - raw.payload.measurement.durationMs) > 1) {
    throw new Error('[avg-voice] 接收时的真实解码不符合原始 PCM 测量')
  }
}
