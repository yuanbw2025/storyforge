import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createTextOpenWorldActionRegistryV1 } from '../../src/lib/open-world/action-registry'
import { executeTextOpenWorldActionV1 } from '../../src/lib/open-world/action-executor'
import { createTextOpenWorldCombatActionCatalogV1 } from '../../src/lib/open-world/combat-actions'
import { createTextOpenWorldCombatStateMachineV1 } from '../../src/lib/open-world/combat-state-machine'
import { beginTextOpenWorldCombatantTurnV2 } from '../../src/lib/open-world/combat-status'
import { createTextOpenWorldEffectCatalogV1 } from '../../src/lib/open-world/effect-dsl'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import { projectTextOpenWorldPlayerCombatV1 } from '../../src/lib/open-world/player-combat'
import {
  createInitialTextOpenWorldSessionProjectionV1,
  deriveTextOpenWorldContextsV1,
} from '../../src/lib/open-world/session-projection'
import { readProductRuntimeState, replayProductRuntimeEvents } from '../../src/lib/product/runtime-core'
import type {
  ProductRuntimeEvent,
  TextOpenWorldCombatRuntimeStateV2,
  TextOpenWorldEffectStateV1,
  TextOpenWorldRandomEvidenceV1,
  TextOpenWorldRuntimePackageV1,
} from '../../src/lib/types'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextP9Fixture } from '../helpers/text-open-world-vnext-fixture'

type FixtureAction = {
  actionKey: string
  skillKey: string
  label: string
  targetScope: 'none' | 'combatant'
}

function addActionV17StagedAbandonCoverage(runtimePackage: TextOpenWorldRuntimePackageV1) {
  const actions = runtimePackage.modules.actions.payload as any
  const stagedAbandon = actions.actions.find((candidate: any) => candidate.key === 'action.abandon-supplies')
  const stagedBinding = actions.inputBindings.actions.find((candidate: any) => candidate.actionKey === stagedAbandon.key)
  const actionKey = 'action.abandon-supplies-unstarted-runtime-v4'
  const effectKey = 'effect.abandon-supplies-unstarted-runtime-v4'
  const actionDefinitionHash = 'd'.repeat(64)
  actions.effects.push({
    key: effectKey,
    operation: 'transition-quest',
    payload: { questKey: 'quest.template.supplies', status: 'abandoned', stageKey: null },
  })
  actions.actions.push({
    ...structuredClone(stagedAbandon),
    key: actionKey,
    successEffectKeys: [effectKey],
  })
  actions.inputBindings.actions.push({
    ...structuredClone(stagedBinding),
    key: `binding.${actionKey}`,
    order: actions.inputBindings.actions.length + 1,
    actionKey,
    actionDefinitionHash,
    resultAuthority: {
      ...structuredClone(stagedBinding.resultAuthority),
      actionKey,
      actionDefinitionHash,
    },
    naturalLanguage: {
      ...structuredClone(stagedBinding.naturalLanguage),
      exampleUtterances: ['放弃未开始的运行时测试任务', '不接运行时测试委托'],
    },
  })
}

function addCombatSkillAction(runtimePackage: TextOpenWorldRuntimePackageV1, definition: FixtureAction, ordinal: number) {
  const actions = runtimePackage.modules.actions.payload as any
  const actionTemplate = actions.actions.find((candidate: any) => candidate.key === 'action.combat-power-strike')
  const bindingTemplate = actions.inputBindings.actions.find((candidate: any) => candidate.actionKey === actionTemplate.key)
  const effectKey = `effect.${definition.actionKey.slice('action.'.length)}`
  const actionDefinitionHash = (100 + ordinal).toString(16).padStart(64, '0')
  actions.effects.push({
    key: effectKey,
    operation: 'perform-combat-action',
    payload: { kind: 'skill', skillKey: definition.skillKey, itemKey: null },
  })
  actions.actions.push({
    ...structuredClone(actionTemplate),
    key: definition.actionKey,
    label: definition.label,
    description: `${definition.label}的Action v17确定性测试。`,
    targetScope: definition.targetScope,
    requirementConditionKeys: [],
    costEffectKeys: [],
    successEffectKeys: [effectKey],
  })
  actions.inputBindings.actions.push({
    ...structuredClone(bindingTemplate),
    key: `binding.${definition.actionKey}`,
    order: actions.inputBindings.actions.length + 1,
    actionKey: definition.actionKey,
    actionDefinitionHash,
    targetScope: definition.targetScope,
    systemAction: {
      ...structuredClone(bindingTemplate.systemAction),
      label: definition.label,
      description: `${definition.label}的Action v17确定性测试。`,
    },
    fixedChoiceKeys: [],
    naturalLanguage: {
      ...structuredClone(bindingTemplate.naturalLanguage),
      mode: 'disabled-combat-button-only',
      exampleUtterances: [],
    },
    resultAuthority: {
      ...structuredClone(bindingTemplate.resultAuthority),
      actionKey: definition.actionKey,
      actionDefinitionHash,
    },
  })
}

function combatRuntimeV4Fixture(enemyCount = 2): TextOpenWorldRuntimePackageV1 {
  const runtimePackage = createTextOpenWorldVNextP9Fixture()
  addActionV17StagedAbandonCoverage(runtimePackage)
  const actions = runtimePackage.modules.actions.payload as any
  const actors = runtimePackage.modules.actors.payload as any
  const progression = runtimePackage.modules.progression.payload as any
  const combat = runtimePackage.modules.combat.payload as any
  const items = runtimePackage.modules.items.payload as any

  actions.version = 17
  runtimePackage.modules.actions.schemaVersion = 17
  progression.version = 2
  progression.skills = progression.skills.map((candidate: any) => {
    const { activation: _activation, kind, ...skill } = candidate
    if (kind !== 'attack') throw new Error(`Combat v4夹具遇到未定义机制:${String(kind)}`)
    return { ...skill, mechanic: { kind: 'attack' } }
  })
  progression.statuses = progression.statuses.map((status: any) => ({
    ...status,
    duration: { clock: 'combat' },
    reapplyPolicy: 'reject',
    maxStacks: 1,
    modifiers: [],
  }))
  progression.statuses.push(
    {
      key: 'status.runtime-focus', title: '战意集中', description: '当前行动者的攻击、技能威力和暴击率提高。',
      polarity: 'beneficial', duration: { clock: 'target-turns', turns: 2 },
      reapplyPolicy: 'refresh', maxStacks: 1,
      modifiers: [
        { stat: 'attack', operation: 'add-flat', amount: 1 },
        { stat: 'skillPower', operation: 'add-flat', amount: 3 },
        { stat: 'criticalChanceBasisPoints', operation: 'add-flat', amount: 100 },
      ],
    },
    {
      key: 'status.runtime-exposed', title: '防线暴露', description: '目标的防御暂时降低。',
      polarity: 'harmful', duration: { clock: 'target-turns', turns: 2 },
      reapplyPolicy: 'refresh', maxStacks: 1,
      modifiers: [{ stat: 'defense', operation: 'add-flat', amount: -2 }],
    },
    {
      key: 'status.runtime-marked', title: '盐痕标记', description: '标记持续到本场战斗结束。',
      polarity: 'harmful', duration: { clock: 'combat' },
      reapplyPolicy: 'reject', maxStacks: 1, modifiers: [],
    },
  )
  progression.skills.push(
    {
      key: 'skill.runtime-recovery', title: '盐息复原', description: '恢复自身生命。', tags: ['恢复'],
      mechanic: { kind: 'recovery', baseAmount: 5, scalingNumerator: 1, scalingDenominator: 2 },
      target: 'self', scalingAttribute: 'vitality',
      unlockSources: [{ kind: 'initial', level: null, questKey: null }], useConditionKeys: [], priority: 70,
      resourceCost: 0, cooldownTurns: 0, effectKeys: [],
    },
    {
      key: 'skill.runtime-resource', title: '盐潮回流', description: '恢复自身技能资源。', tags: ['资源'],
      mechanic: { kind: 'resource', baseAmount: 3, scalingNumerator: 1, scalingDenominator: 2 },
      target: 'self', scalingAttribute: 'agility',
      unlockSources: [{ kind: 'initial', level: null, questKey: null }], useConditionKeys: [], priority: 69,
      resourceCost: 0, cooldownTurns: 0, effectKeys: [],
    },
    {
      key: 'skill.runtime-focus', title: '战意集中', description: '为自身施加短时增益。', tags: ['状态'],
      mechanic: { kind: 'status', statusKey: 'status.runtime-focus' }, target: 'self', scalingAttribute: null,
      unlockSources: [{ kind: 'initial', level: null, questKey: null }], useConditionKeys: [], priority: 68,
      resourceCost: 0, cooldownTurns: 0, effectKeys: [],
    },
    {
      key: 'skill.runtime-expose', title: '揭露破绽', description: '降低单个敌人的防御。', tags: ['状态'],
      mechanic: { kind: 'status', statusKey: 'status.runtime-exposed' }, target: 'single-enemy', scalingAttribute: null,
      unlockSources: [{ kind: 'initial', level: null, questKey: null }], useConditionKeys: [], priority: 67,
      resourceCost: 0, cooldownTurns: 0, effectKeys: [],
    },
    {
      key: 'skill.runtime-mark-all', title: '群体盐痕', description: '标记全部存活敌人。', tags: ['状态'],
      mechanic: { kind: 'status', statusKey: 'status.runtime-marked' }, target: 'all-enemies', scalingAttribute: null,
      unlockSources: [{ kind: 'initial', level: null, questKey: null }], useConditionKeys: [], priority: 66,
      resourceCost: 0, cooldownTurns: 0, effectKeys: [],
    },
    {
      key: 'skill.runtime-passive', title: '守渠本能', description: '持续强化基础战斗参数。', tags: ['被动'],
      mechanic: {
        kind: 'passive-static',
        modifiers: [
          { stat: 'attack', operation: 'add-flat', amount: 2 },
          { stat: 'defense', operation: 'add-flat', amount: 2 },
          { stat: 'skillPower', operation: 'add-flat', amount: 2 },
          { stat: 'criticalChanceBasisPoints', operation: 'add-flat', amount: 500 },
        ],
      },
      target: 'self', scalingAttribute: null,
      unlockSources: [{ kind: 'initial', level: null, questKey: null }], useConditionKeys: [], priority: 65,
      resourceCost: 0, cooldownTurns: 0, effectKeys: [],
    },
  )
  const learnedSkillKeys = [
    'skill.runtime-recovery', 'skill.runtime-resource', 'skill.runtime-focus',
    'skill.runtime-expose', 'skill.runtime-mark-all', 'skill.runtime-passive',
  ]
  progression.levels[0].unlockedSkillKeys.push(...learnedSkillKeys)
  actors.player.build.learnedSkillKeys.push(...learnedSkillKeys)
  runtimePackage.modules.progression.schemaVersion = 2

  ;[
    { actionKey: 'action.combat-runtime-recovery', skillKey: 'skill.runtime-recovery', label: '盐息复原', targetScope: 'none' },
    { actionKey: 'action.combat-runtime-resource', skillKey: 'skill.runtime-resource', label: '盐潮回流', targetScope: 'none' },
    { actionKey: 'action.combat-runtime-focus', skillKey: 'skill.runtime-focus', label: '战意集中', targetScope: 'none' },
    { actionKey: 'action.combat-runtime-expose', skillKey: 'skill.runtime-expose', label: '揭露破绽', targetScope: 'combatant' },
    { actionKey: 'action.combat-runtime-mark-all', skillKey: 'skill.runtime-mark-all', label: '群体盐痕', targetScope: 'none' },
  ].forEach((definition, index) => addCombatSkillAction(runtimePackage, definition as FixtureAction, index))

  combat.version = 4
  delete combat.transientPlayerStatusKeys
  combat.encounters[0].locationKey = 'location.salt-port'
  combat.encounters[0].enemyGroups[0].count = enemyCount
  combat.enemies[0].maximumHealth = 999
  combat.enemies[0].attack = 0
  actions.actions.find((action: any) => action.key === 'action.start-ridge-jackal').locationKeys = ['location.salt-port']
  runtimePackage.modules.combat.schemaVersion = 4

  const weapon = items.items.find((item: any) => item.key === 'item.rust-sword')
  weapon.statModifiers = { attack: 2, skillPower: 4 }
  return runtimePackage
}

function payload(event: ProductRuntimeEvent): any { return JSON.parse(event.payloadJson) }

function combatAuthorizations(events: ProductRuntimeEvent[]) {
  return events
    .filter(event => event.type === 'text-open-world.effects.applied')
    .map(event => payload(event).plan.authorization)
    .filter(authorization => authorization?.kind === 'combat-action')
}

async function execute(input: { sessionId: number; actionKey: string; targetKey?: string | null; ordinal: number }) {
  return executeTextOpenWorldActionV1({
    sessionId: input.sessionId,
    actionKey: input.actionKey,
    ...(input.targetKey === undefined ? {} : { targetKey: input.targetKey }),
    commandId: `command.runtime-v4.${input.ordinal}.${input.actionKey}`,
    requestedAt: input.ordinal,
  })
}

function playerTurnState(runtimePackage: TextOpenWorldRuntimePackageV1): TextOpenWorldEffectStateV1 {
  const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
  const weaponInstanceId = Object.entries(projection.state.inventory.itemInstances)
    .find(([, instance]) => instance.itemKey === 'item.rust-sword')?.[0]
  if (!weaponInstanceId) throw new Error('Combat v4夹具缺少初始武器实例')
  projection.state.inventory.equippedItemInstanceIdBySlot.weapon = weaponInstanceId
  const machine = createTextOpenWorldCombatStateMachineV1(runtimePackage)
  projection.state.combat = machine.initialize({
    state: projection.state,
    encounterKey: 'encounter.ridge-jackal',
    instanceKey: 'combat.runtime-v4.in-memory',
  })
  for (const intent of ['begin-round', 'begin-turn'] as const) {
    projection.state.combat = machine.applyAuthorization({
      state: projection.state,
      authorization: machine.prepare({ state: projection.state, intent }),
    })
  }
  return projection.state
}

function nextPlayerTurn(runtimePackage: TextOpenWorldRuntimePackageV1, source: TextOpenWorldEffectStateV1) {
  const state = structuredClone(source)
  const combat = state.combat as TextOpenWorldCombatRuntimeStateV2
  combat.phase = 'actor-turn'
  combat.status = 'active'
  combat.round += 1
  combat.turnIndex = combat.turnOrder.indexOf('player')
  combat.activeCombatantKey = 'player'
  state.combat = beginTextOpenWorldCombatantTurnV2({
    combat,
    progression: parseTextOpenWorldModulesV1(runtimePackage).progression as any,
    combatantKey: 'player',
  })
  return state
}

function evidenceFor(requests: Array<{ drawKey: string; minimumInclusive: number; maximumInclusive: number }>): TextOpenWorldRandomEvidenceV1[] {
  return requests.map((request, drawIndex) => ({
    ...request,
    algorithm: 'sha256-range-v1',
    seedHash: '1'.repeat(64),
    inputHash: '2'.repeat(64),
    drawIndex,
    value: request.maximumInclusive,
  }))
}

async function applyCombatAction(input: {
  runtimePackage: TextOpenWorldRuntimePackageV1
  state: TextOpenWorldEffectStateV1
  actionKey: string
  targetKey?: string | null
}) {
  const modules = parseTextOpenWorldModulesV1(input.runtimePackage)
  const combat = createTextOpenWorldCombatActionCatalogV1(input.runtimePackage, modules)
  const preparedInput = {
    state: input.state,
    actionKey: input.actionKey,
    targetKey: input.targetKey ?? null,
    actorKey: 'player' as const,
    conditionResults: Object.fromEntries(modules.actions.conditions.map(condition => [condition.key, true])),
  }
  const requests = combat.randomRequestsFor(preparedInput)
  const authorization = combat.prepare({ ...preparedInput, evidence: evidenceFor(requests) })
  const action = modules.actions.actions.find(candidate => candidate.key === input.actionKey)
  if (!action) throw new Error(`Combat v4测试Action不存在:${input.actionKey}`)
  const effectKeys = [...new Set([...action.costEffectKeys, ...action.successEffectKeys])]
  const effects = createTextOpenWorldEffectCatalogV1(input.runtimePackage)
  const plan = await effects.plan({
    effectKeys,
    claimKey: `claim.runtime-v4.${input.actionKey}.${(input.state.combat as TextOpenWorldCombatRuntimeStateV2).round}`,
    state: input.state,
    authorization,
  })
  const applied = await effects.apply({ plan, state: input.state })
  return { ...applied, plan, authorization }
}

describe('Text Open World · Action v17 / CombatRuntimeState v2 end-to-end', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('确定性EffectPlan真实结算四类主动技能、被动修正、目标回合过期与终态清空', async () => {
    const runtimePackage = combatRuntimeV4Fixture()
    expect(parseTextOpenWorldModulesV1(runtimePackage)).toMatchObject({
      actions: { version: 17 }, progression: { version: 2 }, combat: { sourceVersion: 4 },
    })
    const initial = playerTurnState(runtimePackage)
    const started = initial.combat
    expect(started).toMatchObject({
      version: 2,
      phase: 'actor-turn',
      activeCombatantKey: 'player',
      actorTurnOrdinalByCombatantKey: { player: 1, 'enemy.1.1': 0, 'enemy.1.2': 0 },
      statusInstancesByCombatantKey: { player: [], 'enemy.1.1': [], 'enemy.1.2': [] },
    })

    const focused = await applyCombatAction({
      runtimePackage, state: initial, actionKey: 'action.combat-runtime-focus',
    })
    expect(focused.authorization).toMatchObject({
      resolutionVersion: 2,
      mechanicKind: 'status',
      statusResolutions: [{ targetCombatantKey: 'player', statusKey: 'status.runtime-focus', outcome: 'applied' }],
    })
    const basic = await applyCombatAction({
      runtimePackage,
      state: nextPlayerTurn(runtimePackage, focused.state),
      actionKey: 'action.combat-basic-attack',
      targetKey: 'enemy.1.1',
    })
    expect(basic.authorization).toMatchObject({
      mechanicKind: 'attack',
      targetResolutions: [expect.objectContaining({ attack: 11, criticalChanceBasisPoints: 1250, skillPower: 0 })],
    })
    const powerStrike = await applyCombatAction({
      runtimePackage,
      state: nextPlayerTurn(runtimePackage, basic.state),
      actionKey: 'action.combat-power-strike',
      targetKey: 'enemy.1.1',
    })
    expect(powerStrike.authorization).toMatchObject({
      mechanicKind: 'attack',
      expiredStatusKeys: ['status.runtime-focus'],
      targetResolutions: [expect.objectContaining({ attack: 3, skillPower: 9, damageBeforeDefense: 13 })],
    })
    const resource = await applyCombatAction({
      runtimePackage,
      state: nextPlayerTurn(runtimePackage, powerStrike.state),
      actionKey: 'action.combat-runtime-resource',
    })
    expect(resource.authorization).toMatchObject({
      mechanicKind: 'resource',
      resourceResolutions: [expect.objectContaining({
        targetCombatantKey: 'player', beforeSkillResource: 2, afterSkillResource: 4,
        skillPower: 6, requestedRecovery: 10, appliedRecovery: 2,
      })],
    })
    const recoveryState = nextPlayerTurn(runtimePackage, resource.state)
    recoveryState.player.health = 10
    const recovery = await applyCombatAction({
      runtimePackage, state: recoveryState, actionKey: 'action.combat-runtime-recovery',
    })
    expect(recovery.authorization).toMatchObject({
      mechanicKind: 'recovery',
      recoveryResolutions: [expect.objectContaining({
        targetCombatantKey: 'player', beforeHealth: 10, afterHealth: 22,
        skillPower: 6, requestedRecovery: 12, appliedRecovery: 12,
      })],
    })
    expect(recovery.receipt.changes.find(change => change.operation === 'perform-combat-action')).toMatchObject({
      before: { health: 10, skillResource: 4, combat: expect.any(Object) },
      after: { health: 22, skillResource: 4, combat: expect.any(Object) },
    })

    const expose = await applyCombatAction({
      runtimePackage,
      state: playerTurnState(runtimePackage),
      actionKey: 'action.combat-runtime-expose',
      targetKey: 'enemy.1.1',
    })
    const exposedAttack = await applyCombatAction({
      runtimePackage,
      state: nextPlayerTurn(runtimePackage, expose.state),
      actionKey: 'action.combat-basic-attack',
      targetKey: 'enemy.1.1',
    })
    expect(exposedAttack.authorization).toMatchObject({
      targetResolutions: [expect.objectContaining({ defense: 0 })],
    })

    const marked = await applyCombatAction({
      runtimePackage,
      state: playerTurnState(runtimePackage),
      actionKey: 'action.combat-runtime-mark-all',
    })
    expect(marked.authorization).toMatchObject({
      mechanicKind: 'status',
      statusResolutions: [
        { targetCombatantKey: 'enemy.1.1', statusKey: 'status.runtime-marked', outcome: 'applied', beforeStatus: null, afterStatus: expect.any(Object) },
        { targetCombatantKey: 'enemy.1.2', statusKey: 'status.runtime-marked', outcome: 'applied', beforeStatus: null, afterStatus: expect.any(Object) },
      ],
    })
    const escaped = await applyCombatAction({
      runtimePackage,
      state: nextPlayerTurn(runtimePackage, marked.state),
      actionKey: 'action.combat-escape',
    })
    const terminalState = structuredClone(escaped.state)
    const machine = createTextOpenWorldCombatStateMachineV1(runtimePackage)
    const terminalAuthorization = machine.prepare({ state: terminalState, intent: 'finish-escaped' })
    const terminalTampered = structuredClone(terminalAuthorization)
    terminalTampered.afterStatusInstancesByCombatantKey!['enemy.1.1'] = structuredClone(
      (marked.state.combat as TextOpenWorldCombatRuntimeStateV2).statusInstancesByCombatantKey['enemy.1.1'],
    )
    expect(() => machine.assertAuthorization({ state: escaped.state, authorization: terminalTampered }))
      .toThrow('战斗阶段授权与当前状态不一致')
    terminalState.combat = machine.applyAuthorization({ state: terminalState, authorization: terminalAuthorization })
    expect(terminalState.combat).toMatchObject({
      version: 2,
      status: 'escaped',
      phase: 'terminal',
      statusInstancesByCombatantKey: { player: [], 'enemy.1.1': [], 'enemy.1.2': [] },
    })
    expect(terminalAuthorization).toMatchObject({
      combatRuntimeVersion: 2,
      afterStatusInstancesByCombatantKey: { player: [], 'enemy.1.1': [], 'enemy.1.2': [] },
    })
  })

  it('真实Action→Effect→Event→Replay冻结状态结果并拒绝自洽式篡改', async () => {
    const created = await createGovernedTextOpenWorldSessionFixtureV1({
      name: `TEXT-OPEN-WORLD Combat Runtime v4 tamper-${crypto.randomUUID()}`,
      textOpenWorldVNext: combatRuntimeV4Fixture(1),
      title: 'Combat Runtime v4 tamper',
      seed: 'combat-runtime-v4-tamper',
    })
    const sessionId = created.session.id!
    await execute({ sessionId, actionKey: 'action.start-ridge-jackal', targetKey: 'encounter.ridge-jackal', ordinal: 1 })
    await execute({ sessionId, actionKey: 'action.combat-runtime-mark-all', ordinal: 2 })
    const active = await readProductRuntimeState(sessionId)
    expect((active.textOpenWorld!.state.combat as TextOpenWorldCombatRuntimeStateV2).statusInstancesByCombatantKey['enemy.1.1'])
      .toEqual([expect.objectContaining({ statusKey: 'status.runtime-marked' })])
    const events = await db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence')
    const projectedActions = createTextOpenWorldActionRegistryV1(active.textOpenWorld!.runtimePackage)
      .project(deriveTextOpenWorldContextsV1(active.textOpenWorld!).action)
    const playerCombat = projectTextOpenWorldPlayerCombatV1({
      sessionId,
      projection: active.textOpenWorld!,
      events,
      projectedActions,
    })!
    expect(playerCombat.actions.find(action => action.label === '群体盐痕')?.effectDetails).toEqual([
      '施加“盐痕标记”',
      '持续至本场战斗结束',
      '已有时不重复施加',
    ])
    const statusLog = playerCombat.log.find(entry => entry.actionLabel === '群体盐痕')
    expect(statusLog).toMatchObject({ summary: '来客使用群体盐痕，状态效果已经结算。' })
    expect(statusLog?.details).toContain('盐鬣犬获得状态“盐痕标记”')
    const visibleCombatText = [
      ...playerCombat.actions.flatMap(action => [action.label, action.description, ...action.effectDetails]),
      ...playerCombat.log.flatMap(entry => [entry.summary, ...entry.details]),
      ...playerCombat.player.statuses.flatMap(status => [status.title, status.description, ...status.effectDetails]),
      ...playerCombat.enemies.flatMap(enemy => [enemy.label, enemy.description ?? '', ...enemy.statuses.flatMap(status => [status.title, status.description, ...status.effectDetails])]),
    ].join(' ')
    expect(visibleCombatText).not.toMatch(/status\.runtime|skill\.runtime|action\.combat-runtime|enemy\.1\./)
    const statusAuthorization = combatAuthorizations(events)
      .find(authorization => authorization.actionKey === 'action.combat-runtime-mark-all')
    expect(statusAuthorization).toMatchObject({
      resolutionVersion: 2,
      mechanicKind: 'status',
      statusResolutions: [{ targetCombatantKey: 'enemy.1.1', outcome: 'applied' }],
      afterStatusInstancesByCombatantKey: {
        player: [],
        'enemy.1.1': [expect.objectContaining({ statusKey: 'status.runtime-marked' })],
      },
    })
    expect(replayProductRuntimeEvents(JSON.parse(created.session.initialStateJson), events).textOpenWorld)
      .toEqual(active.textOpenWorld)
    await db.productRuntimeSessions.update(sessionId, {
      runtimeHeadSequence: null, runtimeHeadStateJson: null, runtimeHeadStateHash: null,
    })
    expect((await readProductRuntimeState(sessionId)).textOpenWorld).toEqual(active.textOpenWorld)

    const statusTampered = structuredClone(events) as ProductRuntimeEvent[]
    const statusEvent = statusTampered.find(event => event.type === 'text-open-world.effects.applied'
      && payload(event).plan.authorization?.actionKey === 'action.combat-runtime-mark-all')!
    const statusPayload = payload(statusEvent)
    const statusResolution = statusPayload.plan.authorization.statusResolutions[0]
    statusResolution.outcome = 'rejected'
    statusResolution.beforeStatus = structuredClone(statusResolution.afterStatus)
    statusEvent.payloadJson = JSON.stringify(statusPayload)
    expect(() => replayProductRuntimeEvents(JSON.parse(created.session.initialStateJson), statusTampered))
      .toThrow('战斗行动授权与当前状态不一致')
  }, 60_000)
})
