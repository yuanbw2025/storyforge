import type {
  TextOpenWorldDerivedPlayerStatKeyV1,
  TextOpenWorldSessionProjectionV1,
} from '../types'
import { parseTextOpenWorldModulesV1 } from './modules'
import {
  deriveTextOpenWorldContextsV1,
  parseTextOpenWorldSessionProjectionV1,
} from './session-projection'
import { createTextOpenWorldSkillCatalogV1 } from './skills'

export type TextOpenWorldPlayerAttributeSemanticV1 = 'power' | 'vitality' | 'agility'
export type TextOpenWorldPlayerSkillAcquisitionKindV1 = 'initial' | 'level' | 'quest'

export interface TextOpenWorldPlayerCharacterIdentityV1 {
  name: string
  pronouns: string
  appearance: string
  background: string
  personality: string
  publicKnowledge: string
  shortGoal: string
  longGoal: string
}

export interface TextOpenWorldPlayerCharacterAttributeV1 {
  semantic: TextOpenWorldPlayerAttributeSemanticV1
  label: string
  value: number
  initialValue: number
  levelGrowth: number
  growthByLevel: Array<{ level: number; value: number }>
}

export interface TextOpenWorldPlayerDerivedStatSourceV1 {
  kind: 'base' | 'level' | 'attribute' | 'equipment'
  label: string
  value: number
  displayValue: string
}

export interface TextOpenWorldPlayerDerivedStatV1 {
  semantic: TextOpenWorldDerivedPlayerStatKeyV1
  label: string
  value: number
  displayValue: string
  sources: TextOpenWorldPlayerDerivedStatSourceV1[]
}

export interface TextOpenWorldPlayerSkillAcquisitionV1 {
  kind: TextOpenWorldPlayerSkillAcquisitionKindV1
  label: string
  level: number | null
  questTitle: string | null
  discovered: boolean
}

export interface TextOpenWorldPlayerSkillV1 {
  title: string
  description: string
  tags: string[]
  learned: boolean
  stateLabel: '已学会' | '未解锁'
  activationLabel: '主动技能' | '被动技能'
  kindLabel: '攻击' | '状态' | '资源' | '恢复'
  targetLabel: '自身' | '单个敌人' | '所有敌人'
  scalingAttributeLabel: string | null
  resourceCost: number
  cooldownTurns: number
  cooldownRemainingTurns: number
  skillConditionsReady: boolean
  availabilityLabel: '技能条件就绪' | '技能条件受限' | '已掌握的被动技能' | '尚未学会'
  unavailableReasons: string[]
  acquisition: TextOpenWorldPlayerSkillAcquisitionV1[]
}

export interface TextOpenWorldPlayerStatusV1 {
  title: string
  description: string
  polarityLabel: '有益' | '有害' | '中性'
}

export interface TextOpenWorldPlayerCharacterProjectionV1 {
  identity: TextOpenWorldPlayerCharacterIdentityV1
  progression: {
    initialLevel: number
    level: number
    maximumLevel: number
    experience: number
    experienceIntoLevel: number
    experienceForNextLevel: number | null
    progressRatio: number
    atMaximumLevel: boolean
  }
  resources: {
    health: { label: '生命'; current: number; maximum: number; progressRatio: number }
    skillResource: { label: '技能资源'; current: number; maximum: number; progressRatio: number }
  }
  attributes: TextOpenWorldPlayerCharacterAttributeV1[]
  derivedStats: TextOpenWorldPlayerDerivedStatV1[]
  skills: TextOpenWorldPlayerSkillV1[]
  statuses: TextOpenWorldPlayerStatusV1[]
}

const ATTRIBUTE_SEMANTICS: TextOpenWorldPlayerAttributeSemanticV1[] = [
  'power',
  'vitality',
  'agility',
]

const DERIVED_STAT_SEMANTICS: TextOpenWorldDerivedPlayerStatKeyV1[] = [
  'maximumHealth',
  'attack',
  'defense',
  'criticalChance',
  'initiative',
  'maximumSkillResource',
]

const DERIVED_STAT_LABELS: Record<TextOpenWorldDerivedPlayerStatKeyV1, string> = {
  maximumHealth: '最大生命',
  attack: '攻击',
  defense: '防御',
  criticalChance: '暴击率',
  initiative: '先手',
  maximumSkillResource: '技能资源上限',
}

const BASE_SOURCE_LABELS: Partial<Record<TextOpenWorldDerivedPlayerStatKeyV1, string>> = {
  maximumHealth: '基础生命',
  criticalChance: '基础暴击率',
  maximumSkillResource: '基础技能资源',
}

const KNOWN_QUEST_STATUSES = new Set([
  'revealed',
  'accepted',
  'active',
  'suspended',
  'completed',
  'failed',
  'expired',
  'abandoned',
  'withdrawn',
])

function fail(message: string): never {
  throw new Error(`[text-open-world-player-character] ${message}`)
}

function ratio(current: number, maximum: number): number {
  if (maximum === 0) return 0
  return Math.min(1, Math.max(0, current / maximum))
}

function displayNumber(value: number, percentage: boolean): string {
  if (!percentage) return String(value)
  return `${Math.round(value * 10_000) / 100}%`
}

/**
 * Disclosure-safe character-screen projection. Runtime facts come only from
 * the validated Session Projection; labels and definitions come only from its
 * frozen RuntimePackage. The returned DTO deliberately contains no content
 * keys, source references, formulas, Conditions or Effects.
 */
export function projectTextOpenWorldPlayerCharacterV1(
  value: TextOpenWorldSessionProjectionV1 | unknown,
): TextOpenWorldPlayerCharacterProjectionV1 {
  const projection = parseTextOpenWorldSessionProjectionV1(value)
  const modules = parseTextOpenWorldModulesV1(projection.runtimePackage)
  const contexts = deriveTextOpenWorldContextsV1(projection)
  const state = projection.state
  const playerDefinition = modules.actors.player
  const attributeLabels = modules.progression.rules.attributes
  const equippedTitleByKey = new Map(modules.items.items.map(item => [item.key, item.title]))

  const attributes = ATTRIBUTE_SEMANTICS.map(semantic => {
    const growthByLevel = modules.progression.levels
      .filter(level => level.level > playerDefinition.build.initialLevel && level.level <= state.player.level)
      .map(level => ({ level: level.level, value: level.attributeGrowth[semantic] }))
    return {
      semantic,
      label: attributeLabels[semantic].label,
      value: state.player.attributes[semantic],
      initialValue: playerDefinition.build.attributes[semantic],
      levelGrowth: growthByLevel.reduce((sum, entry) => sum + entry.value, 0),
      growthByLevel,
    }
  })
  const attributeLabelBySemantic = new Map(attributes.map(attribute => [
    attribute.semantic,
    attribute.label,
  ]))

  const derivedStats = DERIVED_STAT_SEMANTICS.map(semantic => {
    const breakdown = contexts.playerStats.breakdown[semantic]
    const percentage = semantic === 'criticalChance'
    return {
      semantic,
      label: DERIVED_STAT_LABELS[semantic],
      value: breakdown.value,
      displayValue: displayNumber(breakdown.value, percentage),
      sources: breakdown.components.map(component => {
        let label: string
        if (component.sourceKind === 'base') {
          label = BASE_SOURCE_LABELS[semantic] ?? '基础值'
        } else if (component.sourceKind === 'level') {
          label = `等级加成（Lv.${state.player.level}）`
        } else if (component.sourceKind === 'attribute') {
          label = attributeLabelBySemantic.get(component.sourceKey as TextOpenWorldPlayerAttributeSemanticV1)
            ?? fail('派生数值引用未知属性')
        } else {
          label = equippedTitleByKey.get(component.sourceKey) ?? fail('派生数值引用未知装备')
        }
        return {
          kind: component.sourceKind,
          label,
          value: component.value,
          displayValue: displayNumber(component.value, percentage),
        }
      }),
    }
  })

  const visibleQuestTitleByDefinitionKey = new Map<string, string>()
  Object.values(state.quests.instancesByKey).forEach(instance => {
    if (!KNOWN_QUEST_STATUSES.has(instance.status) || instance.offeredAtWorldMinute == null) return
    const definition = modules.quests.quests.find(quest => quest.key === instance.definitionKey)
      ?? fail('已揭示任务实例引用未知定义')
    const variantKey = definition.type === 'template' && instance.sourceKind === 'director'
      ? state.director.history.find(entry => entry.questInstanceKey === instance.instanceKey)?.variantTextKey ?? null
      : null
    const variant = variantKey == null
      ? null
      : modules.presentation.taskTextVariants.find(candidate => candidate.key === variantKey) ?? null
    visibleQuestTitleByDefinitionKey.set(definition.key, variant?.title ?? definition.title)
  })

  const conditionResults = contexts.action.conditionResults
  const skillCatalog = createTextOpenWorldSkillCatalogV1(projection.runtimePackage)
  const cooldownRemainingTurnsBySkillKey = contexts.action.combatSkillCooldownRemainingTurnsBySkillKey
  const skillProjections = skillCatalog.project({
    learnedSkillKeys: state.player.learnedSkillKeys,
    skillResource: state.player.skillResource,
    cooldownRemainingTurnsBySkillKey,
    conditionResults: Object.fromEntries(
      Object.entries(conditionResults).map(([conditionKey, result]) => [conditionKey, result.satisfied]),
    ),
  })
  const skills = skillProjections.map(skillProjection => {
    const skill = skillProjection.skill
    const publicConditionReasons = skillProjection.learned && skill.activation === 'active'
      ? skillProjection.unsatisfiedConditionKeys.map(conditionKey => (
          conditionResults[conditionKey]?.publicReason ?? '当前条件不满足。'
        ))
      : []
    const unavailableReasons = !skillProjection.learned
      ? ['尚未学会']
      : skill.activation === 'passive'
        ? []
        : [
            ...skillProjection.unavailableReasons
              .filter(reason => reason !== 'condition-unsatisfied' && reason !== 'passive' && reason !== 'not-learned')
              .map(reason => reason === 'resource-insufficient'
                ? `技能资源不足（需要 ${skill.resourceCost}）`
                : `冷却中（剩余 ${skillProjection.cooldownRemainingTurns} 回合）`),
            ...publicConditionReasons,
          ]
    const acquisition = skill.unlockSources.map(source => {
      if (source.kind === 'initial') {
        return {
          kind: source.kind,
          label: '初始可掌握',
          level: null,
          questTitle: null,
          discovered: true,
        }
      }
      if (source.kind === 'level') {
        return {
          kind: source.kind,
          label: `达到 ${source.level} 级可解锁`,
          level: source.level,
          questTitle: null,
          discovered: true,
        }
      }
      const questTitle = visibleQuestTitleByDefinitionKey.get(source.questKey!) ?? null
      return {
        kind: source.kind,
        label: questTitle
          ? `可能通过任务奖励获得：${questTitle}`
          : '尚未发现的任务奖励',
        level: null,
        questTitle,
        discovered: questTitle != null,
      }
    })
    const activationLabel = skill.activation === 'active' ? '主动技能' : '被动技能'
    const availabilityLabel = !skillProjection.learned
      ? '尚未学会'
      : skill.activation === 'passive'
        ? '已掌握的被动技能'
        : skillProjection.available
          ? '技能条件就绪'
          : '技能条件受限'
    return {
      title: skill.title,
      description: skill.description,
      tags: [...skill.tags],
      learned: skillProjection.learned,
      stateLabel: skillProjection.learned ? '已学会' : '未解锁',
      activationLabel,
      kindLabel: skill.kind === 'attack' ? '攻击' : skill.kind === 'status' ? '状态' : skill.kind === 'resource' ? '资源' : '恢复',
      targetLabel: skill.target === 'self' ? '自身' : skill.target === 'single-enemy' ? '单个敌人' : '所有敌人',
      scalingAttributeLabel: skill.scalingAttribute == null
        ? null
        : attributeLabelBySemantic.get(skill.scalingAttribute) ?? fail('技能引用未知成长属性'),
      resourceCost: skill.resourceCost,
      cooldownTurns: skill.cooldownTurns,
      cooldownRemainingTurns: skillProjection.learned && skill.activation === 'active'
        ? skillProjection.cooldownRemainingTurns
        : 0,
      // This deliberately does not claim that a combat Action is currently
      // executable; scene/combat turn legality remains owned by ActionRegistry.
      skillConditionsReady: skillProjection.available,
      availabilityLabel,
      unavailableReasons: [...new Set(unavailableReasons)],
      acquisition,
    }
  }) satisfies TextOpenWorldPlayerSkillV1[]

  const statuses = skillCatalog.projectStatuses(state.player.statusKeys)
    .filter(item => item.active)
    .map(({ status }) => ({
      title: status.title,
      description: status.description,
      polarityLabel: status.polarity === 'beneficial' ? '有益' : status.polarity === 'harmful' ? '有害' : '中性',
    })) satisfies TextOpenWorldPlayerStatusV1[]

  return {
    identity: {
      name: playerDefinition.identity.name,
      pronouns: playerDefinition.identity.pronouns,
      appearance: playerDefinition.identity.appearance,
      background: playerDefinition.identity.background,
      personality: playerDefinition.identity.personality,
      publicKnowledge: playerDefinition.identity.publicKnowledge,
      shortGoal: playerDefinition.identity.shortGoal,
      longGoal: playerDefinition.identity.longGoal,
    },
    progression: {
      initialLevel: playerDefinition.build.initialLevel,
      level: contexts.progression.level,
      maximumLevel: contexts.progression.maximumLevel,
      experience: contexts.progression.experience,
      experienceIntoLevel: contexts.progression.experienceIntoLevel,
      experienceForNextLevel: contexts.progression.experienceForNextLevel,
      progressRatio: contexts.progression.progressRatio,
      atMaximumLevel: contexts.progression.atMaximumLevel,
    },
    resources: {
      health: {
        label: '生命',
        current: state.player.health,
        maximum: contexts.playerStats.maximumHealth,
        progressRatio: ratio(state.player.health, contexts.playerStats.maximumHealth),
      },
      skillResource: {
        label: '技能资源',
        current: state.player.skillResource,
        maximum: contexts.playerStats.maximumSkillResource,
        progressRatio: ratio(state.player.skillResource, contexts.playerStats.maximumSkillResource),
      },
    },
    attributes,
    derivedStats,
    skills,
    statuses,
  }
}
