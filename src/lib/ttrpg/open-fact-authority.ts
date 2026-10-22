/** Read-only predicate projection. The frozen index keeps source identity, never mutable final values. */
import type { ProductRuntimeState } from '../types'
import type { TtrpgRuntimeContentV2 } from './content-version'
import type { TtrpgOpenFrozenFactV1, TtrpgOpenScalar } from './open-contract'
import type { TtrpgPredicateFactSnapshotV1 } from './predicate'
import * as p from './open-contract-parse'

export function ttrpgOpenSocialFactBalanceKeyV1(fact: Pick<TtrpgOpenFrozenFactV1, 'subjectRef' | 'predicateKey' | 'objectRef'>): string {
  if (fact.objectRef === null || !['allied-with', 'hostile-to', 'owes'].includes(fact.predicateKey)) p.fail('社会事实缺少对象或合法关系类型')
  return `${fact.subjectRef}:${fact.predicateKey === 'owes' ? 'debt' : 'relationship'}:${fact.objectRef}`
}
function mechanicalValue(state: ProductRuntimeState, content: TtrpgRuntimeContentV2, fact: TtrpgOpenFrozenFactV1): TtrpgOpenScalar | null {
  const entity = state.entities[fact.subjectRef]
  const product = state.ttrpg?.product
  if (!entity || !product) p.fail('机械事实缺少当前 owner')
  switch (fact.predicateKey) {
    case 'located-at': {
      if (entity.kind !== 'item') return entity.locationKey
      const item = product.inventory.items[fact.subjectRef]
      if (!item || item.quantity <= 0) return null
      return item.ownerRef === null ? item.locationRef : state.entities[item.ownerRef]?.locationKey ?? null
    }
    case 'owns': {
      const item = product.inventory.items[fact.subjectRef]
      return item && item.quantity > 0 ? item.ownerRef : null
    }
    case 'destroyed': return entity.lifecycleStatus === 'destroyed'
    case 'open':
    case 'blocked': {
      const value = entity.attributes[`ttrpg.open.${fact.predicateKey}`]
      if (typeof value !== 'boolean') p.fail('机械布尔事实尚未初始化 owner')
      return value
    }
    case 'damaged': {
      const item = product.inventory.items[fact.subjectRef]
      if (item) {
        const maximum = content.rulePack.content.items.find(def => def.key === item.definitionRef)?.mechanics?.maximumDurability
        if (maximum == null || item.durability === null) p.fail('物品 damaged 需要冻结耐久规则')
        return maximum - item.durability
      }
      if (['player', 'character', 'npc'].includes(entity.kind)) {
        const maximum = entity.attributes.maxHp, current = entity.attributes.hp
        if (typeof maximum !== 'number' || typeof current !== 'number') p.fail('角色 damaged 缺少 HP owner')
        return Math.max(0, maximum - current)
      }
      const value = entity.attributes['ttrpg.open.damaged']
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) p.fail('地点 damaged 尚未初始化 owner')
      return value
    }
    case 'allied-with':
    case 'hostile-to':
    case 'owes': {
      const value = product.effectLedger.socialBalances[ttrpgOpenSocialFactBalanceKeyV1(fact)]
      if (typeof value !== 'number') p.fail('社会事实尚未初始化账本')
      return fact.predicateKey === 'owes' ? value : fact.predicateKey === 'allied-with' ? value > 0 : value < 0
    }
    default: return p.fail('机械事实的谓词/owner 不合法')
  }
}
export function projectTtrpgOpenWorldFactsV1(input: {
  state: ProductRuntimeState; content: TtrpgRuntimeContentV2; sessionFacts: readonly TtrpgPredicateFactSnapshotV1[]
}): TtrpgPredicateFactSnapshotV1[] {
  return input.content.campaign.frozenWorldPredicateIndex.entries.flatMap(fact => {
    const value = fact.owner === 'semantic-fact' ? fact.canonicalValue : mechanicalValue(input.state, input.content, fact)
    if (value === null) return []
    const semanticOverride = fact.authority === 'initial-state' && fact.owner === 'semantic-fact'
      ? input.sessionFacts.find(candidate => !candidate.retired && candidate.subjectRef === fact.subjectRef
        && candidate.predicateKey === fact.predicateKey && (candidate.objectRef ?? null) === fact.objectRef) : null
    return [{ subjectRef: fact.subjectRef, predicateKey: fact.predicateKey, objectRef: fact.objectRef,
      canonicalValue: semanticOverride?.canonicalValue ?? value }]
  })
}

/** Establishes only declared mechanical initial values, inside the existing release initializer. */
export function initializeTtrpgOpenMechanicalFactsV1(state: ProductRuntimeState, content: TtrpgRuntimeContentV2): void {
  const product = state.ttrpg?.product
  if (!product) p.fail('初始机械事实缺少产品 owner')
  const facts = content.campaign.frozenWorldPredicateIndex.entries.filter(fact => fact.owner !== 'semantic-fact')
  for (const fact of facts) {
    const entity = state.entities[fact.subjectRef]
    if (!entity) p.fail('初始机械事实没有实体绑定')
    if (['open', 'blocked'].includes(fact.predicateKey)) entity.attributes[`ttrpg.open.${fact.predicateKey}`] = fact.canonicalValue
    else if (fact.predicateKey === 'destroyed' && fact.canonicalValue === true) entity.lifecycleStatus = 'destroyed'
    else if (fact.predicateKey === 'damaged') {
      const item = product.inventory.items[fact.subjectRef]
      if (item) {
        const maximum = content.rulePack.content.items.find(def => def.key === item.definitionRef)?.mechanics?.maximumDurability
        if (maximum == null || typeof fact.canonicalValue !== 'number' || fact.canonicalValue > maximum) p.fail('初始物品损伤没有可支付的耐久定义')
        item.durability = maximum - fact.canonicalValue
        if (item.durability === 0 && !item.stateTags.includes('broken')) item.stateTags.push('broken')
      } else if (!['player', 'character', 'npc'].includes(entity.kind)) entity.attributes['ttrpg.open.damaged'] = fact.canonicalValue
      // Character HP already comes from the frozen character sheet. The check below rejects contradictions.
    } else if (fact.owner === 'social-ledger') {
      const key = ttrpgOpenSocialFactBalanceKeyV1(fact)
      if (fact.predicateKey === 'owes') product.effectLedger.socialBalances[key] = Number(fact.canonicalValue)
      else if (fact.canonicalValue === true) product.effectLedger.socialBalances[key] = fact.predicateKey === 'allied-with' ? 1 : -1
      else if (product.effectLedger.socialBalances[key] === undefined) product.effectLedger.socialBalances[key] = 0
    }
  }
  for (const fact of facts) if (mechanicalValue(state, content, fact) !== fact.canonicalValue) p.fail(`初始事实与机械 owner 冲突:${fact.factKey}`)
}
