import type { FrozenRuntimeMediaAssetV2, ProductProductionBriefV3 } from '../types'
import type { ResolvedProductMediaCapabilityV1 } from '../product-production/media-transport'
import { detectProductImageDimensionsV1, type MediaProviderTransportV1, type MediaTransportResponseV1 } from '../product-production/media-adapters'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { putMediaBlobObject, sha256MediaData } from '../product-production/media-blob-store'
import { ProductProductionDraftRejectedErrorV1, ProductProductionResultUnknownErrorV1,
  type ProductProductionTaskExecutionInputV1, type ProductProductionTaskExecutionResultV1, type ProductProductionTaskUsageV1 } from '../product-production/scheduler'
import { assertExactRunArtifactBodySafeV1 } from '../memory/evidence-policy'
import { readAvgImageTaskSourcesV2 } from './media-task-source'
import { validateAvgGeneratedReferencesV1 } from './media-generated-reference'
import { createAvgDraftReferenceAdapterV1,createAvgDraftReferenceAdapterV2 } from './editor-service'
import { assertAvgImageProductionDefinitionV3 } from './media-production-definition'
import { avgVoiceProductionEnabledV3 } from './assembly-contract'
import { avgImageReferenceCapabilityV2 } from './media-reference-contract'
import { avgRawMediaArtifactKeyV1,parseAvgVisualProductionRequirementV1 } from './media-production-contract'
import { prepareAvgRawImageRequestV1, prepareAvgRawImageRequestFromBatchV1, type AvgRawImagePayloadV1 } from './media-raw-contract'
import { AVG_IMAGE_CAPABILITY_REQUIREMENT_KEY_V1 } from './assembly-plan'
import { avgImageRouteBindingHashV2 } from './media-capability'
import { inspectAvgImageBytesV1 } from './image-decoder'
import { avgMediaProductionEnabledV2 } from './assembly-contract'
import { readAvgCompiledImageDefinitionV4 } from './visual-planning-image-definition'
import { readAvgVisualPlanningExecutionSourcesV4 } from './visual-planning-task-source'
import { avgVisualPlanningExecutionReadyV4 } from './visual-planning-brief'
import { AVG_COMPILED_IMAGE_SKILL_V4 } from './visual-planning-roles'
import { readAvgCompiledImageDefinitionV5 } from './visual-planning-image-definition-v5'
import { readAvgVisualPlanningExecutionSourcesV5 } from './visual-planning-task-source-v5'
import { avgVisualPlanningExecutionReadyV5 } from './visual-planning-brief-v5'
import { AVG_COMPILED_IMAGE_SKILL_V5 } from './visual-planning-plan-v5'
import { prepareAvgRawImageRequestFromBatchV2 } from './media-request-v2'
import type { AvgRawImagePayloadV2 } from './media-raw-contract-v2'

const MAXIMUM_RESPONSE_EVIDENCE_BYTES = 48 * 1024 * 1024
function base64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes)
  let text = ''
  for (let i = 0; i < view.length; i += 16_384) text += String.fromCharCode(...view.subarray(i, i + 16_384))
  return btoa(text)
}

/** The raw JSON (including original base64 output) survives parse/decode errors
 * in the existing exact Run artifact lifecycle; it contains no local Blob IDs.
 * Unsafe or out-of-contract bodies keep only a hash and an explicit omission. */
export async function avgImageResponseEvidenceV1(response: MediaTransportResponseV1, rawText?: string): Promise<string> {
  const body = { schema: 'storyforge.avg.image-provider-response', version: 1, status: response.status,
    contentType: response.contentType, providerRequestId: response.providerRequestId, usage: response.usage ?? null,
    costUsd: response.costUsd, json: response.json ?? null, ...(rawText === undefined ? {} : { rawText }),
    binaryBodyHash: response.body === null ? null : await crypto.subtle.digest('SHA-256', response.body).then(value =>
      Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, '0')).join('')),
    binaryBodyBase64: response.body !== null && response.body.byteLength <= 32 * 1024 * 1024 ? base64(response.body) : null }
  const text = canonicalProductProductionJsonV2(body)
  let omitted: 'policy' | 'size' | null = null
  try {
    assertExactRunArtifactBodySafeV1({ artifactKind: 'raw-response', body })
    if (rawText !== undefined) {
      try { assertExactRunArtifactBodySafeV1({ artifactKind: 'raw-response', body: JSON.parse(rawText) }) }
      catch (error) {
        if (!(error instanceof SyntaxError)) throw error
        if (/["']?(?:authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret)["']?\s*[:=]/i.test(rawText)) throw new Error('unsafe response fields')
      }
    }
  } catch { omitted = 'policy' }
  const byteSize = new TextEncoder().encode(text).byteLength
  if (byteSize > MAXIMUM_RESPONSE_EVIDENCE_BYTES) omitted = 'size'
  return omitted ? canonicalProductProductionJsonV2({ schema: 'storyforge.avg.image-provider-response-omitted', version: 1,
    responseHash: await hashProductProductionValueV2(body), byteSize, reason: omitted, status: response.status }) : text
}

/** Called only inside the shared media-provider task/Harness. It receives an
 * original image, never approves art, processes pixels or binds runtime slots. */
export async function executeAvgMediaImageTaskV2(input: ProductProductionTaskExecutionInputV1, options: {
  brief: ProductProductionBriefV3
  mediaCapabilities: ReadonlyMap<string, ResolvedProductMediaCapabilityV1>
  imageEndpointRouteHash?: string
}): Promise<ProductProductionTaskExecutionResultV1> {
  const started = Date.now()
  let response: MediaTransportResponseV1 | null = null, evidenceBytes = 0
  const usage = (mediaCalls: number, storageBytes = evidenceBytes): ProductProductionTaskUsageV1 => ({ modelCalls: 0, inputTokens: 0, outputTokens: 0,
    mediaCalls, costUsd: !mediaCalls ? 0 : typeof response?.costUsd === 'number' && Number.isFinite(response.costUsd) && response.costUsd >= 0 ? response.costUsd : null,
    durationMs: Date.now() - started, storageBytes })
  try {
    if (!avgMediaProductionEnabledV2()) throw new Error('[avg-media] 实验性图片生产未启用，未发送请求')
    const version=options.brief.avgVisualPlanning?.version
    if (version && !(version===5?avgVisualPlanningExecutionReadyV5():avgVisualPlanningExecutionReadyV4())) throw new Error('[avg-visual-image] 当前版本图片消费尚未开放，未发送请求')
    if (options.brief.avgAssembly?.version === 3 && !avgVoiceProductionEnabledV3()) throw new Error('[avg-media] 联合图音生产尚未开放，未发送请求')
    const brief = options.brief
    const readExecutionSources=version===5?readAvgVisualPlanningExecutionSourcesV5:readAvgVisualPlanningExecutionSourcesV4
    const readCompiled=version===5?readAvgCompiledImageDefinitionV5:readAvgCompiledImageDefinitionV4
    const executionSource = brief.avgVisualPlanning ? await readExecutionSources(input, brief) : null
    const compiled = executionSource ? await readCompiled({ scope: input.scope, buildId: input.buildId,
      expectedBuildRevision: executionSource.build.stateRevision, controlEpoch: input.controlEpoch, expectedBrief: brief }) : null
    const legacy = compiled ? null : await assertAvgImageProductionDefinitionV3(brief)
    const assembly = compiled?.definition ?? legacy!.assembly, capability = compiled?.capability ?? legacy!.capability, batch = assembly.mediaBatch
    const r = batch.requirements.find(r => input.task.taskKey === `avg.media.generate.${r.requirementKey}`)
    if (!r || !input.taskRunId || !input.onMediaOutput || input.task.executionMode !== 'media-provider' || input.task.kind !== 'avg-media-image-generate'
      || input.task.skillId !== (compiled ? version===5?AVG_COMPILED_IMAGE_SKILL_V5:AVG_COMPILED_IMAGE_SKILL_V4 : brief.avgAssembly?.version === 3 ? 'avg.media-request.v1' : 'product-production.media-request.v1') || input.attempt !== 1 || input.task.maxAttempts !== 1
      || input.task.outputArtifactKeys.length !== 1 || input.task.outputArtifactKeys[0] !== avgRawMediaArtifactKeyV1(r.requirementKey)
      || input.task.budgetReservation.mediaCalls !== 1 || input.task.budgetReservation.modelCalls !== 0 || !input.contextText.trim()) {
      throw new Error('[avg-media] 图片任务不属于准确的冻结 Harness/Skill/单次调用域')
    }
    const source = compiled ? async () => {
      const current = await readExecutionSources(input, brief)
      const fresh = await readCompiled({ scope: input.scope, buildId: input.buildId,
        expectedBuildRevision: current.build.stateRevision, controlEpoch: input.controlEpoch, expectedBrief: brief })
      if (canonicalProductProductionJsonV2(fresh.definition.compilation) !== canonicalProductProductionJsonV2(compiled.definition.compilation)) throw new Error('[avg-visual-image] 当前编译需求已变化')
      return fresh.source
    } : () => readAvgImageTaskSourcesV2(input,brief)
    const accepted = await source()
    if (capability.capabilityHash !== await hashProductProductionValueV2(avgImageReferenceCapabilityV2(assembly.imageBinding.adapterId))) throw new Error('[avg-media] 图片能力快照已变化，请重新准备批次')
    const resolved = options.mediaCapabilities.get(AVG_IMAGE_CAPABILITY_REQUIREMENT_KEY_V1)
    const binding = input.capabilityBindings.find(b => b.requirementKey === capability.requirementKey)
    if (!resolved || !binding || input.capabilityBindings.length !== 1 || binding.adapterId !== assembly.imageBinding.adapterId
      || resolved.adapter.capability.adapterId !== binding.adapterId
      || resolved.binding.requirementKey !== binding.requirementKey || resolved.receipt.capabilityHash !== resolved.binding.bindingHash
      || resolved.receipt.requirementKey !== binding.requirementKey || resolved.transport.executionLocation !== 'browser-direct'
      || resolved.transport.rawResponseEvidence !== 'utf8-text-v1') {
      throw new Error('[avg-media] 图片执行能力与冻结绑定不一致')
    }
    if (!options.imageEndpointRouteHash || options.imageEndpointRouteHash !== assembly.imageBinding.endpointRouteHash
      || binding.bindingHash !== assembly.imageBinding.bindingHash || binding.bindingHash !== await avgImageRouteBindingHashV2({
        requirementKey: binding.requirementKey, adapterId: binding.adapterId, baseCapabilityHash: resolved.binding.bindingHash, endpointRouteHash: options.imageEndpointRouteHash })) {
      throw new Error('[avg-media] 图片配置路由已变化，请重新准备并确认制作方案')
    }
    const fields={capability,qualityProfile:brief.qualityProfile,requirementKey:r.requirementKey,idempotencyKey:input.idempotencyKey}
    const frozen = compiled ? compiled.definition.version===5
      ?await prepareAvgRawImageRequestFromBatchV2({...fields,batch:compiled.definition.mediaBatch,adapterId:compiled.definition.imageBinding.adapterId})
      :await prepareAvgRawImageRequestFromBatchV1({...fields,batch:compiled.definition.mediaBatch,adapterId:compiled.definition.imageBinding.adapterId})
      : await prepareAvgRawImageRequestV1({ brief, requirementKey: r.requirementKey, idempotencyKey: input.idempotencyKey })
    const request = { ...frozen.request, inputHash: frozen.inputHash }
    const inspectReference=async (reference:{assetKey:string;contentHash:string;mimeType:string}, bytes:ArrayBuffer) => {
      await inspectAvgImageBytesV1({ data: bytes, assetKey: reference.assetKey, contentHash: reference.contentHash, mimeType: reference.mimeType })
    }
    const adapter=frozen.version===2?await createAvgDraftReferenceAdapterV2({scope:input.scope,frozen,inspectReference})
      :await createAvgDraftReferenceAdapterV1({scope:input.scope,frozen,inspectReference})
    const estimate = await adapter.estimate(request)
    if (capability.maximumRequestCost !== null && (estimate.estimatedCostUsd === null || estimate.estimatedCostUsd > capability.maximumRequestCost)
      || brief.productionBudget.maximumCostUsd !== null && estimate.estimatedCostUsd === null) throw new Error('[avg-media] 无法核实当前账号费用，不能执行现金硬上限请求')
    const available = await navigator.storage?.estimate?.()
    if (available?.quota !== undefined && available.usage !== undefined && available.quota - available.usage < input.task.budgetReservation.storageBytes) {
      throw new Error('[avg-media] 浏览器剩余存储不足以保存本次原图和回执，请释放空间后再开始')
    }
    let dispatches = 0, responseRecorded = false, responseEvidenceHash = ''
    const transport: MediaProviderTransportV1 = { executionLocation: resolved.transport.executionLocation,
      request: async (value, signal) => {
        if (dispatches++ > 0) throw new Error('[avg-media] 单图任务不允许第二次发送')
        const received = await resolved.transport.request(value, signal, async raw => {
          const evidence = await avgImageResponseEvidenceV1({ status: raw.status, contentType: raw.contentType, providerRequestId: raw.providerRequestId,
            usage: null, costUsd: null, body: null, json: null }, raw.text)
          evidenceBytes += new TextEncoder().encode(evidence).byteLength
          if (await input.onMediaOutput!(evidence) === 'discarded-stale') throw new ProductProductionResultUnknownErrorV1()
          responseEvidenceHash = await sha256MediaData(new TextEncoder().encode(evidence).buffer)
          responseRecorded = true
        })
        response = received
        if (!responseRecorded) throw new Error('[avg-media] 图片传输缺少解析前原始回执')
        return received
      },
      ...(resolved.transport.fetchExternalAsset ? { fetchExternalAsset: resolved.transport.fetchExternalAsset.bind(resolved.transport) } : {}),
    }
    const candidates = await adapter.generate(request, transport, input.signal)
    if (candidates.length !== 1) throw new Error('[avg-media] 单图任务收到非单一候选')
    const candidate = await adapter.parseAndVerify(candidates[0])
    if (candidate.byteSize > 32 * 1024 * 1024) throw new Error('[avg-media] 原图超过当前单图字节上限')
    const dimensions = detectProductImageDimensionsV1(candidate.data)
    if (!dimensions) throw new Error('[avg-media] 原图尺寸头无效；原始回执已保留')
    if (input.signal.aborted) throw new ProductProductionResultUnknownErrorV1()
    await source()
    if(frozen.version===1)await validateAvgGeneratedReferencesV1(input.scope, frozen.references, r.family)
    const blob = await putMediaBlobObject({ scope: input.scope, data: candidate.data, mimeType: candidate.mimeType, expectedContentHash: candidate.contentHash })
    const asset: FrozenRuntimeMediaAssetV2 = { assetKey: r.assetKey, version: 1, kind: r.mediaKind, name: r.name, altText: r.altText,
      mimeType: blob.mimeType, byteSize: blob.byteSize, contentHash: blob.contentHash, blobContentHash: blob.contentHash,
      width: dimensions.width, height: dimensions.height, durationMs: null, source: candidate.adapterId,
      license: `rights-policy:${capability.rightsPolicyVersion}`, characterTag: r.mediaKind.startsWith('character-') ? r.family.subjectKey : '', sceneTag: r.consumer.sceneKey ?? '' }
    const rawBody={schema:'storyforge.avg.raw-image' as const,batchKey:batch.batchKey,batchRevision:batch.revision,sourceInputHash:batch.sourceInputHash,
      provider:candidate.providerReceipt,rights:candidate.rights,capabilityBindingHash:binding.bindingHash}
    let payload:AvgRawImagePayloadV1|AvgRawImagePayloadV2
    if(frozen.version===2&&compiled?.definition.version===5){
      const requirement=compiled.definition.mediaBatch.requirements.find(v=>v.requirementKey===r.requirementKey)!
      payload={...rawBody,version:2,requirement,request:frozen}
    }else if(frozen.version===1)payload={...rawBody,version:1,requirement:parseAvgVisualProductionRequirementV1(r),request:frozen}
    else throw new Error('[avg-media] 真实编译需求与原图版本不一致')
    const artifact = { artifactKey: avgRawMediaArtifactKeyV1(r.requirementKey), requirementKey: capability.requirementKey, kind: 'image' as const, mediaKind: r.mediaKind,
      payload, metadata: asset, rights: candidate.rights, contentHash: blob.contentHash, blobObjectId: blob.id!, mimeType: blob.mimeType, byteSize: blob.byteSize,
      quality: { received: true, rawResponseRecorded: responseRecorded, responseEvidenceHash, headerVerified: true, contentHashVerified: true, decoderVerified: false,
        referenceTransmission: candidate.metadata.avgReferenceTransmission, sourceRule: accepted.artifact, sourceScripts: accepted.scripts.map(s => s.artifact),
        ...(compiled ? { sourceCompilation: compiled.definition.compilation } : {}),
        sourceContextHash: await hashProductProductionValueV2(input.contextText) } }
    return { artifacts: [artifact], passedGateIds: [...input.task.acceptanceGateIds],
      usage: usage(1, evidenceBytes + blob.byteSize + new TextEncoder().encode(canonicalProductProductionJsonV2(payload)).byteLength) }
  } catch (error) {
    if (error instanceof ProductProductionResultUnknownErrorV1) throw error
    const observed = response as MediaTransportResponseV1 | null
    const detail = observed ? `[avg-media] 图片响应已保存但未通过原图校验（HTTP ${observed.status}）；请检查原始回执或修订需求`
      : error instanceof Error ? error.message : '[avg-media] 图片调用前校验失败'
    throw new ProductProductionDraftRejectedErrorV1(detail, usage(observed ? 1 : 0))
  }
}
