/** TTRPG-owned authoring provenance and frozen open-mode source-plan policy. */
import type { ProductProductionBriefV3, ProductSourcePlanV1, WorkspaceScope } from '../types'
import { openWorldSemanticResourceCatalogV1 } from '../context-gateway/world-release-client'
import { validateProductSourcePlanV1, resolveProductSourceReadBoundaryV1 } from '../product/source-contracts'
import { createWorldReferenceV1 } from '../world-engine/world-reference'
import { validateTtrpgProductionBriefContentV3 } from './production-brief-v3'
import { verifyTtrpgOpenAuthoringSourceProvenanceV1 } from './open-source-provenance'
import { createProductProductionSourcePlanV1, parseProductProductionSourcePlanV1 } from '../product-production/source-contracts'
import type { ProductProductionBriefRecordV1 } from '../types'

export async function createTtrpgProductSourcePlanV1(input: Parameters<typeof createProductProductionSourcePlanV1>[0]): Promise<ProductSourcePlanV1> {
  if (input.brief.intent.productType !== 'ttrpg') throw new Error('[ttrpg-production-source] 不是跑团生产目标')
  const plan = await createProductProductionSourcePlanV1(input)
  if (plan.version !== 1) throw new Error('[ttrpg-production-source] 跑团尚未登记增强来源编译器')
  return validateProductSourcePlanV1(plan)
}

export async function readTtrpgProductSourcePlanV1(row: ProductProductionBriefRecordV1): Promise<ProductSourcePlanV1> {
  const parsed = await parseProductProductionSourcePlanV1(row)
  if (parsed.version !== 1) throw new Error('[ttrpg-production-source] 跑团尚未登记增强来源编译器')
  const plan = await validateProductSourcePlanV1(parsed)
  if (plan.productType !== 'ttrpg') throw new Error('[ttrpg-production-source] 来源计划不属于跑团')
  return plan
}

export async function verifyTtrpgOpenProductionSourcePlanV1(input: {
  scope: WorkspaceScope; productionKey: string; brief: ProductProductionBriefV3; verifiedSourcePlan?: ProductSourcePlanV1
}): Promise<ProductSourcePlanV1> {
  if (input.brief.intent.productType !== 'ttrpg' || !input.brief.ttrpgOpen) {
    throw new Error('[ttrpg-production-source] 不是开放跑团 Brief')
  }
  const open = await validateTtrpgProductionBriefContentV3(input.brief.ttrpgOpen)
  const plan = await validateProductSourcePlanV1(input.verifiedSourcePlan ?? open.sourcePlan)
  const catalog = await openWorldSemanticResourceCatalogV1({
    localReleaseRecordId: plan.worldReference.localReleaseRecordId,
    expectedProjectId: input.scope.projectId, expectedWorldId: input.scope.worldId,
  })
  if (catalog.description.identity.releaseHash !== input.brief.source.worldContentHash) {
    throw new Error('[product-production-source] Brief 的 WorldRelease hash 已过期')
  }
  const selected = new Set(input.brief.source.selection.resourceKeys)
  const descriptors = catalog.resources.filter(descriptor => selected.has(descriptor.resourceKey))
  if (descriptors.length !== selected.size) throw new Error('[product-production-source] Brief 选择包含不属于冻结 WorldRelease 的资源')
  if (!descriptors.length) throw new Error('[product-production-source] 正式产品至少需要一个作者冻结的世界资源')
  const reference = await createWorldReferenceV1(plan.worldReference.localReleaseRecordId)
  if (plan.planHash !== open.sourcePlan.planHash || plan.worldReference.referenceHash !== open.worldReference.referenceHash
    || plan.productInstanceKey !== input.productionKey || open.worldReference.referenceHash !== reference.referenceHash) {
    throw new Error('[product-production-source] open 来源计划不属于当前 Production/真实世界版本')
  }
  const boundary = await resolveProductSourceReadBoundaryV1(plan)
  const allowed = new Set(boundary.allowedResourceKeys)
  if (descriptors.some(descriptor => !allowed.has(descriptor.resourceKey))) {
    throw new Error('[product-production-source] open 制作选择越过已确认 SourcePlan 权限')
  }
  await verifyTtrpgOpenAuthoringSourceProvenanceV1({ sourcePlan: plan,
    facts: open.settings.openAuthoring.factPolicy.map(item => item.fact) })
  return plan
}
