import type { ProductProductionBriefV3 } from '../types'
import type { ProductionTextRunnerV1 } from '../product-production/production-executor'
import { ProductProductionDraftRejectedErrorV1, type ProductProductionTaskExecutorV1, type ProductProductionTaskUsageV1 } from '../product-production/scheduler'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { getAgentSkillV1 } from '../agent/skill-registry'
import { readAgentRunV1 } from '../agent/run/event-store'
import { recordAgentRunArtifactV1 } from '../memory/artifact-store'
import { estimateTokens } from '../ai/context-budget'
import { readAvgSoundPlanningExecutionSourcesV1 } from './sound-planning-task-source'
import { avgSoundProductionExecutionReadyV1, AVG_SOUND_TEXT_CAPABILITY_V1 } from './sound-production-brief'
import { avgSoundPlanningMethodV1 } from './sound-planning-role'
import { prepareAvgSoundRoleProposalV1 } from './sound-role-proposal'
import { hashAvgSoundExactTextV1 } from './sound-planning-evidence'
import { AVG_SOUND_COMPILED_KEY_V1, AVG_SOUND_PLAN_KEY_V1 } from './sound-production-plan'
import { compileAvgSoundRequirementsV1 } from './sound-requirements'
import { executeAvgSoundProductionTaskV1 } from './sound-production-executor'
import { avgAudioProcessingExecutionReadyV1 } from './audio-production-brief'

/** Same durable scheduler, model runner and original-response recorder. Raw
 * audio is private until observation, author choice and Stage join are ready. */
export function createAvgSoundPlanningExecutorV1(options: { brief: ProductProductionBriefV3; runText: ProductionTextRunnerV1 }): ProductProductionTaskExecutorV1 {
  const brief = structuredClone(options.brief)
  if (brief.avgAudioProcessing && !avgAudioProcessingExecutionReadyV1()) throw new Error('[avg-audio-process] 正式音频加工尚未就绪，不能借用原声音执行器')
  if (!brief.avgSoundPlanning) throw new Error('[avg-sound-plan] 缺少准确声音Brief')
  return async input => {
    if (input.task.kind === 'avg-audio-process') return (await import('./audio-processing-executor')).executeAvgAudioProcessingTaskV1(input, brief)
    if (['avg-sound-music-generate', 'avg-sound-library-import'].includes(input.task.kind)) return executeAvgSoundProductionTaskV1(input, brief)
    const started = Date.now(), zero = (): ProductProductionTaskUsageV1 => ({ modelCalls: 0, mediaCalls: 0, inputTokens: 0,
      outputTokens: 0, costUsd: 0, durationMs: Date.now() - started, storageBytes: 0 })
    let source: Awaited<ReturnType<typeof readAvgSoundPlanningExecutionSourcesV1>>
    try {
      if (!avgSoundProductionExecutionReadyV1()) throw new Error('[avg-sound-plan] 正式声音闭环尚未开放')
      if (input.signal.aborted) throw new DOMException('Aborted', 'AbortError')
      if (['avg-assembly-integrate', 'avg-assembly-verify'].includes(input.task.kind)) {
        const { db } = await import('../db/schema'), { createAvgAssemblyExecutorV1 } = await import('./assembly-executor')
        const build = await db.productBuilds.get(input.buildId), production = build ? await db.productProductions.get(build.productionId) : null
        if (!production || build!.productionId !== input.productionId) throw new Error('[avg-sound] 组装缺少准确Production')
        return createAvgAssemblyExecutorV1({ brief, production })(input)
      }
      if (!['avg-sound-plan-propose', 'avg-sound-requirements-compile'].includes(input.task.kind)) throw new Error('[avg-sound-plan] 演出执行尚未接通；未调用或回退其他生产器')
      source = await readAvgSoundPlanningExecutionSourcesV1(input, brief)
    } catch (error) { throw new ProductProductionDraftRejectedErrorV1(error instanceof Error ? error.message : '声音来源无效', zero()) }
    if (input.task.kind === 'avg-sound-requirements-compile') {
      if (input.capabilityBindings.length || input.attempt !== 1 || input.authorDraftJson) throw new ProductProductionDraftRejectedErrorV1('[avg-sound-plan] 编译不能借用模型/人工上下文', zero())
      const plan = input.inputArtifacts.find(r => r.artifactKey === AVG_SOUND_PLAN_KEY_V1)
      const payload = await compileAvgSoundRequirementsV1(source.planning.scope, plan && JSON.parse(plan.payloadJson))
      const artifact = { artifactKey: AVG_SOUND_COMPILED_KEY_V1, kind: 'asset-manifest' as const, payload, metadata: {},
        quality: { schema: 'storyforge.avg.sound-compilation-evidence', version: 1,
          scopeHash: await hashProductProductionValueV2(source.planning.scope), inputs: source.refs }, rights: { origin: 'deterministic-sound-compilation' } }
      return { artifacts: [artifact], passedGateIds: [...input.task.acceptanceGateIds], usage: { ...zero(),
        storageBytes: new TextEncoder().encode(canonicalProductProductionJsonV2(artifact)).byteLength } }
    }
    const binding = input.capabilityBindings[0], system = avgSoundPlanningMethodV1(), skill = getAgentSkillV1('avg.sound-plan.v1')
    const inputTokens = estimateTokens(system + input.contextText)
    let inputBytes = 0
    try {
      if (!binding || !binding.provider || !binding.model || input.capabilityBindings.length !== 1 || binding.requirementKey !== AVG_SOUND_TEXT_CAPABILITY_V1
        || input.task.capabilityRequirementKeys.length !== 1 || input.task.capabilityRequirementKeys[0] !== binding.requirementKey
        || input.task.budgetReservation.modelCalls !== 1 || input.task.budgetReservation.mediaCalls !== 0 || input.attempt !== 1 || input.task.maxAttempts !== 1
        || input.authorDraftJson || !input.onModelOutput || inputTokens > input.task.budgetReservation.inputTokens
        || input.task.budgetReservation.maximumCostUsd !== null) throw new Error('[avg-sound-plan] 缺少准确单次路由/原始响应回执/预算；未知费用不能使用现金硬上限')
      const current = await readAgentRunV1(input.scope, input.taskRunId!)
      const snapshot = canonicalProductProductionJsonV2({ schema: 'storyforge.avg.sound-model-input', version: 1,
        taskKey: input.task.taskKey, targetArtifactKey: AVG_SOUND_PLAN_KEY_V1, scopeHash: await hashProductProductionValueV2(source.planning.scope),
        sourceInputHash: source.planning.scope.sourceInputHash, systemPrompt: system, contextText: input.contextText,
        category: 'product-production', maximumOutputTokens: input.task.budgetReservation.outputTokens, binding, promptVersion: skill.promptVersion })
      inputBytes = new TextEncoder().encode(snapshot).byteLength
      await recordAgentRunArtifactV1({ scope: input.scope, runId: input.taskRunId!, stepId: input.task.taskKey, attempt: 1,
        artifactKind: 'source-snapshot', content: snapshot, expectedLastSequence: current.projection.lastSequence })
      await readAvgSoundPlanningExecutionSourcesV1(input, brief)
    } catch (error) { throw new ProductProductionDraftRejectedErrorV1(error instanceof Error ? error.message : '声音输入无效', zero()) }
    const response = await options.runText({ projectId: input.scope.projectId, requirementKey: binding.requirementKey, category: 'product-production',
      expectedCapabilityHash: binding.bindingHash, system, contextText: input.contextText, maximumOutputTokens: input.task.budgetReservation.outputTokens, signal: input.signal })
    const usage: ProductProductionTaskUsageV1 = { modelCalls: 1, mediaCalls: 0, inputTokens: response.usage?.inputTokens ?? inputTokens,
      outputTokens: response.usage?.outputTokens ?? estimateTokens(response.output), costUsd: null, durationMs: Date.now() - started,
      storageBytes: inputBytes + new TextEncoder().encode(response.output).byteLength }
    try {
      if (await input.onModelOutput!(response.output) === 'discarded-stale') throw new Error('[avg-sound-plan] 已收到方案已过期，保留原响应，不会重发')
      if (response.bindingReceipt.capabilityHash !== binding.bindingHash) throw new Error('[avg-sound-plan] 实际文本路由与冻结绑定不一致')
      // Record received bytes first, then fail with their actual usage if an
      // adopted source changed during HTTP. Never checkpoint an invalid
      // candidate for the generic recovery loop to repeatedly try admitting.
      await readAvgSoundPlanningExecutionSourcesV1(input, brief)
      const proposal = await prepareAvgSoundRoleProposalV1(response.output, input.task, source.planning.scope)
      const run = await readAgentRunV1(input.scope, input.taskRunId!)
      const events = run.events.filter(e => e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'source-snapshot'
        && e.payload.stepId === input.task.taskKey && e.payload.attempt === 1)
      if (events.length !== 1 || events[0].type !== 'evidence.artifact.recorded') throw new Error('[avg-sound-plan] 准确输入快照不唯一')
      const artifact = { artifactKey: input.task.outputArtifactKeys[0], kind: 'narrative' as const, payload: proposal, metadata: {},
        quality: { schema: 'storyforge.avg.sound-proposal-evidence', version: 1, requestSnapshotHash: events[0].payload.contentHash,
          rawResponseHash: await hashAvgSoundExactTextV1(response.output), scopeHash: proposal.scopeHash, capabilityBindingHash: binding.bindingHash },
        rights: { origin: 'model-proposal', commercialUse: null } }
      usage.storageBytes += new TextEncoder().encode(canonicalProductProductionJsonV2(artifact)).byteLength
      usage.durationMs = Date.now() - started
      return { artifacts: [artifact], passedGateIds: [...input.task.acceptanceGateIds], usage }
    } catch (error) { throw new ProductProductionDraftRejectedErrorV1(error instanceof Error ? error.message : '声音模型方案无效', usage) }
  }
}
