import { db } from '../db/schema'
import type { WorkspaceScope } from '../types'
import { resolveScope } from '../workspace/scope'
import { readProductProductionDetailsV1 } from '../product-production/service'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { resolveConfiguredTextCapabilityV1 } from '../product-production/capabilities'
import { createConfiguredProductProductionExecutorV1 } from '../product-production/production-executor'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { projectProductProductionSchedulerV1, runProductProductionSchedulerCycleV1, runProductProductionUntilBlockedV1,
  type ProductProductionCapabilityBindingV1, type ProductProductionSchedulerProjectionV1 } from '../product-production/scheduler'
import { avgSoundProductionExecutionReadyV1, AVG_SOUND_TEXT_CAPABILITY_V1 } from './sound-production-brief'
import { createConfiguredAvgSoundTransportV1 } from './sound-transport'

/** Existing formal Run only. A ready new proposal needs its frozen text route;
 * author waits, checkpoint recovery and deterministic audio/assembly do not.
 * Music's non-secret frozen descriptor performs no HTTP until its real task.
 * No credentials are copied into the Work, Brief, Run or returned projection. */
export async function runAvgSoundProductionV1(input: {
  scope: WorkspaceScope; productionId: number; expectedBuildId?: number; signal?: AbortSignal
  onProgress?: (projection: ProductProductionSchedulerProjectionV1) => void | Promise<void>
}) {
  const scope = await resolveScope({ scope: input.scope })
  const details = await readProductProductionDetailsV1(scope, input.productionId, ['avg'])
  const build = details.build, brief = details.executionBrief
  if (!build?.id || !brief?.avgSoundPlanning || input.expectedBuildId !== undefined && input.expectedBuildId !== build.id) throw new Error('[avg-sound] 当前制作缺少准确原声音Build')
  if (input.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  let result: ProductProductionSchedulerProjectionV1
  if (['preview-ready', 'release-ready', 'released'].includes(build.status)) {
    // The closed public factory does not revoke immutable proof reads. The
    // scheduler verifies every original source and never invokes this executor.
    result = await runProductProductionSchedulerCycleV1({ ...input, scope,
      executor: async () => { throw new Error('[avg-sound] 冻结复验不能创建新执行') } })
  } else {
    if (!avgSoundProductionExecutionReadyV1()) throw new Error('[avg-sound] 声音实际生产、审听和采用闭环尚未接通，未解析凭据或创建调用')
    if (details.production.status !== 'producing' || details.brief?.revision !== build.briefRevision
      || details.production.currentBuildNumber !== build.buildNumber || details.production.controlEpoch !== build.controlEpoch
      || !['authorized', 'building', 'integrating'].includes(build.status)) throw new Error('[avg-sound] 当前声音任务已停止或待开始方案已变化')
    await (await import('./visual-planning-restart')).assertAvgSoundOtherRequestsKnownV1(scope, build)
    const capabilityBindings: ProductProductionCapabilityBindingV1[] = []
    const music = brief.avgSoundPlanning.version === 1 ? createConfiguredAvgSoundTransportV1({ declaration: brief.avgSoundPlanning }).binding : null
    if (music) capabilityBindings.push(music)
    if (build.planRevision) {
      const plan = parseProductProductionPlanV3(build.planJson, brief, build.briefHash)
      const projection = await projectProductProductionSchedulerV1({ scope, productionId: input.productionId })
      const task = plan.tasks.find(t => t.kind === 'avg-sound-plan-propose')
      const state = projection.tasks.find(t => t.taskKey === task?.taskKey)
      // Human adoption is reconciled before the scheduler claims the next
      // model task. Presence predicts that transition only; the real author,
      // producer and registered Context proofs still govern admission/dispatch.
      const adopted = await db.productBuildArtifacts.where('buildId').equals(build.id).toArray()
      const sourcesPresent = task?.inputArtifactKeys.every(key => adopted.filter(r => r.artifactKey === key
        && r.controlEpoch === build.controlEpoch && r.status === 'accepted').length === 1)
      if (state && ['ready', 'retry-ready', 'waiting'].includes(state.status) && sourcesPresent) {
        const requirement = brief.capabilityRequirements.find(c => c.requirementKey === AVG_SOUND_TEXT_CAPABILITY_V1)
        if (!requirement) throw new Error('[avg-sound] 缺少冻结的声音策划能力')
        const { receipt } = await resolveConfiguredTextCapabilityV1({ projectId: scope.projectId, category: 'product-production',
          requirementKey: requirement.requirementKey, expectedCapabilityHash: requirement.capabilityHash })
        capabilityBindings.push({ requirementKey: receipt.requirementKey, adapterId: receipt.adapterId,
          bindingHash: receipt.capabilityHash, provider: receipt.provider, model: receipt.model })
      }
    }
    const current = await db.productBuilds.get(build.id), production = await db.productProductions.get(input.productionId)
    if (canonicalProductProductionJsonV2(current) !== canonicalProductProductionJsonV2(build)
      || canonicalProductProductionJsonV2(production) !== canonicalProductProductionJsonV2(details.production)) throw new Error('[avg-sound] 解析期间制作来源已变化')
    result = await runProductProductionUntilBlockedV1({ ...input, scope, capabilityBindings,
      executor: createConfiguredProductProductionExecutorV1({ production: details.production, brief }) })
  }
  await input.onProgress?.(result)
  return result
}
