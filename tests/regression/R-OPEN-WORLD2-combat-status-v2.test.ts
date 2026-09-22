import { describe, expect, it } from 'vitest'
import {
  applyTextOpenWorldCombatStatusV2,
  beginTextOpenWorldCombatantTurnV2,
  clearTextOpenWorldCombatStatusesAtTerminalV2,
  deriveTextOpenWorldCombatStatusModifiersV2,
  deriveTextOpenWorldPassiveStaticModifiersV2,
  settleTextOpenWorldCombatStatusesAfterTurnV2,
  validateTextOpenWorldCombatStatusStateV2,
} from '../../src/lib/open-world/combat-status'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import type {
  TextOpenWorldCombatRuntimeStateV2,
  TextOpenWorldProgressionModuleV2,
  TextOpenWorldRuntimePackageV1,
} from '../../src/lib/types'
import { createTextOpenWorldVNextP9Fixture } from '../helpers/text-open-world-vnext-fixture'

function progression(): TextOpenWorldProgressionModuleV2 {
  const common = {
    title: '测试技能', description: '确定性状态服务测试。', tags: ['测试'], target: 'self' as const,
    scalingAttribute: null, unlockSources: [{ kind: 'initial' as const, level: null, questKey: null }],
    useConditionKeys: [], priority: 1, resourceCost: 0, cooldownTurns: 0, effectKeys: [],
  }
  return {
    version: 2,
    sourceVersion: 2,
    rules: {} as TextOpenWorldProgressionModuleV2['rules'],
    levels: [],
    skills: [
      { ...common, key: 'skill.reject', mechanic: { kind: 'status', statusKey: 'status.reject' }, activation: 'active', kind: 'status' },
      { ...common, key: 'skill.refresh', mechanic: { kind: 'status', statusKey: 'status.refresh' }, activation: 'active', kind: 'status' },
      { ...common, key: 'skill.stack', mechanic: { kind: 'status', statusKey: 'status.stack' }, activation: 'active', kind: 'status' },
      { ...common, key: 'skill.two-turn', mechanic: { kind: 'status', statusKey: 'status.two-turn' }, activation: 'active', kind: 'status' },
      { ...common, key: 'skill.combat', mechanic: { kind: 'status', statusKey: 'status.combat' }, activation: 'active', kind: 'status' },
      {
        ...common, key: 'skill.passive', mechanic: { kind: 'passive-static', modifiers: [
          { stat: 'defense', operation: 'add-flat', amount: 3 },
          { stat: 'skillPower', operation: 'add-flat', amount: 4 },
        ] }, activation: 'passive', kind: 'status',
      },
    ],
    statuses: [
      {
        key: 'status.reject', title: '拒绝覆盖', description: '持续一回合。', polarity: 'beneficial',
        duration: { clock: 'target-turns', turns: 1 }, reapplyPolicy: 'reject', maxStacks: 1,
        modifiers: [{ stat: 'attack', operation: 'add-flat', amount: 2 }],
      },
      {
        key: 'status.refresh', title: '刷新', description: '持续一回合。', polarity: 'beneficial',
        duration: { clock: 'target-turns', turns: 1 }, reapplyPolicy: 'refresh', maxStacks: 1, modifiers: [],
      },
      {
        key: 'status.stack', title: '叠层', description: '最多两层。', polarity: 'beneficial',
        duration: { clock: 'target-turns', turns: 2 }, reapplyPolicy: 'stack', maxStacks: 2,
        modifiers: [
          { stat: 'attack', operation: 'add-flat', amount: 2 },
          { stat: 'criticalChanceBasisPoints', operation: 'add-flat', amount: 125 },
        ],
      },
      {
        key: 'status.two-turn', title: '两回合', description: '持续两个目标回合。', polarity: 'harmful',
        duration: { clock: 'target-turns', turns: 2 }, reapplyPolicy: 'reject', maxStacks: 1, modifiers: [],
      },
      {
        key: 'status.combat', title: '整场', description: '持续到战斗终态。', polarity: 'neutral',
        duration: { clock: 'combat' }, reapplyPolicy: 'reject', maxStacks: 1, modifiers: [],
      },
    ],
  } as TextOpenWorldProgressionModuleV2
}

function combat(): TextOpenWorldCombatRuntimeStateV2 {
  return {
    version: 2,
    instanceKey: 'combat.status-v2', encounterKey: 'encounter.test', status: 'active', phase: 'actor-turn',
    round: 1, turnIndex: 0, activeCombatantKey: 'player', playerInitiative: 5,
    turnOrder: ['player', 'enemy.1'], cooldownUntilRoundBySkillKey: {}, lastAction: null,
    enemies: [{
      combatantKey: 'enemy.1', groupKey: 'group.1', enemyKey: 'enemy.test', currentHealth: 10,
      maximumHealth: 10, initiative: 3, defeated: false, cooldownUntilRoundBySkillKey: {},
    }],
    actorTurnOrdinalByCombatantKey: { player: 0, 'enemy.1': 0 },
    statusInstancesByCombatantKey: { player: [], 'enemy.1': [] },
  }
}

function apply(input: {
  combat: TextOpenWorldCombatRuntimeStateV2
  progression: TextOpenWorldProgressionModuleV2
  skillKey: string
  target?: string
}) {
  return applyTextOpenWorldCombatStatusV2({
    combat: input.combat,
    progression: input.progression,
    targetCombatantKey: input.target ?? 'player',
    sourceCombatantKey: 'player',
    sourceSkillKey: input.skillKey,
  })
}

function actionV17Fixture(): TextOpenWorldRuntimePackageV1 {
  const runtimePackage = createTextOpenWorldVNextP9Fixture()
  const actions = runtimePackage.modules.actions.payload as any
  const stagedAbandon = actions.actions.find((candidate: any) => candidate.key === 'action.abandon-supplies')
  const stagedBinding = actions.inputBindings.actions.find((candidate: any) => candidate.actionKey === stagedAbandon.key)
  actions.effects.push({
    key: 'effect.abandon-supplies-unstarted-status-v2', operation: 'transition-quest',
    payload: { questKey: 'quest.template.supplies', status: 'abandoned', stageKey: null },
  })
  actions.actions.push({
    ...structuredClone(stagedAbandon), key: 'action.abandon-supplies-unstarted-status-v2',
    successEffectKeys: ['effect.abandon-supplies-unstarted-status-v2'],
  })
  actions.inputBindings.actions.push({
    ...structuredClone(stagedBinding), key: 'binding.action.abandon-supplies-unstarted-status-v2',
    order: actions.inputBindings.actions.length + 1, actionKey: 'action.abandon-supplies-unstarted-status-v2',
    actionDefinitionHash: 'e'.repeat(64),
    resultAuthority: {
      ...structuredClone(stagedBinding.resultAuthority), actionKey: 'action.abandon-supplies-unstarted-status-v2',
      actionDefinitionHash: 'e'.repeat(64),
    },
    naturalLanguage: {
      ...structuredClone(stagedBinding.naturalLanguage), exampleUtterances: ['放弃未开始的状态测试任务', '不接状态测试任务'],
    },
  })
  actions.version = 17
  runtimePackage.modules.actions.schemaVersion = 17
  return runtimePackage
}

function structuredRelease(): TextOpenWorldRuntimePackageV1 {
  const runtimePackage = actionV17Fixture()
  const progressionModule = runtimePackage.modules.progression.payload as any
  progressionModule.version = 2
  progressionModule.skills = progressionModule.skills.map((skill: any) => {
    const { activation: _activation, kind, ...fields } = skill
    if (kind !== 'attack') throw new Error(`Progression v2测试夹具遇到未定义机制:${String(kind)}`)
    return { ...fields, mechanic: { kind } }
  })
  progressionModule.skills.push({
    key: 'skill.static-guard', title: '稳固架势', description: '永久提供少量防御。', tags: ['被动'],
    mechanic: { kind: 'passive-static', modifiers: [{ stat: 'defense', operation: 'add-flat', amount: 1 }] },
    target: 'self', scalingAttribute: null,
    unlockSources: [{ kind: 'initial', level: null, questKey: null }], useConditionKeys: [], priority: 10,
    resourceCost: 0, cooldownTurns: 0, effectKeys: [],
  })
  progressionModule.levels[0].unlockedSkillKeys.push('skill.static-guard')
  ;(runtimePackage.modules.actors.payload as any).player.build.learnedSkillKeys.push('skill.static-guard')
  progressionModule.statuses = progressionModule.statuses.map((status: any) => ({
    ...status, duration: { clock: 'combat' }, reapplyPolicy: 'reject', maxStacks: 1, modifiers: [],
  }))
  runtimePackage.modules.progression.schemaVersion = 2
  const combatModule = runtimePackage.modules.combat.payload as any
  combatModule.version = 4
  delete combatModule.transientPlayerStatusKeys
  runtimePackage.modules.combat.schemaVersion = 4
  return runtimePackage
}

describe('Text Open World · Progression v2 / Combat v4 status contract', () => {
  it('施加并分别执行reject、refresh、stack与maxStacks', () => {
    const definitions = progression()
    const first = apply({ combat: combat(), progression: definitions, skillKey: 'skill.reject' })
    expect(first.outcome).toBe('applied')
    expect(first.combat.statusInstancesByCombatantKey.player[0]).toMatchObject({
      statusKey: 'status.reject', stacks: 1,
      appliedAtActorTurnOrdinal: 0, expiresAfterTargetTurnOrdinal: 1,
    })
    const rejected = apply({ combat: first.combat, progression: definitions, skillKey: 'skill.reject' })
    expect(rejected.outcome).toBe('rejected')
    expect(rejected.combat).toEqual(first.combat)

    const refreshFirst = apply({ combat: combat(), progression: definitions, skillKey: 'skill.refresh' })
    const begun = beginTextOpenWorldCombatantTurnV2({ combat: refreshFirst.combat, progression: definitions, combatantKey: 'player' })
    const refreshed = apply({ combat: begun, progression: definitions, skillKey: 'skill.refresh' })
    expect(refreshed.outcome).toBe('refreshed')
    expect(refreshed.combat.statusInstancesByCombatantKey.player[0]).toMatchObject({
      stacks: 1, appliedAtActorTurnOrdinal: 1, expiresAfterTargetTurnOrdinal: 2,
    })

    const stacked1 = apply({ combat: combat(), progression: definitions, skillKey: 'skill.stack' })
    const stacked2 = apply({ combat: stacked1.combat, progression: definitions, skillKey: 'skill.stack' })
    const begunAtMaximum = beginTextOpenWorldCombatantTurnV2({
      combat: stacked2.combat, progression: definitions, combatantKey: 'player',
    })
    const capped = apply({ combat: begunAtMaximum, progression: definitions, skillKey: 'skill.stack' })
    expect([stacked1.outcome, stacked2.outcome, capped.outcome]).toEqual(['applied', 'stacked', 'max-stacks'])
    expect(capped.combat.statusInstancesByCombatantKey.player[0]).toMatchObject({
      stacks: 2, appliedAtActorTurnOrdinal: 0, expiresAfterTargetTurnOrdinal: 2,
    })
    expect(stacked1.combat.statusInstancesByCombatantKey.player[0].stacks).toBe(1)
    expect(stacked2.combat.statusInstancesByCombatantKey.player[0].stacks).toBe(2)
  })

  it('duration=1不在施加当回合误减，并在目标下一个完整行动后到期', () => {
    const definitions = progression()
    const begun = beginTextOpenWorldCombatantTurnV2({ combat: combat(), progression: definitions, combatantKey: 'player' })
    const applied = apply({ combat: begun, progression: definitions, skillKey: 'skill.reject' })
    const sameTurn = settleTextOpenWorldCombatStatusesAfterTurnV2({ combat: applied.combat, progression: definitions, combatantKey: 'player' })
    expect(sameTurn.expiredStatusKeys).toEqual([])
    const nextTurn = beginTextOpenWorldCombatantTurnV2({ combat: sameTurn.combat, progression: definitions, combatantKey: 'player' })
    const expired = settleTextOpenWorldCombatStatusesAfterTurnV2({ combat: nextTurn, progression: definitions, combatantKey: 'player' })
    expect(expired.expiredStatusKeys).toEqual(['status.reject'])
  })

  it('duration=2只计目标的两个完整行动，不被其他战斗员回合消耗', () => {
    const definitions = progression()
    const applied = apply({ combat: combat(), progression: definitions, skillKey: 'skill.two-turn' })
    const enemyBegin = beginTextOpenWorldCombatantTurnV2({ combat: applied.combat, progression: definitions, combatantKey: 'enemy.1' })
    const enemyEnd = settleTextOpenWorldCombatStatusesAfterTurnV2({ combat: enemyBegin, progression: definitions, combatantKey: 'enemy.1' })
    expect(enemyEnd.expiredStatusKeys).toEqual([])
    expect(enemyEnd.combat.statusInstancesByCombatantKey.player[0].expiresAfterTargetTurnOrdinal).toBe(2)
    const firstBegin = beginTextOpenWorldCombatantTurnV2({ combat: enemyEnd.combat, progression: definitions, combatantKey: 'player' })
    const firstEnd = settleTextOpenWorldCombatStatusesAfterTurnV2({ combat: firstBegin, progression: definitions, combatantKey: 'player' })
    expect(firstEnd.expiredStatusKeys).toEqual([])
    const secondBegin = beginTextOpenWorldCombatantTurnV2({ combat: firstEnd.combat, progression: definitions, combatantKey: 'player' })
    const secondEnd = settleTextOpenWorldCombatStatusesAfterTurnV2({ combat: secondBegin, progression: definitions, combatantKey: 'player' })
    expect(secondEnd.expiredStatusKeys).toEqual(['status.two-turn'])
  })

  it('按叠层汇总状态修正，并独立汇总passive-static修正', () => {
    const definitions = progression()
    const first = apply({ combat: combat(), progression: definitions, skillKey: 'skill.stack' })
    const second = apply({ combat: first.combat, progression: definitions, skillKey: 'skill.stack' })
    expect(deriveTextOpenWorldCombatStatusModifiersV2({
      combat: second.combat, progression: definitions, combatantKey: 'player',
    })).toEqual({ attack: 4, defense: 0, skillPower: 0, criticalChanceBasisPoints: 250 })
    expect(deriveTextOpenWorldPassiveStaticModifiersV2({
      progression: definitions, learnedSkillKeys: ['skill.passive', 'skill.reject'],
    })).toEqual({ attack: 0, defense: 3, skillPower: 4, criticalChanceBasisPoints: 0 })
  })

  it('combat duration只在终态统一清空', () => {
    const definitions = progression()
    const applied = apply({ combat: combat(), progression: definitions, skillKey: 'skill.combat' })
    const begun = beginTextOpenWorldCombatantTurnV2({ combat: applied.combat, progression: definitions, combatantKey: 'player' })
    const settled = settleTextOpenWorldCombatStatusesAfterTurnV2({ combat: begun, progression: definitions, combatantKey: 'player' })
    expect(settled.combat.statusInstancesByCombatantKey.player).toHaveLength(1)
    expect(() => clearTextOpenWorldCombatStatusesAtTerminalV2({ combat: settled.combat, progression: definitions })).toThrow('只能在战斗终态清空状态')
    const terminal = { ...settled.combat, status: 'victory' as const, phase: 'terminal' as const }
    expect(clearTextOpenWorldCombatStatusesAtTerminalV2({ combat: terminal, progression: definitions }).statusInstancesByCombatantKey)
      .toEqual({ player: [], 'enemy.1': [] })
  })

  it('拒绝未知来源、重复实例、非法叠层、错误到期点与不完整映射', () => {
    const definitions = progression()
    expect(() => apply({ combat: combat(), progression: definitions, skillKey: 'skill.unknown' })).toThrow('技能不是状态技能')
    expect(() => apply({ combat: combat(), progression: definitions, skillKey: 'skill.reject', target: 'enemy.unknown' })).toThrow('目标战斗员不存在')

    const duplicate = apply({ combat: combat(), progression: definitions, skillKey: 'skill.reject' }).combat
    duplicate.statusInstancesByCombatantKey.player.push(structuredClone(duplicate.statusInstancesByCombatantKey.player[0]))
    expect(() => validateTextOpenWorldCombatStatusStateV2({ combat: duplicate, progression: definitions })).toThrow('同一状态只能有一个实例')
    const invalidStacks = combat()
    invalidStacks.statusInstancesByCombatantKey.player.push({
      statusKey: 'status.stack', sourceCombatantKey: 'player', sourceSkillKey: 'skill.stack', stacks: 3,
      appliedAtActorTurnOrdinal: 0, expiresAfterTargetTurnOrdinal: 2,
    })
    expect(() => validateTextOpenWorldCombatStatusStateV2({ combat: invalidStacks, progression: definitions })).toThrow('状态叠层越界')
    const wrongExpiry = combat()
    wrongExpiry.statusInstancesByCombatantKey.player.push({
      statusKey: 'status.reject', sourceCombatantKey: 'player', sourceSkillKey: 'skill.reject', stacks: 1,
      appliedAtActorTurnOrdinal: 0, expiresAfterTargetTurnOrdinal: 2,
    })
    expect(() => validateTextOpenWorldCombatStatusStateV2({ combat: wrongExpiry, progression: definitions })).toThrow('状态到期点与定义不一致')
    const incomplete = combat()
    delete incomplete.statusInstancesByCombatantKey['enemy.1']
    expect(() => validateTextOpenWorldCombatStatusStateV2({ combat: incomplete, progression: definitions })).toThrow('必须完整覆盖turnOrder')

    const malformed = combat()
    ;(malformed.statusInstancesByCombatantKey.player as unknown[]).push(null)
    expect(() => validateTextOpenWorldCombatStatusStateV2({ combat: malformed, progression: definitions })).toThrow('状态实例必须是对象')
  })

  it('解析Action v17 + Progression v2 + Combat v4严格三联并保留旧Release', () => {
    const modern = parseTextOpenWorldModulesV1(structuredRelease())
    expect(modern.progression).toMatchObject({ version: 2, sourceVersion: 2 })
    expect(modern.combat).toMatchObject({ version: 4, sourceVersion: 4, transientPlayerStatusKeys: [] })
    expect(modern.progression.skills.find(skill => skill.key === 'skill.static-guard')).toMatchObject({
      activation: 'passive', kind: 'status', mechanic: { kind: 'passive-static' },
    })

    const legacy = parseTextOpenWorldModulesV1(createTextOpenWorldVNextP9Fixture())
    expect(legacy.progression.version).toBe(1)
    expect(legacy.combat).toMatchObject({ version: 3, sourceVersion: 3 })

    const wrongCombat = structuredRelease()
    ;(wrongCombat.modules.combat.payload as any).version = 3
    ;(wrongCombat.modules.combat.payload as any).transientPlayerStatusKeys = []
    wrongCombat.modules.combat.schemaVersion = 3
    expect(() => parseTextOpenWorldModulesV1(wrongCombat)).toThrow('Action v17、Progression v2与Combat v4必须严格三联发布')
  })

  it('拒绝非法状态定义与重复属性修正', () => {
    const invalidStackPolicy = structuredRelease()
    const status = (invalidStackPolicy.modules.progression.payload as any).statuses[0]
    status.maxStacks = 2
    expect(() => parseTextOpenWorldModulesV1(invalidStackPolicy)).toThrow('只有stack策略可以声明多层')

    const duplicateModifier = structuredRelease()
    ;(duplicateModifier.modules.progression.payload as any).statuses[0].modifiers = [
      { stat: 'attack', operation: 'add-flat', amount: 1 },
      { stat: 'attack', operation: 'add-flat', amount: 2 },
    ]
    expect(() => parseTextOpenWorldModulesV1(duplicateModifier)).toThrow('同一属性只能声明一个修正')
  })
})
