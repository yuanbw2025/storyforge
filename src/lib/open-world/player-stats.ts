import type {
  TextOpenWorldDerivedPlayerStatBreakdownV1,
  TextOpenWorldDerivedPlayerStatKeyV1,
  TextOpenWorldDerivedPlayerStatsV1,
  TextOpenWorldParsedModulesV1,
  TextOpenWorldRuntimePackageV1,
} from '../types'
import { parseTextOpenWorldModulesV1 } from './modules'

const MAX_DERIVED_STAT = 1_000_000_000
const PRECISION = 1_000_000
const STAT_KEYS: TextOpenWorldDerivedPlayerStatKeyV1[] = [
  'maximumHealth', 'attack', 'defense', 'criticalChance', 'initiative', 'maximumSkillResource',
]

type EquipmentSlots = { weapon: string | null; armor: string | null; accessory: string | null }
type Attributes = { power: number; vitality: number; agility: number }
type Component = TextOpenWorldDerivedPlayerStatBreakdownV1['components'][number]
type Equipment = TextOpenWorldParsedModulesV1['items']['items'][number]

function fail(message: string): never { throw new Error(`[text-open-world-player-stats] ${message}`) }

function finite(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail(`${label}必须是${minimum}到${maximum}之间的有限数值`)
  }
  return value
}

function exactKeys(value: object, expected: readonly string[], label: string) {
  const actual = Object.keys(value).sort()
  const canonical = [...expected].sort()
  if (actual.length !== canonical.length || actual.some((key, index) => key !== canonical[index])) {
    fail(`${label}字段不符合合同:${actual.join(',')}`)
  }
}

function rounded(value: number): number {
  const result = Math.round(value * PRECISION) / PRECISION
  return Object.is(result, -0) ? 0 : result
}

function equippedItems(
  modules: TextOpenWorldParsedModulesV1,
  slots: EquipmentSlots,
): Equipment[] {
  exactKeys(slots, ['weapon', 'armor', 'accessory'], 'equippedItemKeyBySlot')
  const result: Equipment[] = []
  for (const [slot, itemKey] of Object.entries(slots)) {
    if (!['weapon', 'armor', 'accessory'].includes(slot)) fail(`未知装备位:${slot}`)
    if (itemKey == null) continue
    const item = modules.items.items.find(candidate => candidate.key === itemKey)
    if (!item || item.kind !== 'equipment' || item.equipmentSlotKey !== slot) fail(`装备引用无效:${slot}:${itemKey}`)
    result.push(item)
  }
  return result
}

function equipmentComponents(
  modules: TextOpenWorldParsedModulesV1,
  slots: EquipmentSlots,
): Partial<Record<TextOpenWorldDerivedPlayerStatKeyV1, Component[]>> {
  const result: Partial<Record<TextOpenWorldDerivedPlayerStatKeyV1, Component[]>> = {}
  for (const item of equippedItems(modules, slots)) {
    for (const semanticKey of STAT_KEYS) {
      const modifierKey = semanticKey === 'maximumSkillResource' ? 'skillResource' : semanticKey
      const modifier = item.statModifiers[modifierKey]
      if (modifier == null) continue
      finite(modifier, `${item.key}.${modifierKey}`, -MAX_DERIVED_STAT, MAX_DERIVED_STAT)
      ;(result[semanticKey] ??= []).push({ sourceKind: 'equipment', sourceKey: item.key, value: modifier })
    }
  }
  return result
}

/** Frozen equipment contribution used once, after an active skill's attribute coefficient. */
export function deriveTextOpenWorldEquipmentSkillPowerFromModulesV1(input: {
  modules: TextOpenWorldParsedModulesV1
  equippedItemKeyBySlot: EquipmentSlots
}): number {
  let total = 0
  for (const item of equippedItems(input.modules, input.equippedItemKeyBySlot)) {
    const modifier = item.statModifiers.skillPower
    if (modifier == null) continue
    total += finite(modifier, `${item.key}.skillPower`, -MAX_DERIVED_STAT, MAX_DERIVED_STAT)
    if (!Number.isFinite(total) || Math.abs(total) > MAX_DERIVED_STAT) fail('skillPower计算溢出')
  }
  return rounded(total)
}

function breakdown(input: {
  semanticKey: TextOpenWorldDerivedPlayerStatKeyV1
  formulaKey: string
  components: Component[]
  minimum: number
  maximum: number
}): TextOpenWorldDerivedPlayerStatBreakdownV1 {
  const rawValue = rounded(input.components.reduce((sum, component) => sum + component.value, 0))
  if (!Number.isFinite(rawValue) || Math.abs(rawValue) > MAX_DERIVED_STAT) fail(`${input.semanticKey}计算溢出`)
  const value = rounded(Math.min(input.maximum, Math.max(input.minimum, rawValue)))
  return { ...input, components: structuredClone(input.components), rawValue, value }
}

/** The only deterministic formula implementation for all runtime consumers. */
export function deriveTextOpenWorldPlayerStatsFromModulesV1(input: {
  modules: TextOpenWorldParsedModulesV1
  level: number
  attributes: Attributes
  equippedItemKeyBySlot: EquipmentSlots
}): TextOpenWorldDerivedPlayerStatsV1 {
  const { modules } = input
  const level = finite(input.level, 'level', 1, modules.progression.rules.maximumLevel)
  if (!Number.isInteger(level)) fail('level必须是整数')
  exactKeys(input.attributes, ['power', 'vitality', 'agility'], 'attributes')
  const power = finite(input.attributes.power, 'attributes.power', 0, 10_000)
  const vitality = finite(input.attributes.vitality, 'attributes.vitality', 0, 10_000)
  const agility = finite(input.attributes.agility, 'attributes.agility', 0, 10_000)
  const formulas = modules.progression.rules.formulas
  const equipment = equipmentComponents(modules, input.equippedItemKeyBySlot)
  const withEquipment = (semanticKey: TextOpenWorldDerivedPlayerStatKeyV1, components: Component[]) => [
    ...components, ...(equipment[semanticKey] ?? []),
  ]
  const result = {
    maximumHealth: breakdown({
      semanticKey: 'maximumHealth', formulaKey: 'health.v1', minimum: 1, maximum: MAX_DERIVED_STAT,
      components: withEquipment('maximumHealth', [
        { sourceKind: 'base', sourceKey: 'baseHealth', value: formulas.baseHealth },
        { sourceKind: 'attribute', sourceKey: 'vitality', value: vitality * formulas.healthPerVitality },
        { sourceKind: 'level', sourceKey: 'level', value: level * formulas.healthPerLevel },
      ]),
    }),
    attack: breakdown({
      semanticKey: 'attack', formulaKey: 'attack.v1', minimum: 0, maximum: MAX_DERIVED_STAT,
      components: withEquipment('attack', [
        { sourceKind: 'attribute', sourceKey: 'power', value: power * formulas.attackPerPower },
      ]),
    }),
    defense: breakdown({
      semanticKey: 'defense', formulaKey: 'defense.v1', minimum: 0, maximum: MAX_DERIVED_STAT,
      components: withEquipment('defense', [
        { sourceKind: 'attribute', sourceKey: 'vitality', value: vitality * formulas.defensePerVitality },
      ]),
    }),
    criticalChance: breakdown({
      semanticKey: 'criticalChance', formulaKey: 'critical.v1', minimum: 0, maximum: formulas.criticalChanceCap,
      components: withEquipment('criticalChance', [
        { sourceKind: 'base', sourceKey: 'baseCriticalChance', value: formulas.baseCriticalChance },
        { sourceKind: 'attribute', sourceKey: 'agility', value: agility * formulas.criticalChancePerAgility },
      ]),
    }),
    initiative: breakdown({
      semanticKey: 'initiative', formulaKey: 'initiative.v1', minimum: 0, maximum: MAX_DERIVED_STAT,
      components: withEquipment('initiative', [
        { sourceKind: 'attribute', sourceKey: 'agility', value: agility * formulas.initiativePerAgility },
      ]),
    }),
    maximumSkillResource: breakdown({
      semanticKey: 'maximumSkillResource', formulaKey: 'skill-resource.v1', minimum: 0, maximum: MAX_DERIVED_STAT,
      components: withEquipment('maximumSkillResource', [
        { sourceKind: 'base', sourceKey: 'baseSkillResource', value: formulas.baseSkillResource },
        { sourceKind: 'level', sourceKey: 'level', value: level * formulas.skillResourcePerLevel },
      ]),
    }),
  }
  return {
    maximumHealth: result.maximumHealth.value,
    attack: result.attack.value,
    defense: result.defense.value,
    criticalChance: result.criticalChance.value,
    initiative: result.initiative.value,
    maximumSkillResource: result.maximumSkillResource.value,
    breakdown: result,
  }
}

export function deriveTextOpenWorldPlayerStatsV1(input: {
  runtimePackage: TextOpenWorldRuntimePackageV1
  level: number
  attributes: Attributes
  equippedItemKeyBySlot: EquipmentSlots
}): TextOpenWorldDerivedPlayerStatsV1 {
  return deriveTextOpenWorldPlayerStatsFromModulesV1({
    modules: parseTextOpenWorldModulesV1(input.runtimePackage),
    level: input.level,
    attributes: input.attributes,
    equippedItemKeyBySlot: input.equippedItemKeyBySlot,
  })
}
