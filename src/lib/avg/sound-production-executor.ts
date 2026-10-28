import type { ProductProductionBriefV3 } from '../types'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { putMediaBlobObject } from '../product-production/media-blob-store'
import { ProductProductionDraftRejectedErrorV1, ProductProductionResultUnknownErrorV1,
  type ProductProductionTaskExecutionInputV1, type ProductProductionTaskExecutionResultV1, type ProductProductionTaskUsageV1 } from '../product-production/scheduler'
import { readAgentRunV1 } from '../agent/run/event-store'
import { recordAgentRunArtifactV1 } from '../memory/artifact-store'
import { readAvgSoundPlanningExecutionSourcesV1 } from './sound-planning-task-source'
import { AVG_SOUND_COMPILED_KEY_V1, AVG_SOUND_PLAN_KEY_V1 } from './sound-production-plan'
import { compileAvgSoundRequirementsV1 } from './sound-requirements'
import { createConfiguredAvgSoundTransportV1, AvgSoundTransportErrorV1 } from './sound-transport'
import { hashAvgSoundExactTextV1 } from './sound-planning-evidence'
import { inspectAvgSoundBytesV1 } from './sound-decoder'
import { buildAvgRawSoundArtifactV1 } from './sound-raw-contract'
import { hashAvgSoundBytesV1 } from './sound-provider-contract'
import { avgSoundProductionExecutionReadyV1 } from './sound-production-brief'

/** Actual durable raw-audio producer. Still behind the complete public sound
 * feature fence; it cannot approve sound, alter the draft or adopt a Stage. */
export async function executeAvgSoundProductionTaskV1(input: ProductProductionTaskExecutionInputV1, brief: ProductProductionBriefV3): Promise<ProductProductionTaskExecutionResultV1> {
  const started = Date.now(); let dispatched = false, knownResponse = false, evidenceBytes = 0, blobBytes = 0
  const generated = input.task.kind === 'avg-sound-music-generate'
  const usage = (mediaCalls: number): ProductProductionTaskUsageV1 => ({ modelCalls: 0, mediaCalls, inputTokens: 0, outputTokens: 0,
    costUsd: 0, durationMs: Date.now() - started, storageBytes: evidenceBytes + blobBytes })
  try {
    if (!avgSoundProductionExecutionReadyV1()) throw new Error('[avg-sound] 声音生产入口尚未开放')
    const source = () => readAvgSoundPlanningExecutionSourcesV1(input, brief), frozen = await source(), task = input.task
    if (frozen.planning.version !== 1) throw new Error('[avg-sound] 返修不能进入原声音请求执行器')
    const compiled = await compileAvgSoundRequirementsV1(frozen.planning.scope, JSON.parse(input.inputArtifacts.find(r => r.artifactKey === AVG_SOUND_PLAN_KEY_V1)!.payloadJson))
    const req = compiled.requirements.find(r => task.taskKey === `avg.sound.generate.${r.template.requirementKey}`)
    if (!req || !input.taskRunId || input.attempt !== 1 || task.maxAttempts !== 1 || input.authorDraftJson || input.signal.aborted
      || task.outputArtifactKeys.length !== 1 || task.outputArtifactKeys[0] !== `avg.sound.raw.${req.template.requirementKey}`
      || task.budgetReservation.modelCalls !== 0 || task.budgetReservation.mediaCalls !== (generated ? 1 : 0)
      || task.executionMode !== (generated ? 'media-provider' : 'deterministic') || task.skillId !== (generated ? 'avg.sound-request.v1' : null)
      || task.kind !== (generated ? 'avg-sound-music-generate' : 'avg-sound-library-import')
      || JSON.parse(input.inputArtifacts.find(r => r.artifactKey === AVG_SOUND_COMPILED_KEY_V1)!.payloadJson).planHash !== compiled.planHash
      || (req.dispatch.operation === 'generate-music') !== generated) throw new Error('[avg-sound] 实际任务不是准确编译项的单次声音producer')
    const transport = createConfiguredAvgSoundTransportV1({ declaration: frozen.planning }), bindings = generated && transport.binding ? [transport.binding] : []
    if (canonicalProductProductionJsonV2(bindings) !== canonicalProductProductionJsonV2(input.capabilityBindings)
      || task.budgetReservation.maximumCostUsd !== 0 || !input.onModelOutput || generated && !input.onMediaOutput) throw new Error('[avg-sound] 冻结音乐路由/原响应通道/零供应商费预算不一致')
    const available = await navigator.storage?.estimate?.()
    if (available?.quota !== undefined && available.usage !== undefined && available.quota - available.usage < task.budgetReservation.storageBytes) throw new Error('[avg-sound] 浏览器存储不足以保留原音频和回执')
    const snapshotBody = { schema: 'storyforge.avg.sound-media-input', version: 2,
      taskKey: task.taskKey, idempotencyKey: input.idempotencyKey, requirement: req, sourceInputHash: frozen.planning.scope.sourceInputHash,
      scopeHash: compiled.scopeHash, planHash: compiled.planHash, contextText: input.contextText, inputs: frozen.refs,
      musicBinding: generated ? frozen.planning.musicBinding : null, capabilityBindings: bindings }
    await source()
    let responseHash = '', snapshotHash = ''
    dispatched = true
    const response = await transport.request({ requirement: req, idempotencyKey: input.idempotencyKey, signal: input.signal,
      beforeDispatch: async capability => {
        // Persist the actual journal identity even if the subsequent POST
        // loses its response. New snapshots do not rewrite original V1 runs.
        await source()
        const snapshot = canonicalProductProductionJsonV2({ ...snapshotBody, capability })
        const run = await readAgentRunV1(input.scope, input.taskRunId!)
        await recordAgentRunArtifactV1({ scope: input.scope, runId: input.taskRunId!, stepId: task.taskKey, attempt: 1,
          artifactKind: 'source-snapshot', content: snapshot, expectedLastSequence: run.projection.lastSequence })
        evidenceBytes += new TextEncoder().encode(snapshot).byteLength
        snapshotHash = await hashAvgSoundExactTextV1(snapshot)
        await source()
      },
      onResponse: async evidence => {
        evidenceBytes += new TextEncoder().encode(evidence).byteLength
        // The scheduler supplies the same durable raw-response recorder to
        // deterministic tasks as onModelOutput. This records zero model calls.
        const record = generated ? input.onMediaOutput! : input.onModelOutput!
        if (await record(evidence) === 'discarded-stale') return 'discarded-stale'
        responseHash = await hashAvgSoundExactTextV1(evidence)
      } })
    knownResponse = true
    if (!snapshotHash || !responseHash || response.evidenceHash !== responseHash || input.signal.aborted) throw new ProductProductionResultUnknownErrorV1()
    const inspected = await inspectAvgSoundBytesV1({ data: response.body, contentHash: await hashAvgSoundBytesV1(response.body),
      assetKey: req.template.assetKey, mimeType: response.contentType, signal: input.signal })
    await source()
    const artifact = buildAvgRawSoundArtifactV1({ planning: frozen.planning, requirement: req, scopeHash: compiled.scopeHash,
      planHash: compiled.planHash, measurement: inspected.measurement, providerResult: response.result,
      requestSnapshotHash: snapshotHash, responseEvidenceHash: responseHash, contextHash: await hashAvgSoundExactTextV1(input.contextText), inputs: frozen.refs as Array<{ artifactKey: string; version: number; contentHash: string }> })
    const blob = await putMediaBlobObject({ scope: input.scope, data: inspected.data, mimeType: response.contentType,
      expectedContentHash: inspected.measurement.contentHash })
    blobBytes = blob.byteSize; evidenceBytes += new TextEncoder().encode(canonicalProductProductionJsonV2(artifact)).byteLength
    await source()
    if (input.signal.aborted) throw new ProductProductionResultUnknownErrorV1()
    return { artifacts: [{ ...artifact, blobObjectId: blob.id! }], passedGateIds: [...task.acceptanceGateIds], usage: usage(generated ? 1 : 0) }
  } catch (error) {
    if (error instanceof ProductProductionResultUnknownErrorV1) throw error
    if (error instanceof AvgSoundTransportErrorV1) {
      if (error.disposition === 'result-unknown') throw new ProductProductionResultUnknownErrorV1()
      if (error.disposition === 'not-dispatched') throw new ProductProductionDraftRejectedErrorV1(error.message, usage(0))
      knownResponse = true
    }
    if (dispatched && !knownResponse) throw new ProductProductionResultUnknownErrorV1()
    throw new ProductProductionDraftRejectedErrorV1(error instanceof Error ? error.message : '[avg-sound] 原音频生产未通过', usage(generated && knownResponse ? 1 : 0))
  }
}
