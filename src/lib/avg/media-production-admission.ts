import { inspectAvgRevalidatedRawV4 } from './visual-image-revalidation'
import { db } from '../db/schema'
import { validateAvgVoiceRecoveryV1 } from './voice-recovery'
import type { ProductBuildArtifactRecordV1, ProductBuildRecordV1, ProductProductionPlanTaskV3, WorkspaceScope } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { hashProductProductionValueV2 } from '../product-production/hash'
import { productProductionTaskExecutionIdentityHashV1 } from '../product-production/scheduler'
import { readAvgSystemPlanForCompilationV1 } from './author-artifacts'
import { assertAvgRawImageArtifactV1 } from './media-raw-contract'
import { assertAvgMediaConsumerDeclarationsV1, validateAvgVisualProductionBatchSourceV1 } from './media-source'
import { assertAvgImageProductionDefinitionV3 } from './media-production-definition'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { assertAvgOriginalImageResponseV1 } from './media-response-proof'
import { readAvgImageRecoverySourceV1 } from './media-recovery'
import { validateAvgGeneratedReferencesV1 } from './media-generated-reference'
import { assertAvgProcessedImageArtifactV1 } from './image-processing-contract'
import { verifyAcceptedProductBuildArtifactV1 } from '../product-production/artifact-store'
import { assertAvgRawImageOriginV1 } from './media-recovery'
import { readAvgCompiledImageDefinitionV4 } from './visual-planning-image-definition'
import { assertAvgRawImageArtifactFromDefinitionV1 } from './media-raw-contract'
import { AVG_COMPILED_IMAGE_SKILL_V4, AVG_VISUAL_PLANNING_CONTEXT_V1 } from './visual-planning-roles'
import { hashAvgTaskRuntimeBindingV1 } from './task-claim'
import { avgRecord } from './protocol-validation'
import { assembleContext } from '../registry/assemble-context'
import { preserveProductProductionContextV1 } from '../product-production/context'
import { inspectAvgVisualProcessedImageV4 } from './visual-image-processing'
import { parseAvgProcessedImagePayloadV1 } from './image-processing-contract'
import { assertAvgCompiledImageProducerAdmissionV5 } from './visual-image-admission-v5'

/** Extra product admission inside the shared sealed-producer transaction.
 * The caller separately verifies exact checkpoint/result/Plan/Blob proof. */
export async function assertAvgMediaRawProducerAdmissionV2(input: {
  scope: WorkspaceScope
  build: ProductBuildRecordV1 & { id: number }
  task: ProductProductionPlanTaskV3
  producerRunId: number
  artifact: Pick<ProductBuildArtifactRecordV1, 'artifactKey' | 'requirementKey' | 'kind' | 'mediaKind' | 'payloadJson' | 'metadataJson' | 'qualityJson' | 'rightsJson' | 'contentHash' | 'mimeType' | 'byteSize' | 'blobObjectId'>
}) {
  const row = await db.productProductionBriefs.where('[productionId+revision]').equals([input.build.productionId, input.build.briefRevision]).first()
  if (!row || !await assertRecordInScope(input.scope, 'productProductionBriefs', row, { owner: 'work' }) || row.status !== 'authorized'
    || row.briefHash !== input.build.briefHash) throw new Error('[avg-media] 原图接收缺少准确的已授权 Brief')
  const brief = parseProductProductionBriefV3(row.briefJson)
  if (brief.avgVisualPlanning) return brief.avgVisualPlanning.version===5?assertAvgCompiledImageProducerAdmissionV5(input,brief):assertAvgCompiledImageProducerAdmissionV4(input, brief)
  const {assembly,capability}=await assertAvgImageProductionDefinitionV3(brief)
  await validateAvgVoiceRecoveryV1({ scope: input.scope, productionId: input.build.productionId, brief,
    targetBuild: input.build, checkProspectiveRequests: false })
  if (await hashProductProductionValueV2(brief) !== input.build.briefHash) throw new Error('[avg-media] 原图 Brief 已 stale')
  if(input.artifact.artifactKey.startsWith('avg.media.processed.')){
    const image=await assertAvgProcessedImageArtifactV1(brief,input.artifact),task=input.task,p=image.payload
    const raw=await verifyAcceptedProductBuildArtifactV1({scope:input.scope,buildId:input.build.id,...p.raw})
    const original=await assertAvgRawImageArtifactV1(brief,raw)
    await assertAvgRawImageOriginV1({scope:input.scope,productionId:input.build.productionId,brief,build:input.build,artifact:raw,requirementKey:p.requirementKey,taskKey:`avg.media.generate.${p.requirementKey}`},[input.build.buildNumber])
    if(raw.producerReceiptHash!==p.raw.producerReceiptHash||canonicalProductProductionJsonV2(p.sourceAsset)!==canonicalProductProductionJsonV2(original.asset)
      ||task.taskKey!==`avg.media.process.${p.requirementKey}`||task.kind!=='avg-media-image-process'||task.executionMode!=='deterministic'||task.skillId!==null
      ||task.maxAttempts!==1||task.budgetReservation.mediaCalls!==0||task.budgetReservation.modelCalls!==0||task.capabilityRequirementKeys.length!==0
      ||canonicalProductProductionJsonV2(task.inputArtifactKeys)!==canonicalProductProductionJsonV2([raw.artifactKey])
      ||canonicalProductProductionJsonV2(task.outputArtifactKeys)!==canonicalProductProductionJsonV2([input.artifact.artifactKey]))throw new Error('[avg-process] 加工 producer 与准确原图或本地任务不闭合')
    const expectedRuntime=await hashProductProductionValueV2({schema:'storyforge.product-production-task-runtime',version:1,executor:'product-production-scheduler',planHash:input.build.planHash,
      taskKey:task.taskKey,taskKind:task.kind,executionMode:task.executionMode,skillId:task.skillId,executionIdentityHash:await productProductionTaskExecutionIdentityHashV1(task),capabilityBindingHash:null})
    const run=await db.agentRuns.get(input.producerRunId),quality=JSON.parse(input.artifact.qualityJson)
    if(!run||(JSON.parse(run.contractJson) as {runtimeBindingHash?:string}).runtimeBindingHash!==expectedRuntime
      ||canonicalProductProductionJsonV2(quality)!==canonicalProductProductionJsonV2({processingReceiptHash:p.receipt.receiptHash,rawProducerReceiptHash:raw.producerReceiptHash,noProviderRequest:true,decoderVerified:true}))throw new Error('[avg-process] 加工 receipt 与本地 Harness 绑定不一致')
    return
  }
  const raw = await assertAvgRawImageArtifactV1(brief, input.artifact), r = raw.payload.requirement, task = input.task
  await validateAvgGeneratedReferencesV1(input.scope, r.references, r.family)
  const retained=assembly.imageRecovery?.retained.some(ref=>ref.requirementKey===r.requirementKey)??false
  if (task.taskKey !== `avg.media.generate.${r.requirementKey}` || task.kind !== (retained?'avg-media-image-reuse':'avg-media-image-generate')
    || task.executionMode !== (retained?'deterministic':'media-provider') || task.skillId !== (retained?null:(brief.avgAssembly?.version===3?'avg.media-request.v1':'product-production.media-request.v1'))
    || task.budgetReservation.mediaCalls !== (retained?0:1)
    || task.outputArtifactKeys.length !== 1 || task.outputArtifactKeys[0] !== input.artifact.artifactKey || task.maxAttempts !== 1) {
    throw new Error('[avg-media] 原图 producer 不在准确的已登记图片任务中')
  }
  const run = await db.agentRuns.get(input.producerRunId)
  const binding = { requirementKey: capability.requirementKey, adapterId: raw.payload.request.request.adapterId,
    bindingHash: raw.payload.capabilityBindingHash }
  const runtimeBindingHash = await hashProductProductionValueV2({ schema: 'storyforge.product-production-task-runtime', version: 1,
    executor: 'product-production-scheduler', planHash: input.build.planHash, taskKey: task.taskKey, taskKind: task.kind,
    executionMode: task.executionMode, skillId: task.skillId, executionIdentityHash: await productProductionTaskExecutionIdentityHashV1(task),
    capabilityBindingHash: await hashProductProductionValueV2([binding]) })
  if (!run || (JSON.parse(run.contractJson) as { runtimeBindingHash?: string }).runtimeBindingHash !== runtimeBindingHash) {
    throw new Error('[avg-media] 原图 receipt 与 Harness 的实际能力绑定不一致')
  }
  const source = await readAvgSystemPlanForCompilationV1({ scope: input.scope, buildId: input.build.id,
    expectedBuildRevision: input.build.stateRevision, controlEpoch: input.build.controlEpoch, includeSceneScripts: true })
  await validateAvgVisualProductionBatchSourceV1(assembly.mediaBatch, { systemPlan: source.plan,
    scripts: source.scripts.map(row => row.payload), presentation: { aspectRatio: assembly.mediaBatch.aspectRatio } })
  assertAvgMediaConsumerDeclarationsV1(assembly.mediaBatch, source.plan)
  const quality = JSON.parse(input.artifact.qualityJson) as Record<string, unknown>
  if ( canonicalProductProductionJsonV2(quality.sourceRule) !== canonicalProductProductionJsonV2(source.artifact)
    || canonicalProductProductionJsonV2(quality.sourceScripts) !== canonicalProductProductionJsonV2(source.scripts.map(row => row.artifact))) {
    throw new Error('[avg-media] 原图接收证据不能冒充解码或替换来源')
  }
  if(retained){
    if(input.build.parentBuildNumber!==assembly.imageRecovery!.sourceBuildNumber)throw new Error('[avg-media] 复用原图的父 Build 不一致')
    const prior=await readAvgImageRecoverySourceV1({scope:input.scope,productionId:input.build.productionId,brief,requirementKey:r.requirementKey})
    if(quality.schema!=='storyforge.avg.raw-image-revalidation'||quality.version!==1||quality.noProviderRequest!==true||quality.contentHashVerified!==true||quality.decoderVerified!==false
      ||canonicalProductProductionJsonV2(quality.retainedOrigin)!==canonicalProductProductionJsonV2(prior.proof)
      ||input.artifact.payloadJson!==prior.artifact.payloadJson||input.artifact.metadataJson!==prior.artifact.metadataJson||input.artifact.rightsJson!==prior.artifact.rightsJson
      ||input.artifact.contentHash!==prior.artifact.contentHash)throw new Error('[avg-media] 复用原图不能替换旧字节、需求、权利或冒充新请求')
  }else{
    if(quality.received!==true||quality.rawResponseRecorded!==true||quality.headerVerified!==true||quality.contentHashVerified!==true||quality.decoderVerified!==false)throw new Error('[avg-media] 原图接收证据不能冒充解码')
    await assertAvgOriginalImageResponseV1(input.scope,input.producerRunId,task.taskKey,quality)
  }
}

async function assertAvgCompiledImageProducerAdmissionV4(input: Parameters<typeof assertAvgMediaRawProducerAdmissionV2>[0], brief: import('../types').ProductProductionBriefV3): Promise<void> {
  const d = await readAvgCompiledImageDefinitionV4({ scope: input.scope, buildId: input.build.id,
    expectedBuildRevision: input.build.stateRevision, controlEpoch: input.build.controlEpoch, expectedBrief: brief })
  const task = input.task, a = input.artifact
  if(a.artifactKey.startsWith('avg.media.processed.')){
    const payload=await parseAvgProcessedImagePayloadV1(a.payloadJson)
    const raw=await verifyAcceptedProductBuildArtifactV1({scope:input.scope,buildId:input.build.id,...payload.raw})
    const processed=await inspectAvgVisualProcessedImageV4({scope:input.scope,compiled:d,raw,artifact:a})
    const run=await db.agentRuns.get(input.producerRunId)
    if(!run||(JSON.parse(run.contractJson) as {runtimeBindingHash?:string}).runtimeBindingHash!==await hashAvgTaskRuntimeBindingV1({
      planHash:input.build.planHash,task,capabilityBindings:[]}))throw new Error('[avg-process] 加工不属于准确无能力绑定的 Harness')
    await assertContext(processed.sourceContextHash);return
  }
  if(task.kind==='avg-media-image-reuse'){
    const raw=await inspectAvgRevalidatedRawV4({scope:input.scope,compiled:d,artifact:a})
    const run=await db.agentRuns.get(input.producerRunId)
    if(!run||(JSON.parse(run.contractJson) as {runtimeBindingHash?:string}).runtimeBindingHash!==await hashAvgTaskRuntimeBindingV1({
      planHash:input.build.planHash,task,capabilityBindings:[]}))throw new Error('[avg-visual-raw-reuse] 原图复验不属于实际无能力绑定的 Harness')
    await assertContext(raw.sourceContextHash);return
  }
  if (task.kind !== 'avg-media-image-generate' || task.executionMode !== 'media-provider' || task.skillId !== AVG_COMPILED_IMAGE_SKILL_V4
    || task.maxAttempts !== 1 || task.budgetReservation.mediaCalls !== 1 || task.budgetReservation.modelCalls !== 0
    || task.outputArtifactKeys.length !== 1 || task.outputArtifactKeys[0] !== a.artifactKey
    || !task.inputArtifactKeys.includes(d.definition.compilation.artifactKey)) throw new Error('[avg-visual-image] 原图不是准确 V4 编译需求的单次图片任务')
  const raw = await assertAvgRawImageArtifactFromDefinitionV1({ ...d.definition, capability: d.capability, qualityProfile: brief.qualityProfile }, a)
  if (task.taskKey !== `avg.media.generate.${raw.payload.requirement.requirementKey}`) throw new Error('[avg-visual-image] 原图的准确需求写域不一致')
  const binding = { requirementKey: d.capability.requirementKey, adapterId: raw.payload.request.request.adapterId, bindingHash: raw.payload.capabilityBindingHash }
  const run = await db.agentRuns.get(input.producerRunId)
  if (!run || (JSON.parse(run.contractJson) as { runtimeBindingHash?: string }).runtimeBindingHash !== await hashAvgTaskRuntimeBindingV1({
    planHash: input.build.planHash, task, capabilityBindings: [binding] })) throw new Error('[avg-visual-image] 原图路由与实际冻结 Harness 不一致')
  const q = avgRecord(JSON.parse(a.qualityJson), ['received', 'rawResponseRecorded', 'responseEvidenceHash', 'headerVerified', 'contentHashVerified',
    'decoderVerified', 'referenceTransmission', 'sourceRule', 'sourceScripts', 'sourceCompilation', 'sourceContextHash'], 'compiled image evidence')
  const same = (l: unknown, r: unknown) => canonicalProductProductionJsonV2(l) === canonicalProductProductionJsonV2(r)
  if (q.received !== true || q.rawResponseRecorded !== true || q.headerVerified !== true || q.contentHashVerified !== true || q.decoderVerified !== false
    || !same(q.sourceRule, d.source.artifact) || !same(q.sourceScripts, d.source.scripts.map(s => s.artifact))
    || !same(q.sourceCompilation, d.definition.compilation)) throw new Error('[avg-visual-image] 原图接收不能替换编译来源或冒充解码/艺术验收')
  await assertAvgOriginalImageResponseV1(input.scope, input.producerRunId, task.taskKey, q)
  await assertContext(q.sourceContextHash)
  async function assertContext(sourceContextHash:unknown){
    const assembled = await assembleContext({ projectId: input.scope.projectId, scope: input.scope,
      productProductionId: input.build.productionId, productBuildId: input.build.id, productProductionTaskKey: task.taskKey,
      productArtifactKeys: task.inputArtifactKeys, sourceKeys: [AVG_VISUAL_PLANNING_CONTEXT_V1],
      inputBudgetTokens: task.budgetReservation.inputTokens, sourceTransformer: preserveProductProductionContextV1 })
    if (assembled.overBudgetAfterTrim || assembled.segments.length !== 1 || !assembled.sourceEvidence?.length
      || assembled.sourceEvidence.some(s => s.status !== 'included' || s.delivery !== 'full')
      || sourceContextHash !== await hashProductProductionValueV2(assembled.text)) throw new Error('[avg-visual-image] 原图的实际登记输入与编译来源不一致')
  }
}
