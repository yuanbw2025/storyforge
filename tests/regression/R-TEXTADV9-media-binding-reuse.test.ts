import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { carryForwardProductBuildArtifactsAcrossBuildsV1 } from '../../src/lib/product-production/artifact-store'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { createProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import {
  applyCrossBuildEvolutionReuseV1,
  invalidateStaleCarriedTextAdventureVisionClosureV1,
  productProductionEvolutionTaskLaneV1,
} from '../../src/lib/product-production/scheduler'
import type { ProductBuildRecordV1, ProductProductionBriefV3 } from '../../src/lib/types'
import { seedTextAdventureMediaRevisionWorkbenchV1 } from '../helpers/text-adventure-media-revision-workbench'

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X8WgWQAAAABJRU5ErkJggg=='

async function evolutionFixture(options: { legacyWithoutPreflight?: boolean } = {}) {
  const seeded = await seedTextAdventureMediaRevisionWorkbenchV1(PNG_BASE64)
  const parent = (await db.productBuilds.get(seeded.parentBuildId))!
  const parentBriefRow = (await db.productProductionBriefs
    .where('[productionId+revision]').equals([seeded.productionId, parent.briefRevision]).first())!
  const parentBrief = parseProductProductionBriefV3(parentBriefRow.briefJson)
  let parentPlan = await createProductProductionPlanV3({
    brief: parentBrief,
    briefHash: parent.briefHash,
    buildNumber: parent.buildNumber,
    controlEpoch: parent.controlEpoch,
  })
  if (options.legacyWithoutPreflight) {
    parentPlan = {
      ...parentPlan,
      tasks: parentPlan.tasks
        .filter(task => task.taskKey !== 'media.vision-preflight')
        .map(task => task.taskKey === 'media.anchor-author-gate' ? {
          ...task,
          dependsOn: ['media.visual-bible.compile'],
          requiredReceipts: [{ taskKey: 'media.visual-bible.compile', receiptHash: null }],
          inputArtifactKeys: task.inputArtifactKeys.filter(key => key !== 'media.vision-preflight'),
          capabilityRequirementKeys: [],
        } : task),
    }
  }
  const parentPlanHash = await hashProductProductionValueV2(parentPlan)
  await db.productBuilds.update(parent.id!, {
    planJson: canonicalProductProductionJsonV2(parentPlan),
    planHash: parentPlanHash,
  })
  const childBrief: ProductProductionBriefV3 = {
    ...parentBrief,
    evolution: {
      schema: 'storyforge.product-evolution-impact',
      version: 1,
      base: {
        kind: 'recovery-build',
        buildNumber: parent.buildNumber,
        briefHash: parent.briefHash,
        planHash: parentPlanHash,
        controlEpoch: parent.controlEpoch,
      },
      userGoal: '只升级执行计划，不改变内容或媒资。',
      affectedLanes: ['execution-plan'],
    },
  }
  const childBriefHash = await hashProductProductionValueV2(childBrief)
  const childPlan = await createProductProductionPlanV3({
    brief: childBrief,
    briefHash: childBriefHash,
    buildNumber: parent.buildNumber + 1,
    controlEpoch: parent.controlEpoch,
  })
  const { id: _parentId, ...parentFields } = parent
  const childPlanHash = await hashProductProductionValueV2(childPlan)
  const childId = await db.productBuilds.add({
    ...parentFields,
    buildNumber: parent.buildNumber + 1,
    parentBuildNumber: parent.buildNumber,
    briefHash: childBriefHash,
    status: 'authorized',
    planRevision: 0,
    planJson: canonicalProductProductionJsonV2(childPlan),
    planHash: childPlanHash,
    packageHash: '', previewHash: '', manifestJson: '{}', previewManifestJson: '{}',
    completedAt: null, createdAt: Date.now(), updatedAt: Date.now(),
  } satisfies ProductBuildRecordV1) as number
  return { seeded, parent, childBrief, childPlan, childId }
}

describe('TEXTADV-9 · vision binding and execution-plan reuse', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('把 vision preflight 归入 visual lane，并只在现行父计划含预检时复用 preflight→anchor→图片闭包', async () => {
    expect(productProductionEvolutionTaskLaneV1('media.vision-preflight')).toBe('visual')
    expect(productProductionEvolutionTaskLaneV1('media.visual-quality-review.batch-1')).toBe('visual')
    expect(productProductionEvolutionTaskLaneV1('media.visual-quality-review.batch-12')).toBe('visual')
    const current = await evolutionFixture()
    const reused = await applyCrossBuildEvolutionReuseV1({
      scope: current.seeded.scope,
      build: {
        id: current.childId,
        productionId: current.parent.productionId,
        buildNumber: current.parent.buildNumber + 1,
        parentBuildNumber: current.parent.buildNumber,
        controlEpoch: current.parent.controlEpoch,
      },
      brief: current.childBrief,
      plan: current.childPlan,
    })
    expect(reused.plan.tasks.find(task => task.taskKey === 'media.vision-preflight')?.reuse).not.toBeNull()
    expect(reused.plan.tasks.find(task => task.taskKey === 'media.anchor-author-gate')?.reuse).not.toBeNull()
    expect(reused.plan.tasks.filter(task => /^media\.visual\.\d{3}$/.test(task.taskKey)))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ reuse: expect.objectContaining({ requiresRevalidation: true }) }),
      ]))

    await db.delete(); await db.open()
    const legacy = await evolutionFixture({ legacyWithoutPreflight: true })
    const upgraded = await applyCrossBuildEvolutionReuseV1({
      scope: legacy.seeded.scope,
      build: {
        id: legacy.childId,
        productionId: legacy.parent.productionId,
        buildNumber: legacy.parent.buildNumber + 1,
        parentBuildNumber: legacy.parent.buildNumber,
        controlEpoch: legacy.parent.controlEpoch,
      },
      brief: legacy.childBrief,
      plan: legacy.childPlan,
    })
    expect(upgraded.plan.tasks.find(task => task.taskKey === 'media.vision-preflight')?.reuse).toBeNull()
    expect(upgraded.plan.tasks.find(task => task.taskKey === 'media.anchor-author-gate')?.reuse).toBeNull()
    expect(upgraded.plan.tasks.filter(task => /^media\.visual\.\d{3}$/.test(task.taskKey))
      .every(task => task.reuse == null)).toBe(true)
  })

  it('当前文本 capability/provider/model 变化时使携带的预检、锚点与全部图片失效，且不产生图片调用', async () => {
    const owned = await evolutionFixture()
    const capabilityHash = '8'.repeat(64)
    const provider = 'fixture'
    const model = 'fixture-vision'
    const bindingIdentityHash = await hashProductProductionValueV2({
      schema: 'storyforge.text-adventure-vision-preflight-binding', version: 1,
      capabilityHash, provider, model,
    })
    const preflight = {
      schema: 'storyforge.text-adventure-vision-capability-preflight', version: 2,
      buildNumber: owned.parent.buildNumber,
      imageContentHash: '7'.repeat(64),
      observedQuadrants: ['red', 'cyan', 'black', 'yellow'],
      capabilityHash, provider, model,
      textCapabilityBindingHash: bindingIdentityHash,
      passed: true,
    }
    const parentPreflight = (await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([owned.parent.id!, 'media.vision-preflight']).first())!
    await db.productBuildArtifacts.update(parentPreflight.id!, {
      kind: 'integration-report',
      payloadJson: canonicalProductProductionJsonV2(preflight),
      contentHash: await hashProductProductionValueV2(preflight),
    })
    const reuse = await applyCrossBuildEvolutionReuseV1({
      scope: owned.seeded.scope,
      build: {
        id: owned.childId,
        productionId: owned.parent.productionId,
        buildNumber: owned.parent.buildNumber + 1,
        parentBuildNumber: owned.parent.buildNumber,
        controlEpoch: owned.parent.controlEpoch,
      },
      brief: owned.childBrief,
      plan: owned.childPlan,
    })
    await carryForwardProductBuildArtifactsAcrossBuildsV1({
      scope: owned.seeded.scope,
      sourceBuildId: owned.parent.id!,
      targetBuildId: owned.childId,
      targetControlEpoch: owned.parent.controlEpoch,
      artifactKeys: reuse.reusableArtifactKeys,
      recoverySource: {
        briefHash: owned.parent.briefHash,
        planHash: owned.parent.planHash,
        controlEpoch: owned.parent.controlEpoch,
      },
    })
    const currentBinding = [{
      requirementKey: owned.childBrief.capabilityRequirements.find(item => item.mediaClass === 'text')!.requirementKey,
      adapterId: 'configured-text.v1', bindingHash: capabilityHash, provider, model,
    }]
    await expect(invalidateStaleCarriedTextAdventureVisionClosureV1({
      scope: owned.seeded.scope,
      buildId: owned.childId,
      buildNumber: owned.parent.buildNumber + 1,
      controlEpoch: owned.parent.controlEpoch,
      plan: reuse.plan,
      capabilityBindings: currentBinding,
    })).resolves.toBe(false)

    const changedBinding = [{ ...currentBinding[0], model: 'fixture-vision-v2', bindingHash: '9'.repeat(64) }]
    await expect(invalidateStaleCarriedTextAdventureVisionClosureV1({
      scope: owned.seeded.scope,
      buildId: owned.childId,
      buildNumber: owned.parent.buildNumber + 1,
      controlEpoch: owned.parent.controlEpoch,
      plan: reuse.plan,
      capabilityBindings: changedBinding,
    })).resolves.toBe(true)
    const childArtifacts = await db.productBuildArtifacts.where('buildId').equals(owned.childId).toArray()
    for (const artifactKey of [
      'media.vision-preflight', 'media.anchor-decision',
      ...reuse.plan.tasks.filter(task => /^media\.visual\.\d{3}$/.test(task.taskKey))
        .flatMap(task => task.outputArtifactKeys),
    ]) {
      expect(childArtifacts.find(row => row.artifactKey === artifactKey)?.status).toBe('invalid')
    }
    const ledger = JSON.parse((await db.productBuilds.get(owned.childId))!.budgetLedgerJson) as {
      attempts?: Array<{ usage?: { mediaCalls?: number } }>
    }
    expect((ledger.attempts ?? []).reduce((sum, attempt) => sum + (attempt.usage?.mediaCalls ?? 0), 0)).toBe(0)
  })
})
