import type { TextOpenWorldCombatStatModifierV2 } from '../types/text-open-world-effect'
import type {
  TextOpenWorldProgressionSkillMechanicV2,
  TextOpenWorldProgressionStatusDefinitionV2,
} from '../types/text-open-world-modules'
import type { TextOpenWorldProgressionCatalogsV1 } from '../types/text-open-world-production'

type CatalogSkill = TextOpenWorldProgressionCatalogsV1['skills'][number]
type CatalogStatus = TextOpenWorldProgressionCatalogsV1['statuses'][number]

function fail(message: string): never {
  throw new Error(`[text-open-world-combat-mechanics-production] ${message}`)
}

function passiveModifier(skill: CatalogSkill): TextOpenWorldCombatStatModifierV2 {
  if (skill.kind === 'attack') {
    return { stat: 'attack', operation: 'add-flat', amount: 2 }
  }
  if (skill.kind === 'recovery') {
    return { stat: 'defense', operation: 'add-flat', amount: 2 }
  }
  if (skill.kind === 'resource') {
    return { stat: 'skillPower', operation: 'add-flat', amount: 2 }
  }
  return { stat: 'criticalChanceBasisPoints', operation: 'add-flat', amount: 250 }
}

function statusCandidates(
  skill: CatalogSkill,
  statuses: readonly CatalogStatus[],
): CatalogStatus[] {
  const preferredPolarity = skill.target === 'self' ? 'beneficial' : 'harmful'
  const preferred = statuses.filter(status => status.polarity === preferredPolarity)
  if (preferred.length) return preferred
  const neutral = statuses.filter(status => status.polarity === 'neutral')
  return neutral.length ? neutral : [...statuses]
}

/**
 * P8 keeps authored semantics separate from executable rules. This compiler is
 * the deterministic bridge used only by the governed Action v17 production
 * contract; historical v15/v16 packages keep their frozen v1 interpretation.
 */
export function compileTextOpenWorldSkillMechanicV2(input: {
  skill: CatalogSkill
  statuses: readonly CatalogStatus[]
}): {
  target: CatalogSkill['target']
  scalingAttribute: CatalogSkill['scalingAttribute']
  mechanic: TextOpenWorldProgressionSkillMechanicV2
} {
  const { skill, statuses } = input
  if (skill.activation === 'passive') {
    if (skill.target !== 'self' || skill.resourceCost !== 0 || skill.cooldownTurns !== 0) {
      fail(`被动技能合同无效:${skill.key}`)
    }
    return {
      target: 'self',
      scalingAttribute: null,
      mechanic: { kind: 'passive-static', modifiers: [passiveModifier(skill)] },
    }
  }

  if (skill.kind === 'attack') {
    if (skill.target === 'self') fail(`攻击技能不能以自身为目标:${skill.key}`)
    return {
      target: skill.target,
      scalingAttribute: skill.scalingAttribute ?? 'power',
      mechanic: { kind: 'attack' },
    }
  }

  if (skill.kind === 'recovery' || skill.kind === 'resource') {
    if (skill.target !== 'self') fail(`恢复或资源技能只能以自身为目标:${skill.key}`)
    return {
      target: 'self',
      scalingAttribute: skill.scalingAttribute ?? (skill.kind === 'recovery' ? 'vitality' : 'agility'),
      mechanic: skill.kind === 'recovery'
        ? { kind: 'recovery', baseAmount: 5, scalingNumerator: 1, scalingDenominator: 2 }
        : { kind: 'resource', baseAmount: 3, scalingNumerator: 1, scalingDenominator: 2 },
    }
  }

  if (!statuses.length) fail(`状态技能缺少状态目录:${skill.key}`)
  const candidates = statusCandidates(skill, statuses)
  const status = candidates[(Math.max(1, skill.order) - 1) % candidates.length]
    ?? fail(`状态技能无法绑定状态:${skill.key}`)
  return {
    target: skill.target,
    scalingAttribute: null,
    mechanic: { kind: 'status', statusKey: status.key },
  }
}

export function compileTextOpenWorldStatusDefinitionV2(
  status: CatalogStatus,
): TextOpenWorldProgressionStatusDefinitionV2 {
  const magnitude = 1 + ((Math.max(1, status.order) - 1) % 2)
  const modifiers: TextOpenWorldCombatStatModifierV2[] = status.polarity === 'beneficial'
    ? [{ stat: 'defense', operation: 'add-flat', amount: magnitude }]
    : status.polarity === 'harmful'
      ? [{ stat: 'defense', operation: 'add-flat', amount: -magnitude }]
      : [{ stat: 'criticalChanceBasisPoints', operation: 'add-flat', amount: magnitude * 100 }]
  const policyIndex = (Math.max(1, status.order) - 1) % 3
  const reapplyPolicy = policyIndex === 0 ? 'reject' as const
    : policyIndex === 1 ? 'refresh' as const : 'stack' as const
  return {
    key: status.key,
    title: status.title,
    description: status.description,
    polarity: status.polarity,
    duration: { clock: 'target-turns', turns: 2 },
    reapplyPolicy,
    maxStacks: reapplyPolicy === 'stack' ? 3 : 1,
    modifiers,
  }
}
