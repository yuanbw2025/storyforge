import type {
  TextOpenWorldProgressionModuleV1,
  TextOpenWorldRuntimePackageV1,
} from '../types'
import { parseTextOpenWorldModulesV1 } from './modules'

type Skill = TextOpenWorldProgressionModuleV1['skills'][number]
type Status = TextOpenWorldProgressionModuleV1['statuses'][number]

export type TextOpenWorldSkillUnavailableReasonV1 =
  | 'not-learned' | 'passive' | 'resource-insufficient' | 'cooldown-active' | 'condition-unsatisfied'

export interface TextOpenWorldSkillProjectionV1 {
  skill: Skill
  learned: boolean
  available: boolean
  unavailableReasons: TextOpenWorldSkillUnavailableReasonV1[]
  cooldownRemainingTurns: number
  unsatisfiedConditionKeys: string[]
}

export interface TextOpenWorldPreparedSkillUseV1 {
  skillKey: string
  target: Skill['target']
  scalingAttribute: Skill['scalingAttribute']
  resourceCost: number
  cooldownTurns: number
  effectKeys: string[]
}

function fail(message: string): never { throw new Error(`[text-open-world-skills] ${message}`) }
function clone<T>(value: T): T { return structuredClone(value) }

export function createTextOpenWorldSkillCatalogV1(runtimePackage: TextOpenWorldRuntimePackageV1 | string | unknown) {
  const modules = parseTextOpenWorldModulesV1(runtimePackage)
  const skills = modules.progression.skills
  const statuses = modules.progression.statuses
  const skillByKey = new Map(skills.map(skill => [skill.key, skill]))
  const statusByKey = new Map(statuses.map(status => [status.key, status]))

  const project = (input: {
    learnedSkillKeys: string[]
    skillResource: number
    cooldownRemainingTurnsBySkillKey?: Record<string, number>
    conditionResults?: Record<string, boolean>
  }): TextOpenWorldSkillProjectionV1[] => {
    if (!Array.isArray(input.learnedSkillKeys) || new Set(input.learnedSkillKeys).size !== input.learnedSkillKeys.length) fail('learnedSkillKeys必须是无重复数组')
    input.learnedSkillKeys.forEach(key => { if (!skillByKey.has(key)) fail(`已学技能不存在:${key}`) })
    if (typeof input.skillResource !== 'number' || !Number.isFinite(input.skillResource) || input.skillResource < 0) fail('skillResource无效')
    const cooldowns = input.cooldownRemainingTurnsBySkillKey ?? {}
    for (const [key, value] of Object.entries(cooldowns)) {
      if (!skillByKey.has(key)) fail(`冷却引用未知技能:${key}`)
      if (!Number.isSafeInteger(value) || value < 0) fail(`技能冷却无效:${key}`)
    }
    const conditions = input.conditionResults ?? {}
    return skills.map(skill => {
      const learned = input.learnedSkillKeys.includes(skill.key)
      const cooldownRemainingTurns = cooldowns[skill.key] ?? 0
      const unsatisfiedConditionKeys = skill.useConditionKeys.filter(key => conditions[key] !== true)
      const unavailableReasons: TextOpenWorldSkillUnavailableReasonV1[] = []
      if (!learned) unavailableReasons.push('not-learned')
      if (skill.activation === 'passive') unavailableReasons.push('passive')
      if (input.skillResource < skill.resourceCost) unavailableReasons.push('resource-insufficient')
      if (cooldownRemainingTurns > 0) unavailableReasons.push('cooldown-active')
      if (unsatisfiedConditionKeys.length) unavailableReasons.push('condition-unsatisfied')
      return {
        skill: clone(skill), learned, available: unavailableReasons.length === 0,
        unavailableReasons, cooldownRemainingTurns, unsatisfiedConditionKeys,
      }
    })
  }

  const prepare = (input: Parameters<typeof project>[0] & { skillKey: string }): TextOpenWorldPreparedSkillUseV1 => {
    const projection = project(input).find(item => item.skill.key === input.skillKey) ?? fail(`技能不存在:${input.skillKey}`)
    if (!projection.available) fail(`技能当前不可用:${projection.unavailableReasons.join(',')}`)
    return {
      skillKey: projection.skill.key, target: projection.skill.target, scalingAttribute: projection.skill.scalingAttribute,
      resourceCost: projection.skill.resourceCost, cooldownTurns: projection.skill.cooldownTurns,
      effectKeys: [...projection.skill.effectKeys],
    }
  }

  const projectStatuses = (activeStatusKeys: string[]): Array<{ status: Status; active: boolean }> => {
    if (!Array.isArray(activeStatusKeys) || new Set(activeStatusKeys).size !== activeStatusKeys.length) fail('activeStatusKeys必须是无重复数组')
    activeStatusKeys.forEach(key => { if (!statusByKey.has(key)) fail(`状态不存在:${key}`) })
    return statuses.map(status => ({ status: clone(status), active: activeStatusKeys.includes(status.key) }))
  }

  return {
    list: (): Skill[] => clone(skills),
    get: (skillKey: string): Skill | null => skillByKey.has(skillKey) ? clone(skillByKey.get(skillKey)!) : null,
    project,
    prepare,
    listStatuses: (): Status[] => clone(statuses),
    projectStatuses,
  }
}
