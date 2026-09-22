import { describe, expect, it } from 'vitest'
import { createTextOpenWorldCombatActionCatalogV1 } from '../../src/lib/open-world/combat-actions'
import { createTextOpenWorldCombatStateMachineV1 } from '../../src/lib/open-world/combat-state-machine'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import { createInitialTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import { createTextOpenWorldSkillCatalogV1 } from '../../src/lib/open-world/skills'
import type {
  TextOpenWorldEffectStateV1,
  TextOpenWorldRandomEvidenceV1,
  TextOpenWorldRuntimePackageV1,
} from '../../src/lib/types'
import { createTextOpenWorldVNextP9Fixture } from '../helpers/text-open-world-vnext-fixture'

type Attribute = 'power' | 'vitality' | 'agility'

function runtime(input: {
  actionVersion: 16 | 17
  cooldownTurns?: number
  scalingAttribute?: Attribute
  skillPower?: number
}): TextOpenWorldRuntimePackageV1 {
  const result = createTextOpenWorldVNextP9Fixture()
  const actions = result.modules.actions.payload as any
  const actors = result.modules.actors.payload as any
  const progression = result.modules.progression.payload as any
  const items = result.modules.items.payload as any
  const stagedAbandon = actions.actions.find((candidate: any) => candidate.key === 'action.abandon-supplies')
  const stagedBinding = actions.inputBindings.actions.find((candidate: any) => candidate.actionKey === stagedAbandon.key)
  actions.effects.push({
    key: 'effect.abandon-supplies-unstarted-v17-fixture',
    operation: 'transition-quest',
    payload: { questKey: 'quest.template.supplies', status: 'abandoned', stageKey: null },
  })
  actions.actions.push({
    ...structuredClone(stagedAbandon),
    key: 'action.abandon-supplies-unstarted-v17-fixture',
    successEffectKeys: ['effect.abandon-supplies-unstarted-v17-fixture'],
  })
  actions.inputBindings.actions.push({
    ...structuredClone(stagedBinding),
    key: 'binding.action.abandon-supplies-unstarted-v17-fixture',
    order: actions.inputBindings.actions.length + 1,
    actionKey: 'action.abandon-supplies-unstarted-v17-fixture',
    actionDefinitionHash: 'f'.repeat(64),
    resultAuthority: {
      ...structuredClone(stagedBinding.resultAuthority),
      actionKey: 'action.abandon-supplies-unstarted-v17-fixture',
      actionDefinitionHash: 'f'.repeat(64),
    },
    naturalLanguage: {
      ...structuredClone(stagedBinding.naturalLanguage),
      exampleUtterances: ['放弃尚未开始的物资任务', '不接这次物资委托'],
    },
  })
  actions.version = input.actionVersion
  result.modules.actions.schemaVersion = input.actionVersion
  if (input.actionVersion === 17) {
    progression.version = 2
    progression.skills = progression.skills.map((candidate: any) => {
      const { activation: _activation, kind, ...skill } = candidate
      if (kind !== 'attack') throw new Error(`Action v17测试夹具遇到未定义机制:${String(kind)}`)
      return { ...skill, mechanic: { kind: 'attack' } }
    })
    progression.statuses = progression.statuses.map((status: any) => ({
      ...status,
      duration: { clock: 'combat' },
      reapplyPolicy: 'reject',
      maxStacks: 1,
      modifiers: [],
    }))
    result.modules.progression.schemaVersion = 2
    const combat = result.modules.combat.payload as any
    combat.version = 4
    delete combat.transientPlayerStatusKeys
    result.modules.combat.schemaVersion = 4
  }
  actors.player.build.attributes = { power: 2, vitality: 4, agility: 6 }
  const skill = progression.skills.find((candidate: any) => candidate.key === 'skill.power-strike')
  skill.scalingAttribute = input.scalingAttribute ?? 'power'
  skill.cooldownTurns = input.cooldownTurns ?? 2
  const weapon = items.items.find((candidate: any) => candidate.key === 'item.rust-sword')
  weapon.statModifiers = { attack: 2, skillPower: input.skillPower ?? 4 }
  return result
}

function playerTurnState(runtimePackage: TextOpenWorldRuntimePackageV1): TextOpenWorldEffectStateV1 {
  const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
  const weaponInstance = Object.entries(projection.state.inventory.itemInstances)
    .find(([, instance]) => instance.itemKey === 'item.rust-sword')?.[0]
  if (!weaponInstance) throw new Error('测试武器实例缺失')
  projection.state.inventory.equippedItemInstanceIdBySlot.weapon = weaponInstance
  const machine = createTextOpenWorldCombatStateMachineV1(runtimePackage)
  projection.state.combat = machine.initialize({
    state: projection.state,
    encounterKey: 'encounter.ridge-jackal',
    instanceKey: 'combat.scaling-cooldown-v17',
  })
  for (const intent of ['begin-round', 'begin-turn'] as const) {
    projection.state.combat = machine.applyAuthorization({
      state: projection.state,
      authorization: machine.prepare({ state: projection.state, intent }),
    })
  }
  return projection.state
}

function evidenceFor(
  requests: ReturnType<ReturnType<typeof createTextOpenWorldCombatActionCatalogV1>['randomRequestsFor']>,
): TextOpenWorldRandomEvidenceV1[] {
  return requests.map((request, drawIndex) => ({
    ...request,
    algorithm: 'sha256-range-v1',
    seedHash: '1'.repeat(64),
    inputHash: '2'.repeat(64),
    drawIndex,
    value: request.maximumInclusive,
  }))
}

function prepareAttack(runtimePackage: TextOpenWorldRuntimePackageV1, state: TextOpenWorldEffectStateV1, actionKey = 'action.combat-power-strike') {
  const catalog = createTextOpenWorldCombatActionCatalogV1(runtimePackage)
  const input = {
    state,
    actionKey,
    targetKey: 'enemy.1.1',
    actorKey: 'player' as const,
    conditionResults: Object.fromEntries(parseTextOpenWorldModulesV1(runtimePackage).actions.conditions.map(condition => [condition.key, true])),
  }
  const evidence = evidenceFor(catalog.randomRequestsFor(input))
  return { catalog, evidence, authorization: catalog.prepare({ ...input, evidence }) }
}

describe('Text Open World vNext · Action v17 skill scaling and post-cast cooldown', () => {
  it.each([
    ['power', 2, 7],
    ['vitality', 4, 10],
    ['agility', 6, 13],
  ] as const)('玩家攻击技能按%s成长并只加一次装备skillPower', (scalingAttribute, scalingValue, expectedDamageBeforeDefense) => {
    const runtimePackage = runtime({ actionVersion: 17, scalingAttribute, skillPower: 4 })
    const state = playerTurnState(runtimePackage)
    const { authorization } = prepareAttack(runtimePackage, state)
    expect(authorization.targetResolutions).toEqual([
      expect.objectContaining({
        attack: scalingValue,
        powerNumerator: 3,
        powerDenominator: 2,
        flatDamage: 0,
        damageBeforeDefense: expectedDamageBeforeDefense,
      }),
    ])
  })

  it('普通攻击仍走attack且不读取skillPower，Action v16保持旧技能公式', () => {
    const modern = runtime({ actionVersion: 17, scalingAttribute: 'power', skillPower: 4 })
    const modernState = playerTurnState(modern)
    const basic = prepareAttack(modern, modernState, 'action.combat-basic-attack').authorization
    const scaled = prepareAttack(modern, modernState).authorization
    expect(basic.targetResolutions?.[0]).toMatchObject({ attack: 6, damageBeforeDefense: 6 })
    expect(scaled.targetResolutions?.[0]).toMatchObject({ attack: 2, damageBeforeDefense: 7 })

    const legacy = runtime({ actionVersion: 16, scalingAttribute: 'power', skillPower: 4 })
    const legacyState = playerTurnState(legacy)
    const prepared = prepareAttack(legacy, legacyState)
    expect(prepared.authorization).toMatchObject({
      cooldownTurns: 2,
      cooldownUntilRound: 3,
      targetResolutions: [expect.objectContaining({ attack: 6, damageBeforeDefense: 9 })],
    })
    expect(() => prepared.catalog.assertAuthorization({
      state: legacyState,
      authorization: prepared.authorization,
      evidence: prepared.evidence,
    })).not.toThrow()
  })

  it.each([
    { cooldownTurns: 1, readyRound: 3, boundary: [[2, 1, false], [3, 0, true]] },
    { cooldownTurns: 2, readyRound: 4, boundary: [[2, 2, false], [3, 1, false], [4, 0, true]] },
  ] as const)('冷却$cooldownTurns回合不含施放回合并在第$readyRound回合精确恢复', ({ cooldownTurns, readyRound, boundary }) => {
    const runtimePackage = runtime({ actionVersion: 17, cooldownTurns })
    const state = playerTurnState(runtimePackage)
    const prepared = prepareAttack(runtimePackage, state)
    expect(prepared.authorization).toMatchObject({ beforeRound: 1, cooldownTurns, cooldownUntilRound: readyRound })
    const combat = state.combat
    if (!combat || !('version' in combat) || !combat.cooldownUntilRoundBySkillKey) throw new Error('测试战斗投影缺失')
    combat.cooldownUntilRoundBySkillKey['skill.power-strike'] = prepared.authorization.cooldownUntilRound
    const skills = createTextOpenWorldSkillCatalogV1(runtimePackage)
    for (const [round, expectedRemaining, expectedAvailable] of boundary) {
      combat.round = round
      const remaining = prepared.catalog.remainingCooldowns(state)['skill.power-strike']
      const projection = skills.project({
        learnedSkillKeys: state.player.learnedSkillKeys,
        skillResource: state.player.skillResource,
        cooldownRemainingTurnsBySkillKey: { 'skill.power-strike': remaining },
        conditionResults: Object.fromEntries(parseTextOpenWorldModulesV1(runtimePackage).actions.conditions.map(condition => [condition.key, true])),
      }).find(candidate => candidate.skill.key === 'skill.power-strike')
      expect(remaining).toBe(expectedRemaining)
      expect(projection?.available).toBe(expectedAvailable)
      expect(projection?.unavailableReasons.includes('cooldown-active')).toBe(!expectedAvailable)
    }
  })

  it('Action v17拒绝无成长属性，并与Progression v2、Combat v4严格三联', () => {
    const missingScaling = runtime({ actionVersion: 17 })
    ;(missingScaling.modules.progression.payload as any).skills
      .find((skill: any) => skill.key === 'skill.power-strike').scalingAttribute = null
    expect(() => parseTextOpenWorldModulesV1(missingScaling)).toThrow('Action v17主动攻击技能必须声明scalingAttribute')

    const wrongCombatVersion = runtime({ actionVersion: 17 })
    ;(wrongCombatVersion.modules.combat.payload as any).version = 3
    ;(wrongCombatVersion.modules.combat.payload as any).transientPlayerStatusKeys = []
    wrongCombatVersion.modules.combat.schemaVersion = 3
    expect(() => parseTextOpenWorldModulesV1(wrongCombatVersion)).toThrow('Action v17、Progression v2与Combat v4必须严格三联发布')

    const wrongProgressionVersion = runtime({ actionVersion: 17 })
    const legacyProgression = wrongProgressionVersion.modules.progression.payload as any
    legacyProgression.version = 1
    legacyProgression.skills = legacyProgression.skills.map((skill: any) => {
      const { mechanic: _mechanic, ...fields } = skill
      return { ...fields, activation: 'active', kind: 'attack' }
    })
    legacyProgression.statuses = legacyProgression.statuses.map((status: any) => ({
      key: status.key,
      title: status.title,
      description: status.description,
      polarity: status.polarity,
    }))
    wrongProgressionVersion.modules.progression.schemaVersion = 1
    expect(() => parseTextOpenWorldModulesV1(wrongProgressionVersion)).toThrow('Action v17、Progression v2与Combat v4必须严格三联发布')

    const wrongActionVersion = runtime({ actionVersion: 17 })
    ;(wrongActionVersion.modules.actions.payload as any).version = 16
    wrongActionVersion.modules.actions.schemaVersion = 16
    expect(() => parseTextOpenWorldModulesV1(wrongActionVersion)).toThrow('Action v17、Progression v2与Combat v4必须严格三联发布')
  })
})
