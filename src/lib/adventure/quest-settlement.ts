import type { AdventureEffect, AdventureRequirement } from '../types'
import {
  parseTextAdventureQuestScriptArtifactV2,
  type TextAdventureQuestScriptArtifactV2,
  type TextAdventureCastBibleArtifactV1,
  type TextAdventureNarrativeArcPlanArtifactV1,
} from './production-artifacts-v2'

export type TextAdventureResourceCostsV3 = Record<
  'success' | 'costlySuccess' | 'failure',
  Array<{ resourceKey: string; amount: number }>
>

export type TextAdventureQuestItemBindingV3 =
  | { kind: 'quest'; title: string; description: string }
  | { kind: 'starter'; itemKey: string }
  | { kind: 'world'; resourceKey: string }

type ObjectiveV2 = TextAdventureQuestScriptArtifactV2['mainObjectiveScripts'][number]
export interface TextAdventureQuestScriptArtifactV3 extends Omit<TextAdventureQuestScriptArtifactV2, 'version' | 'mainObjectiveScripts'> {
  version: 3
  mainObjectiveScripts: Array<Omit<ObjectiveV2, 'alternatives'> & {
    itemBinding: TextAdventureQuestItemBindingV3 | null
    alternatives: Array<ObjectiveV2['alternatives'][number] & {
      resourceCosts: TextAdventureResourceCostsV3
      recipientCharacterKey: string | null
    }>
  }>
}
export type TextAdventureQuestScriptArtifact = TextAdventureQuestScriptArtifactV2 | TextAdventureQuestScriptArtifactV3
type ParseInput = Parameters<typeof parseTextAdventureQuestScriptArtifactV2>[0]

export function textAdventureQuestRecipientsV3(
  cast: TextAdventureCastBibleArtifactV1,
  arc: TextAdventureNarrativeArcPlanArtifactV1,
): Record<string, string[]> {
  const npcs = new Set(cast.characters.filter(character => character.role !== 'player').map(character => character.key))
  return Object.fromEntries(arc.acts.flatMap(act => act.sceneCards.map(scene => (
    [scene.key, scene.castKeys.filter(key => npcs.has(key))]
  ))))
}

function fail(message: string): never {
  throw new Error(`[text-adventure-quest-settlement] ${message}`)
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`)
  return value as Record<string, unknown>
}
function exact(value: Record<string, unknown>, keys: string[], label: string): void {
  if (Object.keys(value).length !== keys.length || keys.some(key => !(key in value))) fail(`${label} 字段不精确`)
}
function text(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) fail(`${label} 无效`)
  return value.trim().normalize('NFC')
}

/** V2 remains byte-for-byte compatible. V3 adds only bounded, explicit settlements. */
export function parseTextAdventureQuestScriptArtifact(input: ParseInput & {
  recipientKeysByScene?: Readonly<Record<string, readonly string[]>>
}): TextAdventureQuestScriptArtifact {
  const row = object(input.value, 'questScript')
  if (row.version !== 3) return parseTextAdventureQuestScriptArtifactV2(input)
  exact(row, ['schema', 'version', 'mainObjectiveScripts', 'sideQuestScripts', 'ambientEventScripts'], 'questScript')
  if (!Array.isArray(row.mainObjectiveScripts)) fail('mainObjectiveScripts 必须是数组')
  const rawObjectives = row.mainObjectiveScripts.map(value => object(value, 'objective'))
  const base = parseTextAdventureQuestScriptArtifactV2({
    ...input,
    value: {
      ...row, version: 2,
      mainObjectiveScripts: rawObjectives.map(row => {
        exact(row, ['objectiveKey', 'sceneKey', 'itemBinding', 'alternatives'], 'objective')
        if (!Array.isArray(row.alternatives)) fail('alternatives 必须是数组')
        const { itemBinding: _itemBinding, ...objective } = row
        return {
          ...objective,
          alternatives: row.alternatives.map(value => {
            const alternative = object(value, 'alternative')
            exact(alternative, ['alternativeKey', 'resolution', 'timeCostMinutes', 'successText', 'costlySuccessText', 'failureForwardText', 'resourceCosts', 'recipientCharacterKey'], 'alternative')
            const { resourceCosts: _costs, recipientCharacterKey: _recipient, ...legacy } = alternative
            return legacy
          }),
        }
      }),
    },
  })
  const resourceByKey = new Map(input.systems.resources.map(resource => [resource.key, resource]))
  const plannedObjectives = new Map(input.mainQuestPlan.quests[0].objectives.map(objective => [objective.key, objective]))
  return {
    ...base, version: 3,
    mainObjectiveScripts: base.mainObjectiveScripts.map((objective, index) => {
      const raw = rawObjectives[index]
      const planned = plannedObjectives.get(objective.objectiveKey)!
      const itemKinds = planned.alternatives.map(alternative => alternative.actionKind)
      const needsItem = itemKinds.some(kind => ['take', 'give', 'use'].includes(kind))
      let itemBinding: TextAdventureQuestItemBindingV3 | null = null
      if (raw.itemBinding !== null) {
        const binding = object(raw.itemBinding, 'itemBinding')
        if (binding.kind === 'quest') {
          exact(binding, ['kind', 'title', 'description'], 'itemBinding')
          itemBinding = { kind: 'quest', title: text(binding.title, 'itemBinding.title', 120), description: text(binding.description, 'itemBinding.description', 2_000) }
        } else if (binding.kind === 'starter') {
          exact(binding, ['kind', 'itemKey'], 'itemBinding')
          const itemKey = text(binding.itemKey, 'itemBinding.itemKey', 200)
          if (!input.systems.starterEquipment.some(item => item.key === itemKey)) fail(`未知初始物品:${itemKey}`)
          itemBinding = { kind: 'starter', itemKey }
        } else if (binding.kind === 'world') {
          exact(binding, ['kind', 'resourceKey'], 'itemBinding')
          const resourceKey = text(binding.resourceKey, 'itemBinding.resourceKey', 200)
          if (!input.brief.source.selection.resourceKeys.includes(resourceKey)) fail(`物品来源未在冻结选择中:${resourceKey}`)
          itemBinding = { kind: 'world', resourceKey }
        } else fail('itemBinding.kind 无效')
      }
      if (needsItem !== (itemBinding !== null)) fail(`目标物品绑定与行动种类不一致:${objective.objectiveKey}`)
      if (itemKinds.includes('take') && itemBinding?.kind !== 'quest') fail('take 只能领取本目标的产品物品；已有物品使用其原领取入口')
      return {
        ...objective, itemBinding,
        alternatives: objective.alternatives.map((alternative, alternativeIndex) => {
          const rawAlternative = object((raw.alternatives as unknown[])[alternativeIndex], 'alternative')
          const costs = object(rawAlternative.resourceCosts, 'resourceCosts')
          exact(costs, ['success', 'costlySuccess', 'failure'], 'resourceCosts')
          const resourceCosts = {} as TextAdventureResourceCostsV3
          for (const outcome of ['success', 'costlySuccess', 'failure'] as const) {
            const values = costs[outcome]
            if (!Array.isArray(values) || values.length > 4) fail(`resourceCosts.${outcome} 数量无效`)
            resourceCosts[outcome] = values.map(value => {
              const cost = object(value, `resourceCosts.${outcome}`)
              exact(cost, ['resourceKey', 'amount'], 'resourceCost')
              const resourceKey = text(cost.resourceKey, 'resourceCost.resourceKey', 200)
              const resource = resourceByKey.get(resourceKey)
              if (!resource || !['health', 'mana', 'stamina', 'currency'].includes(resource.role)) fail(`不允许消耗此资源:${resourceKey}`)
              if (!Number.isSafeInteger(cost.amount) || Number(cost.amount) < 1 || Number(cost.amount) > resource.maximum - resource.minimum) fail(`资源消耗越界:${resourceKey}`)
              return { resourceKey, amount: Number(cost.amount) }
            })
            if (new Set(resourceCosts[outcome].map(cost => cost.resourceKey)).size !== resourceCosts[outcome].length) fail(`重复资源消耗:${outcome}`)
            if (alternative.resolution.mode === 'automatic' && outcome !== 'success' && resourceCosts[outcome].length) fail('automatic 不得声明不可达结果的消耗')
          }
          const plannedAlternative = planned.alternatives.find(item => item.key === alternative.alternativeKey)!
          let recipientCharacterKey: string | null = null
          if (rawAlternative.recipientCharacterKey !== null) {
            recipientCharacterKey = text(rawAlternative.recipientCharacterKey, 'recipientCharacterKey', 200)
            if (!input.recipientKeysByScene?.[objective.sceneKey]?.includes(recipientCharacterKey)) fail(`交付对象不是当前场景的正式 NPC:${recipientCharacterKey}`)
          }
          if ((plannedAlternative.actionKind === 'give') !== (recipientCharacterKey !== null)) fail('仅 give 必须绑定真实交付对象')
          return { ...alternative, resourceCosts, recipientCharacterKey }
        }),
      }
    }),
  }
}

/** Reserve the worst reachable outcome before a roll; no outcome can partially overdraw. */
export function compileTextAdventureResourceCostsV3(
  costs: TextAdventureResourceCostsV3,
  minimumByKey: ReadonlyMap<string, number>,
): { requirements: AdventureRequirement[]; effects: Record<keyof TextAdventureResourceCostsV3, AdventureEffect[]> } {
  const maxima = new Map<string, number>()
  const effects = {} as Record<keyof TextAdventureResourceCostsV3, AdventureEffect[]>
  for (const outcome of ['success', 'costlySuccess', 'failure'] as const) {
    effects[outcome] = costs[outcome].map(cost => {
      if (!minimumByKey.has(cost.resourceKey)) fail(`编译资源未登记:${cost.resourceKey}`)
      maxima.set(cost.resourceKey, Math.max(maxima.get(cost.resourceKey) ?? 0, cost.amount))
      return { op: 'change-resource', resourceKey: cost.resourceKey, delta: -cost.amount }
    })
  }
  return {
    requirements: [...maxima].map(([resourceKey, amount]) => ({ resourceKey, resourceMinimum: minimumByKey.get(resourceKey)! + amount })),
    effects,
  }
}
