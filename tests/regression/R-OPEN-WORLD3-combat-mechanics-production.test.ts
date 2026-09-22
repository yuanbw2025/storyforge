import { describe, expect, it } from 'vitest'
import {
  compileTextOpenWorldSkillMechanicV2,
  compileTextOpenWorldStatusDefinitionV2,
} from '../../src/lib/open-world/combat-mechanics-production'
import type { TextOpenWorldProgressionCatalogsV1 } from '../../src/lib/types'

type Skill = TextOpenWorldProgressionCatalogsV1['skills'][number]
type Status = TextOpenWorldProgressionCatalogsV1['statuses'][number]

function skill(input: Partial<Skill> & Pick<Skill, 'key' | 'activation' | 'kind' | 'target'>): Skill {
  return {
    order: 1,
    sourceDemandKey: `demand.${input.key}`,
    demandKind: 'level-progression',
    title: input.key,
    description: input.key,
    tags: [],
    scalingAttribute: null,
    unlockPlan: { kind: 'level', level: 2, requirementKey: null },
    priority: 100,
    resourceCost: input.activation === 'passive' ? 0 : 2,
    cooldownTurns: input.activation === 'passive' ? 0 : 1,
    combatResolutionPlan: {
      required: input.activation === 'active' && input.kind === 'attack',
      powerNumerator: input.activation === 'active' && input.kind === 'attack' ? 1 : null,
      powerDenominator: input.activation === 'active' && input.kind === 'attack' ? 1 : null,
      flatDamage: input.activation === 'active' && input.kind === 'attack' ? 0 : null,
    },
    fulfilledRequirementKeys: [],
    runtimeBinding: {
      status: 'runtime-unbound',
      useConditionKeys: [],
      effectKeys: [],
      actionKey: null,
      unlockQuestKey: null,
    },
    ...input,
  }
}

const statuses: Status[] = [
  { key: 'status.guard', order: 1, title: '守势', description: '提高防御。', polarity: 'beneficial' },
  { key: 'status.exposed', order: 2, title: '破绽', description: '降低防御。', polarity: 'harmful' },
  { key: 'status.focus', order: 3, title: '专注', description: '调整暴击。', polarity: 'neutral' },
]

describe('R-OPEN-WORLD3 · G4-09结构化战斗生产编译', () => {
  it('把四类主动语义和被动语义编译为可验证 mechanic', () => {
    expect(compileTextOpenWorldSkillMechanicV2({
      skill: skill({ key: 'skill.attack', activation: 'active', kind: 'attack', target: 'single-enemy' }),
      statuses,
    })).toEqual({ target: 'single-enemy', scalingAttribute: 'power', mechanic: { kind: 'attack' } })

    expect(compileTextOpenWorldSkillMechanicV2({
      skill: skill({ key: 'skill.heal', activation: 'active', kind: 'recovery', target: 'self' }),
      statuses,
    })).toEqual({
      target: 'self', scalingAttribute: 'vitality',
      mechanic: { kind: 'recovery', baseAmount: 5, scalingNumerator: 1, scalingDenominator: 2 },
    })

    expect(compileTextOpenWorldSkillMechanicV2({
      skill: skill({ key: 'skill.resource', activation: 'active', kind: 'resource', target: 'self' }),
      statuses,
    })).toEqual({
      target: 'self', scalingAttribute: 'agility',
      mechanic: { kind: 'resource', baseAmount: 3, scalingNumerator: 1, scalingDenominator: 2 },
    })

    expect(compileTextOpenWorldSkillMechanicV2({
      skill: skill({ key: 'skill.hex', activation: 'active', kind: 'status', target: 'all-enemies' }),
      statuses,
    })).toEqual({
      target: 'all-enemies', scalingAttribute: null,
      mechanic: { kind: 'status', statusKey: 'status.exposed' },
    })

    expect(compileTextOpenWorldSkillMechanicV2({
      skill: skill({ key: 'skill.passive', activation: 'passive', kind: 'resource', target: 'self' }),
      statuses,
    })).toEqual({
      target: 'self', scalingAttribute: null,
      mechanic: {
        kind: 'passive-static',
        modifiers: [{ stat: 'skillPower', operation: 'add-flat', amount: 2 }],
      },
    })
  })

  it('为状态冻结目标回合、重施策略、叠层上限和数值修正', () => {
    expect(statuses.map(compileTextOpenWorldStatusDefinitionV2)).toEqual([
      expect.objectContaining({
        key: 'status.guard', duration: { clock: 'target-turns', turns: 2 },
        reapplyPolicy: 'reject', maxStacks: 1,
        modifiers: [{ stat: 'defense', operation: 'add-flat', amount: 1 }],
      }),
      expect.objectContaining({
        key: 'status.exposed', reapplyPolicy: 'refresh', maxStacks: 1,
        modifiers: [{ stat: 'defense', operation: 'add-flat', amount: -2 }],
      }),
      expect.objectContaining({
        key: 'status.focus', reapplyPolicy: 'stack', maxStacks: 3,
        modifiers: [{ stat: 'criticalChanceBasisPoints', operation: 'add-flat', amount: 100 }],
      }),
    ])
  })

  it('拒绝不能由首版运行时兑现的恢复目标与非法被动合同', () => {
    expect(() => compileTextOpenWorldSkillMechanicV2({
      skill: skill({ key: 'skill.bad-heal', activation: 'active', kind: 'recovery', target: 'single-enemy' }),
      statuses,
    })).toThrow(/恢复或资源技能只能以自身为目标/)
    expect(() => compileTextOpenWorldSkillMechanicV2({
      skill: skill({
        key: 'skill.bad-passive', activation: 'passive', kind: 'attack', target: 'single-enemy',
      }),
      statuses,
    })).toThrow(/被动技能合同无效/)
  })
})
