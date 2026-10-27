/** Content/identity integrity does not by itself grant a live entity creation permission. */
import type { TtrpgOpenEntityOperationV1 } from './open-entity-contract'
import { hashProductProductionValueV2 as hash } from '../product-production/hash'
import { ttrpgOpenScopedKeyV1 } from './open-coordination'
import type { TtrpgRuntimeContentV2 } from './content-version'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
export async function verifyTtrpgOpenEntityPlanHashesV1(operations: readonly TtrpgOpenEntityOperationV1[], content?: TtrpgRuntimeContentV2) {
  for (const { plan } of operations) {
    const { planHash, ...body } = plan
    if (await hash(body) !== planHash || plan.operationKey !== await ttrpgOpenScopedKeyV1(plan.proposedRef.sessionKey, 'entity-operation', [plan.rootCommandId])) throw new Error('实体原计划或系统身份已损坏')
    if (content && plan.frozenContentJson !== stable(content)) throw new Error('实体原冻结定义证据与本团局实际来源不一致')
    for (const [index, item] of plan.items.entries()) {
      if (item.entityKey !== 'entity.' + (await hash({ sessionKey: plan.proposedRef.sessionKey, operationKey: plan.operationKey, index })).slice(0, 48)) throw new Error('实体身份不是原计划内核分配结果')
      if (content) {
        const template = content.campaign.dynamicEntityTemplates.find(row => row.templateKey === item.proposal.templateKey)
        if (!template || await hash(template) !== item.templateHash || plan.rulePackContentHash !== content.rulePack.contentHash) throw new Error('实体原模板或规则证据已经变化')
      }
    }
    if (plan.version === 2) await (await import('./open-entity-model-proof')).verifyTtrpgOpenEntityModelOriginV1(plan)
  }
}

/** Actual mutable resources may evolve; immutable instance identity and its sole ledger owner may not disappear or change type. */
export async function verifyTtrpgOpenEntityStateV1(state: import('../types').ProductRuntimeState, content: TtrpgRuntimeContentV2) {
  const runtime = (await import('./open-runtime-contract')).parseTtrpgRuntimeStateV2(state.ttrpg)
  if (!runtime?.openRun) return
  await verifyTtrpgOpenEntityPlanHashesV1(runtime.openRun.entityOperations ?? [], content)
  const catalog = (await import('./open-entity-catalog')).ttrpgOpenEntityIdentityCatalogV1(content, runtime.openRun.entityOperations ?? [])
  for (const identity of catalog.filter(row => row.dynamic)) {
    const entity = state.entities[identity.entityKey]
    if (!entity || entity.kind !== (identity.kind === 'actor' ? 'npc' : identity.kind) || entity.sourceId !== null || entity.attributes.productLocal !== true
      || entity.attributes.templateKey !== identity.templateKey || entity.attributes.role !== (identity.kind === 'actor' ? 'npc' : identity.kind)
      || entity.attributes.controller !== (identity.kind === 'actor' ? 'gm' : null)) throw new Error('已创建实体的原身份、类别或机械 owner 已损坏')
    if (identity.kind === 'item' && runtime.product.inventory.items[identity.entityKey]?.definitionRef !== identity.templateKey) throw new Error('已创建物品缺少同一原库存 owner')
  }
}
