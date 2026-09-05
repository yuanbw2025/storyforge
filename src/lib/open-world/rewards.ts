import type {
  TextOpenWorldEffectPlanV1,
  TextOpenWorldEffectStateV1,
  TextOpenWorldRandomEvidenceV1,
  TextOpenWorldRandomRequestV1,
  TextOpenWorldRuntimePackageV1,
} from '../types'
import { parseTextOpenWorldRandomEvidenceV1 } from './event-contract'
import { createTextOpenWorldEffectCatalogV1 } from './effect-dsl'
import { parseTextOpenWorldModulesV1 } from './modules'

const KEY = /^[a-z][a-z0-9._:-]{0,199}$/

function fail(message: string): never { throw new Error(`[text-open-world-reward] ${message}`) }
function stableKey(value: unknown, label: string): string {
  if (typeof value !== 'string' || !KEY.test(value)) fail(`${label}无效`)
  return value
}

export interface TextOpenWorldRewardPreparationV1 {
  schema: 'storyforge.text-open-world.reward-preparation'
  version: 1
  rewardKey: string
  sourceInstanceKey: string
  claimKey: string
  randomRequests: TextOpenWorldRandomRequestV1[]
}

export interface TextOpenWorldResolvedRewardV1 {
  preparation: TextOpenWorldRewardPreparationV1
  effectKeys: string[]
  drops: Array<{ dropTableKey: string; itemKey: string; quantity: number; effectKey: string }>
  effectPlan: TextOpenWorldEffectPlanV1
}

type ConditionResults = Record<string, boolean>

export function createTextOpenWorldRewardCatalogV1(value: TextOpenWorldRuntimePackageV1 | string | unknown) {
  const modules = parseTextOpenWorldModulesV1(value)
  const rewardByKey = new Map(modules.items.rewardContracts.map(reward => [reward.key, reward]))
  const dropByKey = new Map(modules.items.dropTables.map(table => [table.key, table]))
  const requireConditions = (conditionKeys: string[], conditionResults: ConditionResults, owner: string) => {
    conditionKeys.forEach(conditionKey => {
      if (conditionResults[conditionKey] !== true) fail(`${owner}条件未满足:${conditionKey}`)
    })
  }
  const prepare = (input: {
    rewardKey: string
    sourceInstanceKey: string
    conditionResults?: ConditionResults
  }): TextOpenWorldRewardPreparationV1 => {
    const rewardKey = stableKey(input.rewardKey, 'rewardKey')
    const sourceInstanceKey = stableKey(input.sourceInstanceKey, 'sourceInstanceKey')
    const reward = rewardByKey.get(rewardKey) ?? fail(`RewardContract不存在:${rewardKey}`)
    const conditionResults = input.conditionResults ?? {}
    requireConditions(reward.conditionKeys, conditionResults, reward.key)
    const randomRequests: TextOpenWorldRandomRequestV1[] = []
    for (const dropTableKey of reward.dropTableKeys) {
      const table = dropByKey.get(dropTableKey) ?? fail(`DropTable不存在:${dropTableKey}`)
      requireConditions(table.conditionKeys, conditionResults, table.key)
      const totalWeight = table.entries.reduce((sum, entry) => sum + entry.weight, 0)
      randomRequests.push({ drawKey: stableKey(`drop.${table.key}.selection`, 'selection drawKey'), minimumInclusive: 1, maximumInclusive: totalWeight })
      table.entries.forEach(entry => randomRequests.push({
        drawKey: stableKey(`drop.${table.key}.${entry.itemKey}.quantity`, 'quantity drawKey'),
        minimumInclusive: entry.minimum, maximumInclusive: entry.maximum,
      }))
    }
    if (randomRequests.length > 128) fail('奖励随机请求超过事件协议上限')
    const claimKey = stableKey(`claim.reward.${rewardKey}.${sourceInstanceKey}`, 'reward claimKey')
    return { schema: 'storyforge.text-open-world.reward-preparation', version: 1, rewardKey, sourceInstanceKey, claimKey, randomRequests }
  }

  const resolveSelection = (input: {
    preparation: TextOpenWorldRewardPreparationV1
    evidence: TextOpenWorldRandomEvidenceV1[]
    conditionResults?: ConditionResults
  }) => {
    const canonical = prepare({
      rewardKey: input.preparation.rewardKey,
      sourceInstanceKey: input.preparation.sourceInstanceKey,
      conditionResults: input.conditionResults,
    })
    if (input.preparation.schema !== canonical.schema || input.preparation.version !== 1
      || input.preparation.claimKey !== canonical.claimKey
      || JSON.stringify(input.preparation.randomRequests) !== JSON.stringify(canonical.randomRequests)) fail('RewardPreparation被篡改')
    if (!Array.isArray(input.evidence) || input.evidence.length !== canonical.randomRequests.length) fail('奖励随机证据数量不一致')
    const evidence = input.evidence.map((entry, index) => {
      const parsed = parseTextOpenWorldRandomEvidenceV1(entry, `rewardEvidence[${index}]`)
      const request = canonical.randomRequests[index]
      if (parsed.drawKey !== request.drawKey || parsed.minimumInclusive !== request.minimumInclusive
        || parsed.maximumInclusive !== request.maximumInclusive || parsed.drawIndex !== index) fail(`奖励随机证据与请求不一致:${index}`)
      return parsed
    })
    const reward = rewardByKey.get(canonical.rewardKey)!
    const drops: TextOpenWorldResolvedRewardV1['drops'] = []
    let evidenceIndex = 0
    for (const dropTableKey of reward.dropTableKeys) {
      const table = dropByKey.get(dropTableKey)!
      const selection = evidence[evidenceIndex++].value
      let cursor = 0
      const selected = table.entries.find(entry => { cursor += entry.weight; return selection <= cursor }) ?? fail(`DropTable权重无法解析:${table.key}`)
      const quantityEvidenceByItemKey = new Map<string, number>()
      table.entries.forEach(entry => { quantityEvidenceByItemKey.set(entry.itemKey, evidence[evidenceIndex++].value) })
      const quantity = quantityEvidenceByItemKey.get(selected.itemKey)!
      const effectKey = selected.quantityEffects.find(mapping => mapping.quantity === quantity)?.effectKey
        ?? fail(`DropTable数量没有授权Effect:${table.key}:${quantity}`)
      drops.push({ dropTableKey: table.key, itemKey: selected.itemKey, quantity, effectKey })
    }
    const effectKeys = [...reward.effectKeys, ...drops.map(drop => drop.effectKey)]
    if (new Set(effectKeys).size !== effectKeys.length) fail('奖励Effect不能重复')
    return { canonical, drops, effectKeys }
  }

  const resolve = async (input: {
    preparation: TextOpenWorldRewardPreparationV1
    evidence: TextOpenWorldRandomEvidenceV1[]
    state: TextOpenWorldEffectStateV1
    conditionResults?: ConditionResults
  }): Promise<TextOpenWorldResolvedRewardV1> => {
    const { canonical, drops, effectKeys } = resolveSelection(input)
    const authorization = {
      kind: 'reward' as const, rewardKey: canonical.rewardKey, sourceInstanceKey: canonical.sourceInstanceKey,
      randomRequests: canonical.randomRequests, drops,
    }
    const effectPlan = await createTextOpenWorldEffectCatalogV1(value).plan({ effectKeys, claimKey: canonical.claimKey, state: input.state, authorization })
    return { preparation: canonical, effectKeys, drops, effectPlan }
  }

  return {
    list: () => structuredClone(modules.items.rewardContracts),
    get: (rewardKey: string) => structuredClone(rewardByKey.get(stableKey(rewardKey, 'rewardKey')) ?? null),
    prepare,
    resolve,
    assertAuthorization: (input: {
      claimKey: string
      effectKeys: string[]
      authorization: Extract<NonNullable<TextOpenWorldEffectPlanV1['authorization']>, { kind: 'reward' }>
      evidence: TextOpenWorldRandomEvidenceV1[]
      conditionResults?: ConditionResults
    }) => {
      const preparation: TextOpenWorldRewardPreparationV1 = {
        schema: 'storyforge.text-open-world.reward-preparation', version: 1,
        rewardKey: input.authorization.rewardKey, sourceInstanceKey: input.authorization.sourceInstanceKey,
        claimKey: input.claimKey, randomRequests: input.authorization.randomRequests,
      }
      const resolved = resolveSelection({ preparation, evidence: input.evidence, conditionResults: input.conditionResults })
      if (input.claimKey !== resolved.canonical.claimKey || JSON.stringify(input.effectKeys) !== JSON.stringify(resolved.effectKeys)
        || JSON.stringify(input.authorization.drops) !== JSON.stringify(resolved.drops)) fail('奖励授权与EffectPlan不一致')
    },
  }
}
