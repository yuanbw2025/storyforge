import type {
  TextOpenWorldParsedModulesV1,
  TextOpenWorldRuntimePackageV1,
} from '../types'
import { parseTextOpenWorldModulesV1 } from './modules'

type CombatModule = TextOpenWorldParsedModulesV1['combat']
type EnemyDefinition = CombatModule['enemies'][number]
type EncounterDefinition = CombatModule['encounters'][number]
type RewardDefinition = TextOpenWorldParsedModulesV1['items']['rewardContracts'][number]

const KEY = /^[a-z][a-z0-9._:-]{0,199}$/

function fail(message: string): never { throw new Error(`[text-open-world-combat-definitions] ${message}`) }
function stableKey(value: unknown, label: string): string {
  if (typeof value !== 'string' || !KEY.test(value)) fail(`${label}无效`)
  return value
}

export type TextOpenWorldEncounterChallengeV1 = 'easy' | 'matched' | 'dangerous' | 'deadly'

export interface TextOpenWorldEncounterPreviewV1 {
  encounterKey: string
  title: string
  description: string
  locationKey: string
  questKeys: string[]
  recommendedLevel: number
  levelBand: { minimum: number; maximum: number }
  difficulty: 'standard'
  intensity: EncounterDefinition['intensity']
  relativeChallenge: TextOpenWorldEncounterChallengeV1
  enemyGroups: Array<{
    groupKey: string
    order: number
    count: number
    enemy: EnemyDefinition
  }>
  totalEnemyCount: number
  escapePolicy: EncounterDefinition['escapePolicy']
  defeatPolicy: EncounterDefinition['defeatPolicy']
  reward: RewardDefinition | null
  openingText: string
  victoryText: string
  defeatText: string
}

function relativeChallenge(encounter: EncounterDefinition, playerLevel: number): TextOpenWorldEncounterChallengeV1 {
  if (playerLevel >= encounter.levelBand.maximum + 2) return 'easy'
  if (playerLevel >= encounter.levelBand.minimum) return 'matched'
  if (playerLevel === encounter.levelBand.minimum - 1) return 'dangerous'
  return 'deadly'
}

/** Query-only catalog over the immutable Enemy/Encounter definitions in a ProductRelease. */
export function createTextOpenWorldCombatDefinitionCatalogV1(
  value: TextOpenWorldRuntimePackageV1 | string | unknown,
) {
  const modules = parseTextOpenWorldModulesV1(value)
  const enemyByKey = new Map(modules.combat.enemies.map(enemy => [enemy.key, enemy]))
  const encounterByKey = new Map(modules.combat.encounters.map(encounter => [encounter.key, encounter]))

  return {
    rules: () => structuredClone(modules.combat.rules),
    listDifficulties: () => structuredClone(modules.combat.difficultyProfiles),
    listStrategies: () => structuredClone(modules.combat.strategyProfiles),
    listEnemies: () => structuredClone(modules.combat.enemies),
    getEnemy: (enemyKey: string) => structuredClone(enemyByKey.get(stableKey(enemyKey, 'enemyKey')) ?? null),
    listEncounters: () => structuredClone(modules.combat.encounters),
    getEncounter: (encounterKey: string) => structuredClone(encounterByKey.get(stableKey(encounterKey, 'encounterKey')) ?? null),
  }
}

/**
 * Produces the player-facing pre-combat facts without starting or resolving a
 * battle. G2-23 will consume the same definitions to create the state machine.
 */
export function projectTextOpenWorldEncounterPreviewV1(input: {
  runtimePackage: TextOpenWorldRuntimePackageV1 | string | unknown
  encounterKey: string
  playerLevel: number
}): TextOpenWorldEncounterPreviewV1 {
  if (!Number.isInteger(input.playerLevel) || input.playerLevel < 1 || input.playerLevel > 20) fail('playerLevel必须为1到20的整数')
  const modules = parseTextOpenWorldModulesV1(input.runtimePackage)
  const encounterKey = stableKey(input.encounterKey, 'encounterKey')
  const encounter = modules.combat.encounters.find(item => item.key === encounterKey) ?? fail(`Encounter不存在:${encounterKey}`)
  const enemyGroups = encounter.enemyGroups.map(group => ({
    groupKey: group.key,
    order: group.order,
    count: group.count,
    enemy: structuredClone(modules.combat.enemies.find(enemy => enemy.key === group.enemyKey)
      ?? fail(`Enemy不存在:${group.enemyKey}`)),
  }))
  const reward = encounter.rewardContractKey == null
    ? null
    : modules.items.rewardContracts.find(item => item.key === encounter.rewardContractKey) ?? fail(`RewardContract不存在:${encounter.rewardContractKey}`)
  return {
    encounterKey: encounter.key,
    title: encounter.title,
    description: encounter.description,
    locationKey: encounter.locationKey,
    questKeys: structuredClone(encounter.questKeys),
    recommendedLevel: encounter.recommendedLevel,
    levelBand: structuredClone(encounter.levelBand),
    difficulty: encounter.difficultyProfileKey,
    intensity: encounter.intensity,
    relativeChallenge: relativeChallenge(encounter, input.playerLevel),
    enemyGroups,
    totalEnemyCount: enemyGroups.reduce((sum, group) => sum + group.count, 0),
    escapePolicy: structuredClone(encounter.escapePolicy),
    defeatPolicy: structuredClone(encounter.defeatPolicy),
    reward: reward == null ? null : structuredClone(reward),
    openingText: encounter.openingText,
    victoryText: encounter.victoryText,
    defeatText: encounter.defeatText,
  }
}
