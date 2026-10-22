/** Source paths are checked against exact frozen world resources, never a mutable table row. */
import type { ProductSourcePlanV1 } from '../types'
import type { TtrpgOpenFrozenFactV1, TtrpgOpenSourceFieldRef } from './open-contract'
import { frozenFact } from './open-content-predicates'
import { resolveProductSourceReadBoundaryV1 } from '../product/source-contracts'
import { listWorldSemanticResourceDescriptorsV1, readWorldSemanticResourcesV1,
  assertWorldSemanticReleaseCurrentV1, type WorldSemanticResourceSnapshotV1 } from '../context-gateway/world-release-client'
import * as p from './open-contract-parse'

function hasSourcePath(value: Record<string, unknown>, path: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9_-]*(?:(?:\.[A-Za-z][A-Za-z0-9_-]*)|(?:\[(?:0|[1-9]\d*)\]))*$/.test(path)) return false
  const segments = path.replace(/\[(\d+)\]/g, '.$1').split('.')
  let current: unknown = value
  for (const segment of segments) {
    if (current === null || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, segment)) return false
    current = (current as Record<string, unknown>)[segment]
  }
  return current !== undefined
}

/** This validates provenance, not the truth of an author's natural-language interpretation. */
export function assertTtrpgOpenSourceFieldProvenanceV1(input: {
  facts: readonly TtrpgOpenFrozenFactV1[]; resources: readonly WorldSemanticResourceSnapshotV1[]
}): TtrpgOpenSourceFieldRef[] {
  p.unique(input.resources.map(resource => resource.descriptor.resourceKey), 'source resource keys');
  const resources = new Map(input.resources.map(resource => [resource.descriptor.resourceKey, resource]))
  const fields: TtrpgOpenSourceFieldRef[] = []
  for (const raw of input.facts) {
    const fact = frozenFact(raw, 'confirmed source fact')
    for (const field of fact.sourceFieldRefs) {
      const resource = resources.get(field.resourceKey)
      if (!resource || resource.descriptor.sourceKey !== 'worldRelease'
        || resource.descriptor.contentHash !== field.contentHash || !hasSourcePath(resource.value, field.fieldPath)) {
        p.fail(`事实来源缺失、hash 不一致或字段路径不存在:${fact.factKey}`)
      }
      fields.push({ ...field })
      if (fields.length > 100_000) p.fail('事实来源字段总量超过100000')
    }
  }
  return fields
}

/** S2 review/save/start reads only claimed sources inside the already frozen SourcePlan. */
export async function verifyTtrpgOpenAuthoringSourceProvenanceV1(input: {
  sourcePlan: ProductSourcePlanV1; facts: readonly TtrpgOpenFrozenFactV1[]
}): Promise<TtrpgOpenSourceFieldRef[]> {
  const facts = input.facts.map(fact => frozenFact(fact, 'source fact'))
  return verifyTtrpgOpenSourceClaimsV1({ sourcePlan: input.sourcePlan, claims: facts.map(fact => ({
    label: fact.factKey, sourceResourceRefs: fact.sourceResourceRefs, sourceFieldRefs: fact.sourceFieldRefs,
  })) })
}

/** Independent entity provenance uses source claims, never manufactured semantic facts. */
export async function verifyTtrpgOpenSourceClaimsV1(input: {
  sourcePlan: ProductSourcePlanV1
  claims: readonly { label: string; sourceResourceRefs: readonly string[]; sourceFieldRefs: readonly TtrpgOpenSourceFieldRef[] }[]
}): Promise<TtrpgOpenSourceFieldRef[]> {
  if (input.claims.length > 20_000 || input.claims.reduce((count, claim) => count + claim.sourceFieldRefs.length, 0) > 100_000) p.fail('事实或来源字段总量超限');
  const boundary = await resolveProductSourceReadBoundaryV1(input.sourcePlan)
  const keys = [...new Set(input.claims.flatMap(claim => [...claim.sourceResourceRefs, ...claim.sourceFieldRefs.map(field => field.resourceKey)]))]
  const allowedKeys = new Set(boundary.allowedResourceKeys);
  if (keys.length > 20_000 || keys.some(key => !allowedKeys.has(key))) p.fail('事实来源越过冻结 SourcePlan permission')
  if (!input.sourcePlan.permission.allowedDepths.includes('full') && keys.length) p.fail('事实字段验证需要允许 full 来源读取')
  const descriptors = await listWorldSemanticResourceDescriptorsV1(boundary.sourceScope)
  const descriptorByKey = new Map(descriptors.map(descriptor => [descriptor.resourceKey, descriptor]));
  const selected = keys.map(key => descriptorByKey.get(key) ?? p.fail('冻结世界缺少事实来源资源'))
  const resources = await readWorldSemanticResourcesV1({ scope: boundary.sourceScope, descriptors: selected })
  const byKey = new Map(resources.map(resource => [resource.descriptor.resourceKey, resource]))
  const fields: TtrpgOpenSourceFieldRef[] = []
  for (const claim of input.claims) {
    if (!claim.sourceResourceRefs.length || !claim.sourceFieldRefs.length
      || claim.sourceResourceRefs.some(key => !claim.sourceFieldRefs.some(field => field.resourceKey === key))) p.fail(`来源资源缺少字段证据:${claim.label}`)
    for (const field of claim.sourceFieldRefs) {
      const resource = byKey.get(field.resourceKey)
      if (!claim.sourceResourceRefs.includes(field.resourceKey) || !resource
        || resource.descriptor.sourceKey !== 'worldRelease' || resource.descriptor.contentHash !== field.contentHash
        || !hasSourcePath(resource.value, field.fieldPath)) p.fail(`来源缺失、hash 不一致或字段路径不存在:${claim.label}`)
      fields.push({ ...field })
    }
  }
  await assertWorldSemanticReleaseCurrentV1({ localReleaseRecordId: boundary.sourceScope.worldReleaseId ?? p.fail('冻结来源作用域缺少已解析的世界 locator'),
    expectedProjectId: boundary.sourceScope.projectId, expectedWorldId: boundary.sourceScope.worldId,
    expectedReleaseHash: input.sourcePlan.worldReference.releaseHash })
  return fields
}
