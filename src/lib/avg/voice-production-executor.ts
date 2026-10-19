import type { FrozenRuntimeMediaAssetV2 } from '../types'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { putMediaBlobObject, sha256MediaData } from '../product-production/media-blob-store'
import { ProductProductionDraftRejectedErrorV1, ProductProductionResultUnknownErrorV1,
  type ProductProductionTaskExecutionInputV1, type ProductProductionTaskExecutionResultV1,
  type ProductProductionTaskUsageV1 } from '../product-production/scheduler'
import { avgMediaProductionEnabledV2, avgVoiceProductionEnabledV3 } from './assembly-contract'
import { avgRawVoiceArtifactKeyV1, AVG_VOICE_CAPABILITY_REQUIREMENT_KEY_V1 } from './voice-assembly-contract'
import { readAvgVoiceTaskSourcesV3 } from './voice-task-source'
import type { AvgVoiceProductionBriefV3 } from './voice-production-policy'
import { AvgVoiceTransportErrorV1, type AvgVoiceHttpResponseV1, type createConfiguredAvgVoiceTransportV1 } from './voice-transport'
import { inspectAvgVoiceBytesV1 } from './voice-decoder'
import { assertAvgRawVoiceArtifactV1, avgVoiceRightsReceiptV1, encodeAvgRawVoicePayloadV1, type AvgRawVoicePayloadV1 } from './voice-raw-contract'
import { AVG_VOICE_TASK_TIMEOUT_MS_V1 } from './voice-request-contract'
import { assertAvgNoUnresolvedVoiceRequestsV1 } from './voice-request-safety'

/** Private executor, still unreachable from shared V1/V2 admission. It joins
 * the registered media Skill only with the complete V3 source/Plan/adoption
 * slice. No public transport shortcut, author pass, slot binding or retry.
 */
export async function executeAvgVoiceTaskV3(input: ProductProductionTaskExecutionInputV1, options: {
  brief: AvgVoiceProductionBriefV3
  transport: Awaited<ReturnType<typeof createConfiguredAvgVoiceTransportV1>>
}): Promise<ProductProductionTaskExecutionResultV1> {
  const brief = structuredClone(options.brief)
  const started = Date.now()
  let response: AvgVoiceHttpResponseV1 | null = null, attemptedRequest = false, evidenceBytes = 0
  let responseEvidenceHash = '', storedBlobBytes = 0
  const usage = (mediaCalls: number, additionalBytes = 0): ProductProductionTaskUsageV1 => ({
    modelCalls: 0, inputTokens: 0, outputTokens: 0, mediaCalls,
    costUsd: mediaCalls ? response?.costUsd ?? null : 0,
    durationMs: Date.now() - started, storageBytes: evidenceBytes + storedBlobBytes + additionalBytes,
  })
  try {
    if (!avgMediaProductionEnabledV2() || !avgVoiceProductionEnabledV3()) throw new Error('[avg-voice] 实验性配音生产未启用，未发送请求')
    const source = () => readAvgVoiceTaskSourcesV3(input, brief)
    const frozen = await source(), assembly = frozen.assembly
    const r = assembly.voice.batch.requirements.find(r => input.task.taskKey === `avg.voice.generate.${r.requirementKey}`)
    if (!r || !input.taskRunId || !input.onMediaOutput || input.signal.aborted || !input.contextText.trim()
      || input.task.kind !== 'avg-media-voice-generate' || input.task.executionMode !== 'media-provider'
      || input.task.skillId !== 'avg.media-request.v1' || input.attempt !== 1 || input.task.maxAttempts !== 1
      || input.task.outputArtifactKeys.length !== 1 || input.task.outputArtifactKeys[0] !== avgRawVoiceArtifactKeyV1(r.requirementKey)
      || input.task.capabilityRequirementKeys.length !== 1 || input.task.capabilityRequirementKeys[0] !== AVG_VOICE_CAPABILITY_REQUIREMENT_KEY_V1
      || input.task.budgetReservation.modelCalls !== 0 || input.task.budgetReservation.mediaCalls !== 1
      || input.task.budgetReservation.outputTokens !== 0 || input.task.budgetReservation.storageBytes !== 96 * 1024 * 1024
      || input.task.timeoutMs !== AVG_VOICE_TASK_TIMEOUT_MS_V1 || input.task.budgetReservation.durationMs !== AVG_VOICE_TASK_TIMEOUT_MS_V1) {
      throw new Error('[avg-voice] 任务不属于准确冻结的 Harness/Skill/单句单次调用域')
    }
    const capability = brief.capabilityRequirements.find(c => c.requirementKey === AVG_VOICE_CAPABILITY_REQUIREMENT_KEY_V1)!
    const bindings = input.capabilityBindings.filter(b => b.requirementKey === capability.requirementKey)
    const transport = options.transport, expectedBinding = assembly.voice.binding
    if (bindings.length !== 1 || bindings[0].bindingHash !== expectedBinding.bindingHash || bindings[0].adapterId !== expectedBinding.adapterId
      || transport.endpointRouteHash !== expectedBinding.endpointRouteHash || transport.binding.requirementKey !== expectedBinding.requirementKey
      || transport.binding.bindingHash !== expectedBinding.bindingHash || transport.binding.adapterId !== expectedBinding.adapterId
      || transport.binding.provider !== assembly.voice.protocol.provider || transport.binding.model !== assembly.voice.protocol.model) {
      throw new Error('[avg-voice] 执行能力与冻结模型、音色协议或服务路由不一致')
    }
    if (brief.productionBudget.maximumCostUsd !== null) throw new Error('[avg-voice] 尚无可核实配音报价，不能执行现金硬上限请求')
    const available = await navigator.storage?.estimate?.()
    if (available?.quota !== undefined && available.usage !== undefined && available.quota - available.usage < input.task.budgetReservation.storageBytes) {
      throw new Error('[avg-voice] 浏览器剩余存储不足以保留音频和原始回执，请释放空间后再开始')
    }
    const request = frozen.requests.find(request => request.requirementKey === r.requirementKey)!
    await assertAvgNoUnresolvedVoiceRequestsV1({ scope: input.scope, requests: [request], ownClaim: {
      buildId: input.buildId, controlEpoch: input.controlEpoch, taskKey: input.task.taskKey,
      runId: input.taskRunId!, attempt: input.attempt, idempotencyKey: input.idempotencyKey,
    } })
    // A stop or source revision can arrive during the asynchronous history
    // scan. Keep the actual authority check immediately before dispatch.
    await source()
    attemptedRequest = true
    response = await transport.request({ requirementKey: r.requirementKey, requestIdentityHash: request.identityHash,
      idempotencyKey: input.idempotencyKey, signal: input.signal, onResponse: async evidence => {
        const size = new TextEncoder().encode(evidence).byteLength
        if (size > 48 * 1024 * 1024) throw new Error('[avg-voice] 有界原始响应超过当前回执上限')
        evidenceBytes += size
        if (await input.onMediaOutput!(evidence) === 'discarded-stale') return 'discarded-stale'
        responseEvidenceHash = await sha256Text(evidence)
      } })
    if (!responseEvidenceHash || response.evidenceHash !== responseEvidenceHash || input.signal.aborted) throw new ProductProductionResultUnknownErrorV1()
    const contentHash = await sha256MediaData(response.body)
    const inspected = await inspectAvgVoiceBytesV1({ data: response.body, contentHash, assetKey: r.assetKey,
      maximumDurationMs: r.maximumDurationMs, signal: input.signal })
    await source()
    if (input.signal.aborted) throw new ProductProductionResultUnknownErrorV1()
    const preset = assembly.voice.batch.presets.find(p => p.presetKey === r.presetKey)!
    const payload: AvgRawVoicePayloadV1 = { schema: 'storyforge.avg.raw-voice', version: 1,
      sourceInputHash: assembly.voice.batch.sourceInputHash, requirement: r, preset, request, measurement: inspected.measurement,
      capabilityBindingHash: expectedBinding.bindingHash,
      provider: { providerRequestId: response.providerRequestId, executionLocation: 'browser-direct', costUsd: response.costUsd, usage: response.usage },
      rights: { origin: 'generated', basis: 'provider-preset', presetKey: preset.presetKey, presetRevision: preset.revision,
        declaration: preset.rights.declaration, reference: preset.rights.reference, rightsPolicyVersion: capability.rightsPolicyVersion,
        requiresProviderTermsReview: true, commercialUse: null } }
    const stored = await encodeAvgRawVoicePayloadV1(payload), rights = await avgVoiceRightsReceiptV1(payload.rights)
    const measurement = inspected.measurement
    const asset: FrozenRuntimeMediaAssetV2 = { assetKey: r.assetKey, version: 1, kind: 'voice', name: `配音 · ${r.lineKey}`, altText: `配音 · ${r.lineKey}`,
      mimeType: 'audio/wav', byteSize: measurement.byteSize, contentHash, blobContentHash: contentHash, width: null, height: null,
      durationMs: measurement.durationMs, source: request.provider + ':' + assembly.voice.protocol.adapterId,
      license: `rights-policy:${capability.rightsPolicyVersion}`, characterTag: r.speakerKey ?? '', sceneTag: r.sceneKey }
    const artifactKey = avgRawVoiceArtifactKeyV1(r.requirementKey)
    await assertAvgRawVoiceArtifactV1({ assembly, capability, row: { artifactKey, kind: 'audio', mediaKind: 'voice', mimeType: 'audio/wav',
      byteSize: asset.byteSize, contentHash, payloadJson: canonicalProductProductionJsonV2(stored), metadataJson: canonicalProductProductionJsonV2(asset), rightsJson: canonicalProductProductionJsonV2(rights) } })
    const blob = await putMediaBlobObject({ scope: input.scope, data: inspected.data, mimeType: 'audio/wav', expectedContentHash: contentHash })
    storedBlobBytes = blob.byteSize
    await source()
    if (input.signal.aborted) throw new ProductProductionResultUnknownErrorV1()
    return { artifacts: [{ artifactKey, requirementKey: capability.requirementKey, kind: 'audio', mediaKind: 'voice',
      payload: stored, metadata: asset, rights, contentHash, blobObjectId: blob.id!, mimeType: blob.mimeType, byteSize: blob.byteSize,
      quality: { received: true, rawResponseRecorded: true, responseEvidenceHash, contentHashVerified: true, decoderVerified: true,
        sourceRule: frozen.accepted.artifact, sourceScripts: frozen.accepted.scripts.map(s => s.artifact),
        sourceContextHash: await sha256Text(input.contextText) } }], passedGateIds: [...input.task.acceptanceGateIds],
      usage: usage(1, new TextEncoder().encode(canonicalProductProductionJsonV2(stored)).byteLength) }
  } catch (error) {
    if (error instanceof ProductProductionResultUnknownErrorV1) throw error
    if (error instanceof AvgVoiceTransportErrorV1) {
      if (error.disposition === 'result-unknown') throw new ProductProductionResultUnknownErrorV1()
      if (error.disposition === 'not-dispatched') throw new ProductProductionDraftRejectedErrorV1(error.message, usage(0))
      if (!error.response) throw new ProductProductionResultUnknownErrorV1()
      response = error.response
    } else if (attemptedRequest && !response) throw new ProductProductionResultUnknownErrorV1()
    const observed = response as AvgVoiceHttpResponseV1 | null
    throw new ProductProductionDraftRejectedErrorV1(observed
      ? `[avg-voice] 配音响应已保存，但未通过当前来源、音频或存储校验（HTTP ${observed.status}），请检查回执并明确修订`
      : error instanceof Error ? error.message : '[avg-voice] 调用前校验失败', usage(observed ? 1 : 0))
  }
}
