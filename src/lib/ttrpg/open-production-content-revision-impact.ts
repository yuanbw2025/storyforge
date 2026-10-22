/** Read-only recovery effects. Drift uses the scheduler's existing verifier;
 * this module never relaxes historical execution freshness or grants a call. */
import { db } from '../db/schema'
import type { ProductProductionPlanV3, TtrpgOpenContentRevisionV1, WorkspaceScope } from '../types'
import { createAgentSkillExecutionBindingV1 } from '../agent/execution-binding'
import { getAgentSkillV1 } from '../agent/skill-registry'
import { canonicalProductProductionJsonV2 as json, hashProductProductionValueV2 as hash } from '../product-production/hash'

export async function inspectTtrpgOpenContentRevisionImpactV1(input: {
  scope: WorkspaceScope; buildId: number; plan: ProductProductionPlanV3
  fromControlEpoch: number; sourcePlanHash: string; artifactKey: TtrpgOpenContentRevisionV1['artifactKey']
}) {
  const build = await db.productBuilds.get(input.buildId)
  if (!build || input.plan.productType !== 'ttrpg' || build.projectId !== input.scope.projectId
    || build.worldId !== input.scope.worldId || build.workId !== input.scope.workId) {
    throw Error('[ttrpg-content-impact] 原制作影响核对作用域不一致')
  }
  const bindings = () => input.plan.tasks.map(task => ({ taskKey: task.taskKey,
    executionMode: task.executionMode, kind: task.kind, skillId: task.skillId ?? null,
    bindings: task.skillId ? [createAgentSkillExecutionBindingV1(getAgentSkillV1(task.skillId))] : [] }))
    .sort((a, b) => a.taskKey < b.taskKey ? -1 : a.taskKey > b.taskKey ? 1 : 0)
  const readSet = async () => {
    const builds = (await db.productBuilds.where('productionId').equals(build.productionId).toArray())
      .filter(row => row.projectId === build.projectId && row.worldId === build.worldId && row.workId === build.workId)
    return { bindings: bindings(), builds: await Promise.all(builds.map(async row => {
      const runs = await db.agentRuns.where('productBuildId').equals(row.id!).toArray()
      return { build: row, artifacts: await db.productBuildArtifacts.where('buildId').equals(row.id!).toArray(),
        runs: await Promise.all(runs.map(async run => ({ run,
          events: await db.agentRunEvents.where('runId').equals(run.id!).toArray(),
          checkpoints: await db.agentRunCheckpoints.where('runId').equals(run.id!).toArray() }))) }
    })) }
  }
  const before = json(await readSet())
  const { executionBindingDriftInvalidatedTaskKeysV1, expandProductProductionInvalidatedTaskClosureV1 } = await import('../product-production/scheduler')
  const causal = expandProductProductionInvalidatedTaskClosureV1(input.plan, [input.artifactKey])
  const drift = await executionBindingDriftInvalidatedTaskKeysV1({ scope: input.scope, buildId: input.buildId,
    plan: input.plan, previousControlEpoch: input.fromControlEpoch, allowHistoricalProducerFallback: true })
  const affected = expandProductProductionInvalidatedTaskClosureV1(input.plan, [...causal, ...drift])
  const tasks = input.plan.tasks.filter(task => affected.has(task.taskKey)).map(task => ({ taskKey: task.taskKey,
    execution: task.taskKey === input.artifactKey ? 'author' as const : task.executionMode }))
  const impactHash = await hash({ schema: 'storyforge.ttrpg-content-revision-impact', version: 1,
    sourcePlanHash: input.sourcePlanHash, fromControlEpoch: input.fromControlEpoch, artifactKey: input.artifactKey,
    tasks: [...tasks].sort((a, b) => a.taskKey < b.taskKey ? -1 : a.taskKey > b.taskKey ? 1 : 0), bindings: bindings() })
  const assertCurrent = async () => {
    if (json(await readSet()) !== before) throw Error('[ttrpg-content-impact] 原稿、执行版本或恢复证据已变化，请重新核对影响')
  }
  await assertCurrent()
  return { tasks, impactHash, additionalTaskKeys: [...affected].filter(key => !causal.has(key)).sort(), assertCurrent }
}

export function assertTtrpgOpenContentRevisionImpactV1(
  impact: Pick<Awaited<ReturnType<typeof inspectTtrpgOpenContentRevisionImpactV1>>, 'impactHash' | 'additionalTaskKeys'>,
  expectedImpactHash: string | undefined,
) {
  // The explicit author draft must execute before any newly generated
  // descendant can block for review. Rebuilding an ancestor first could
  // replace its inputs and lose this draft's authority across that review.
  // A hash of those effects is evidence, not permission to defer the draft.
  if (impact.additionalTaskKeys.length > 0) {
    throw Error('[ttrpg-content-impact] 原稿的上游执行版本已变化，不能在此轮局部返修；请保留旧轮次后明确开始新一轮制作')
  }
  if (expectedImpactHash !== undefined ? expectedImpactHash !== impact.impactHash : impact.additionalTaskKeys.length > 0) {
    throw Error('[ttrpg-content-impact] 执行版本或实际影响已变化，不能增加未核对的岗位；请重新核对返修影响')
  }
}
