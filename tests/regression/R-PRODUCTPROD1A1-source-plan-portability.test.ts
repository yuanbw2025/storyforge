import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { openWorldSemanticResourceCatalogV1 } from '../../src/lib/context-gateway/world-release-client'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { parseProductProductionSourcePlanV1 } from '../../src/lib/product-production/source-contracts'
import {
  freezeProductSourcePlanV1,
  type WorldRequirementAdapterV1,
} from '../../src/lib/product/source-contracts'
import type { ProductSourcePlanV1 } from '../../src/lib/types'
import {
  createWorldReferenceV1,
  validateWorldReferenceV1,
} from '../../src/lib/world-engine/world-reference'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { seedCurrentProductWorld } from '../helpers/current-product-world'

async function seedGenericSourcePlan(name: string) {
  const created = await seedCurrentProductWorld(name)
  const catalog = await openWorldSemanticResourceCatalogV1({
    localReleaseRecordId: created.release.id!,
    expectedProjectId: created.scope.projectId,
    expectedWorldId: created.scope.worldId,
  })
  const descriptor = catalog.resources.find(item => item.worldSemantic)
  if (!descriptor?.worldSemantic) throw new Error('测试 WorldRelease 缺少语义资源')
  const adapter: WorldRequirementAdapterV1<null> = {
    adapterId: 'test.generic-source-plan-portability',
    adapterVersion: 1,
    productType: 'text-open-world',
    contextTaskKind: 'agent-outline',
    resolve: () => [{
      key: 'portable-source',
      label: '便携来源',
      level: 'stable-required',
      selector: {
        areas: [descriptor.worldSemantic!.area],
        resourceKinds: [descriptor.worldSemantic!.resourceKind],
        contextKinds: [descriptor.kind],
        query: null,
      },
      minimumResources: 1,
      condition: null,
    }],
  }
  const productionKey = `generic-source-plan-${crypto.randomUUID()}`
  const sourcePlan = await freezeProductSourcePlanV1({
    productInstanceKey: productionKey,
    worldReference: await createWorldReferenceV1(created.release.id!),
    adapter,
    goal: null,
    missingStrategy: 'block',
    initialResourceKeys: [descriptor.resourceKey],
    createdAt: Date.now(),
  })
  const now = Date.now()
  const productionId = await db.productProductions.add(stampNewRecord(created.scope, 'productProductions', {
    ...created.scope,
    productionKey,
    productType: 'text-open-world',
    title: '通用 SourcePlan 便携回归',
    status: 'brief-ready',
    stateRevision: 1,
    controlEpoch: 0,
    currentBriefRevision: 1,
    currentBuildNumber: null,
    currentProductReleaseId: null,
    lastErrorJson: '{}',
    createdAt: now,
    updatedAt: now,
  } as never, { owner: 'work' })) as number
  const briefHash = await hashProductProductionValueV2({ fixture: productionKey })
  await db.productProductionBriefs.add(stampNewRecord(created.scope, 'productProductionBriefs', {
    ...created.scope,
    productionId,
    revision: 1,
    parentRevision: null,
    status: 'draft',
    briefKind: 'product-production-v3',
    sourceKind: 'world-release',
    sourceWorldReleaseId: created.release.id!,
    sourceWorldContentHash: created.release.contentHash,
    sourceWorkId: null,
    sourceOutlineRootId: null,
    sourceStartChapterId: null,
    sourceEndChapterId: null,
    sourceChapterIdsJson: '[]',
    sourceSelectionMode: null,
    sourceVersionHash: created.release.contentHash,
    sourceBoundaryHash: sourcePlan.worldReference.referenceHash,
    sourceBindingJson: '{}',
    sourceBindingHash: sourcePlan.worldReference.referenceHash,
    candidateRunId: null,
    userIntentSummary: '验证嵌套 WorldReference locator 重映射',
    unresolvedJson: '[]',
    estimateJson: '{}',
    briefJson: '{}',
    briefHash,
    sourcePlanJson: JSON.stringify(sourcePlan),
    sourcePlanHash: sourcePlan.planHash,
    confirmedBriefJson: '{}',
    confirmedBriefHash: '',
    authorizedAt: null,
    createdAt: now,
  } as never, { owner: 'work' }))
  return { created, sourcePlan }
}

describe('R-PRODUCTPROD-1A1 · ProductSourcePlan 嵌套 locator 便携性', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('通过 PROJECT_TABLES 把 WorldReference 本地主键导出为便携坐标并在导入后重绑', async () => {
    const fixture = await seedGenericSourcePlan(`SourcePlan portable ${crypto.randomUUID()}`)
    const backup = await exportProjectJSON(fixture.created.scope.projectId)
    const portableBrief = backup.productProductionBriefs[0]!
    const portablePlan = JSON.parse(portableBrief._sourcePlanPortableJson) as ProductSourcePlanV1

    expect(portableBrief).not.toHaveProperty('sourcePlanJson')
    expect(portablePlan.worldReference.localReleaseRecordId)
      .toBe(portableBrief._sourceWorldReleaseExportId)
    expect(portablePlan.worldReference.localReleaseRecordId)
      .not.toBe(fixture.created.release.id)
    expect(portablePlan.planHash).toBe(fixture.sourcePlan.planHash)

    const importedProjectId = await importProjectJSON(structuredClone(backup))
    const [importedBrief, importedRelease] = await Promise.all([
      db.productProductionBriefs.where('projectId').equals(importedProjectId).first(),
      db.worldReleases.where('projectId').equals(importedProjectId).first(),
    ])
    const rebound = await parseProductProductionSourcePlanV1(importedBrief!)
    expect(rebound.planHash).toBe(fixture.sourcePlan.planHash)
    expect(rebound.worldReference.localReleaseRecordId).toBe(importedRelease!.id)
    expect(rebound.worldReference.localReleaseRecordId).toBe(importedBrief!.sourceWorldReleaseId)
    expect(rebound.worldReference.localReleaseRecordId).not.toBe(fixture.created.release.id)
    await expect(validateWorldReferenceV1(rebound.worldReference)).resolves.toEqual(rebound.worldReference)
  }, 30_000)

  it('嵌套 locator 指向导出项目外记录时拒绝生成伪便携 SourcePlan', async () => {
    const fixture = await seedGenericSourcePlan(`SourcePlan unmapped ${crypto.randomUUID()}`)
    const brief = await db.productProductionBriefs
      .where('projectId').equals(fixture.created.scope.projectId).first()
    const tampered = JSON.parse(brief!.sourcePlanJson) as ProductSourcePlanV1
    tampered.worldReference.localReleaseRecordId = 999_999
    await db.productProductionBriefs.update(brief!.id!, { sourcePlanJson: JSON.stringify(tampered) })

    await expect(exportProjectJSON(fixture.created.scope.projectId))
      .rejects.toThrow(/sourcePlanJson.*缺少便携映射/)
  }, 30_000)
})
