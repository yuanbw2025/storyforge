import { db } from '../../src/lib/db/schema'
import { stageAvgAuthorArtifactV1 } from '../../src/lib/avg/author-artifacts'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { seedAvgAuthorArtifacts } from './avg-author-artifact-fixture'
import { avgSystemFixture } from './avg-system-fixture'

export async function seedAvgAuthorSystem(withScript = false) {
  const s = await seedAvgAuthorArtifacts()
  const build = (await db.productBuilds.get(s.buildId))!
  const brief = (await db.productProductionBriefs.where('productionId').equals(s.productionId).first())!
  // This controlled fixture freezes author-input tasks, not a live planner or
  // a claim that the product's new workbench/player is already open.
  const task = { ...s.plan.tasks[0]!, taskKey: 'author.system', lane: 'planning' as const, kind: 'avg-author-system-plan',
    outputArtifactKeys: ['avg.system.plan'], subjectLockKeys: ['avg.system.plan'], acceptanceGateIds: ['avg.system.structure'] }
  const tasks = [task, ...(withScript ? [{ ...task, taskKey: 'author.script', lane: 'content' as const, kind: 'avg-author-scene-script',
    dependsOn: ['author.system'], requiredReceipts: [{ taskKey: 'author.system', receiptHash: null }], inputArtifactKeys: ['avg.system.plan'],
    outputArtifactKeys: ['avg.content.scene-script.desk'], subjectLockKeys: ['avg.content.scene-script.desk'] }] : [])]
  const plan = parseProductProductionPlanV3({ ...s.plan, tasks, terminalTaskKey: tasks.at(-1)!.taskKey }, parseProductProductionBriefV3(brief.briefJson), build.briefHash)
  await db.productBuilds.update(s.buildId, { planJson: canonicalProductProductionJsonV2(plan), planHash: await hashProductProductionValueV2(plan) })
  return { ...s, plan }
}

export async function stageAvgAuthorSystem(s: Awaited<ReturnType<typeof seedAvgAuthorSystem>>, payload: unknown = avgSystemFixture()) {
  const build = (await db.productBuilds.get(s.buildId))!
  return stageAvgAuthorArtifactV1({ scope: s.scope, buildId: s.buildId, expectedBuildRevision: build.stateRevision,
    controlEpoch: build.controlEpoch, taskKey: 'author.system', artifactKey: 'avg.system.plan', kind: 'product-module', payload,
    declaration: '作者原创规则；隔离工程夹具，不是专业故事或商业质量验收' })
}
