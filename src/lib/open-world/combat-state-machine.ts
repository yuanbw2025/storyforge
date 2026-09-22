import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import type {
  TextOpenWorldCombatRuntimeStateV1,
  TextOpenWorldCombatRuntimeStateV2,
  TextOpenWorldCombatTransitionAuthorizationV1,
  TextOpenWorldCombatTransitionIntentV1,
  TextOpenWorldEffectStateV1,
  TextOpenWorldParsedModulesV1,
  TextOpenWorldRuntimePackageV1,
} from '../types'
import { deriveTextOpenWorldEquippedItemKeysV1 } from './inventory'
import { parseTextOpenWorldModulesV1 } from './modules'
import { deriveTextOpenWorldPlayerStatsFromModulesV1 } from './player-stats'
import { createTextOpenWorldCombatDefinitionCatalogV1 } from './combat-definitions'
import {
  beginTextOpenWorldCombatantTurnV2,
  clearTextOpenWorldCombatStatusesAtTerminalV2,
  isTextOpenWorldCombatRuntimeStateV2,
  settleTextOpenWorldCombatStatusesAfterTurnV2,
  validateTextOpenWorldCombatStatusStateV2,
} from './combat-status'

type TextOpenWorldModernCombatRuntimeState = TextOpenWorldCombatRuntimeStateV1 | TextOpenWorldCombatRuntimeStateV2

function fail(message: string): never { throw new Error(`[text-open-world-combat-state] ${message}`) }
function integer(value: unknown, label: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) fail(`${label}无效`)
  return Number(value)
}

export function isTextOpenWorldCombatRuntimeStateV1(value: unknown): value is TextOpenWorldCombatRuntimeStateV1 {
  return Boolean(value && typeof value === 'object' && (value as { version?: unknown }).version === 1)
}

function expectedEnemies(
  modules: TextOpenWorldParsedModulesV1,
  encounterKey: string,
): TextOpenWorldCombatRuntimeStateV1['enemies'] {
  const encounter = modules.combat.encounters.find(item => item.key === encounterKey) ?? fail(`遭遇不存在:${encounterKey}`)
  return encounter.enemyGroups.flatMap(group => {
    const definition = modules.combat.enemies.find(enemy => enemy.key === group.enemyKey) ?? fail(`敌人不存在:${group.enemyKey}`)
    return Array.from({ length: group.count }, (_, index) => ({
      combatantKey: `enemy.${group.order}.${index + 1}`,
      groupKey: group.key,
      enemyKey: definition.key,
      currentHealth: definition.maximumHealth,
      maximumHealth: definition.maximumHealth,
      initiative: definition.initiative,
      defeated: false,
      ...(modules.actions.version >= 10 ? { cooldownUntilRoundBySkillKey: {} } : {}),
    }))
  })
}

function orderFor(combat: Pick<TextOpenWorldModernCombatRuntimeState, 'playerInitiative' | 'enemies'>): string[] {
  return [
    { combatantKey: 'player', initiative: combat.playerInitiative, sideOrder: 0 },
    ...combat.enemies.map(enemy => ({ combatantKey: enemy.combatantKey, initiative: enemy.initiative, sideOrder: 1 })),
  ].sort((left, right) => right.initiative - left.initiative
    || left.sideOrder - right.sideOrder
    || left.combatantKey.localeCompare(right.combatantKey))
    .map(item => item.combatantKey)
}

function alive(combat: TextOpenWorldModernCombatRuntimeState, playerHealth: number, combatantKey: string): boolean {
  return combatantKey === 'player'
    ? playerHealth > 0
    : combat.enemies.find(enemy => enemy.combatantKey === combatantKey)?.defeated === false
}

export function validateTextOpenWorldCombatRuntimeStateV1(input: {
  modules: TextOpenWorldParsedModulesV1
  state: TextOpenWorldEffectStateV1
}): TextOpenWorldModernCombatRuntimeState | null {
  const combat = input.state.combat
  if (combat == null) return null
  const runtimeV1 = isTextOpenWorldCombatRuntimeStateV1(combat)
  const runtimeV2 = isTextOpenWorldCombatRuntimeStateV2(combat)
  if (!runtimeV1 && !runtimeV2) {
    if (input.modules.combat.sourceVersion !== 1) fail('Combat v2 Session不能使用旧战斗投影')
    if (!input.modules.combat.encounters.some(item => item.key === combat.encounterKey)) fail(`旧战斗遭遇不存在:${combat.encounterKey}`)
    if (!['active', 'victory', 'defeat', 'escaped'].includes(combat.status)) fail('旧战斗状态无效')
    return null
  }
  if (runtimeV2 !== (input.modules.combat.sourceVersion === 4)) {
    fail('Combat v4必须且只能使用CombatRuntimeState v2')
  }
  if (typeof combat.instanceKey !== 'string' || !combat.instanceKey || combat.instanceKey.length > 200) fail('combat.instanceKey无效')
  const encounter = input.modules.combat.encounters.find(item => item.key === combat.encounterKey) ?? fail(`战斗遭遇不存在:${combat.encounterKey}`)
  const playerInitiative = integer(combat.playerInitiative, 'combat.playerInitiative', 0, 1_000_000)
  const expected = expectedEnemies(input.modules, encounter.key)
  if (!Array.isArray(combat.enemies) || combat.enemies.length !== expected.length) fail('战斗敌人实例与遭遇定义不一致')
  const expectedByKey = new Map(expected.map(enemy => [enemy.combatantKey, enemy]))
  const seen = new Set<string>()
  combat.enemies.forEach((enemy, index) => {
    if (!enemy || typeof enemy !== 'object' || typeof enemy.combatantKey !== 'string' || seen.has(enemy.combatantKey)) fail(`combat.enemies[${index}].combatantKey无效`)
    seen.add(enemy.combatantKey)
    const definition = expectedByKey.get(enemy.combatantKey) ?? fail(`战斗敌人实例不属于遭遇:${enemy.combatantKey}`)
    if (enemy.groupKey !== definition.groupKey || enemy.enemyKey !== definition.enemyKey
      || enemy.maximumHealth !== definition.maximumHealth || enemy.initiative !== definition.initiative) fail(`战斗敌人实例定义漂移:${enemy.combatantKey}`)
    const currentHealth = integer(enemy.currentHealth, `combat.enemies[${index}].currentHealth`, 0, enemy.maximumHealth)
    if (enemy.defeated !== (currentHealth === 0)) fail(`战斗敌人生命与战败标记不一致:${enemy.combatantKey}`)
    if (input.modules.actions.version >= 10) {
      if (!enemy.cooldownUntilRoundBySkillKey || typeof enemy.cooldownUntilRoundBySkillKey !== 'object' || Array.isArray(enemy.cooldownUntilRoundBySkillKey)) fail(`敌人技能冷却投影缺失:${enemy.combatantKey}`)
      for (const [skillKey, readyRound] of Object.entries(enemy.cooldownUntilRoundBySkillKey)) {
        if (!input.modules.progression.skills.some(skill => skill.key === skillKey)) fail(`敌人冷却引用未知技能:${skillKey}`)
        integer(readyRound, `enemy cooldown ${enemy.combatantKey}.${skillKey}`, 1, 100_000)
      }
    } else if (enemy.cooldownUntilRoundBySkillKey != null) fail(`旧战斗投影不能包含敌人技能冷却:${enemy.combatantKey}`)
  })
  if (input.modules.actions.version >= 10) {
    if (!combat.cooldownUntilRoundBySkillKey || typeof combat.cooldownUntilRoundBySkillKey !== 'object' || Array.isArray(combat.cooldownUntilRoundBySkillKey)) fail('玩家技能冷却投影缺失')
    for (const [skillKey, readyRound] of Object.entries(combat.cooldownUntilRoundBySkillKey)) {
      if (!input.modules.progression.skills.some(skill => skill.key === skillKey)) fail(`玩家冷却引用未知技能:${skillKey}`)
      integer(readyRound, `player cooldown ${skillKey}`, 1, 100_000)
    }
    if (combat.lastAction === undefined) fail('战斗lastAction投影缺失')
    if (combat.lastAction != null) {
      const action = combat.lastAction
      if (!input.modules.actions.actions.some(item => item.key === action.actionKey)) fail('lastAction引用未知Action')
      if (!['player', ...combat.enemies.map(enemy => enemy.combatantKey)].includes(action.actorCombatantKey)) fail('lastAction行动者不存在')
      if (!['basic-attack', 'skill', 'item', 'escape', 'enemy-skill'].includes(action.kind)) fail('lastAction.kind无效')
      if (action.skillKey != null && !input.modules.progression.skills.some(skill => skill.key === action.skillKey)) fail('lastAction技能不存在')
      if (action.itemKey != null && !input.modules.items.items.some(item => item.key === action.itemKey)) fail('lastAction道具不存在')
      if (!Array.isArray(action.targetCombatantKeys) || new Set(action.targetCombatantKeys).size !== action.targetCombatantKeys.length
        || action.targetCombatantKeys.some(key => !['player', ...combat.enemies.map(enemy => enemy.combatantKey)].includes(key))) fail('lastAction目标无效')
      integer(action.round, 'lastAction.round', 1, combat.round)
      integer(action.turnIndex, 'lastAction.turnIndex', 0, combat.turnOrder.length - 1)
      if (combat.turnOrder[action.turnIndex] !== action.actorCombatantKey) fail('lastAction行动索引漂移')
      if (input.modules.actions.version >= 11) {
        if (!Array.isArray(action.targetResolutions)) fail('Action v11战斗lastAction缺少伤害结算')
        const structuredAction = input.modules.actions.version >= 17
        const resolvedTargets = action.targetResolutions.map((resolution, resolutionIndex) => {
          if (!resolution || typeof resolution !== 'object') fail(`lastAction.targetResolutions[${resolutionIndex}]无效`)
          integer(resolution.attack, 'lastAction resolution attack', 0, 1_000_000_000)
          integer(resolution.defense, 'lastAction resolution defense', 0, 1_000_000_000)
          integer(resolution.beforeHealth, 'lastAction resolution beforeHealth', 1, 1_000_000_000)
          integer(resolution.afterHealth, 'lastAction resolution afterHealth', 0, resolution.beforeHealth)
          integer(resolution.appliedDamage, 'lastAction resolution appliedDamage', 0, resolution.beforeHealth)
          if (resolution.beforeHealth - resolution.appliedDamage !== resolution.afterHealth
            || resolution.defeated !== (resolution.afterHealth === 0)) fail('lastAction伤害结算不自洽')
          if (structuredAction) integer('skillPower' in resolution ? resolution.skillPower : Number.NaN, 'lastAction resolution skillPower', -1_000_000_000, 1_000_000_000)
          else if ('skillPower' in resolution) fail('Action v11～v16战斗lastAction不能包含skillPower')
          return resolution.targetCombatantKey
        })
        const actionSkill = action.skillKey ? input.modules.progression.skills.find(item => item.key === action.skillKey) : null
        if (canonicalProductProductionJsonV2(resolvedTargets) !== canonicalProductProductionJsonV2(action.targetCombatantKeys.filter(targetCombatantKey => {
          return actionSkill?.kind === 'attack' && targetCombatantKey !== action.actorCombatantKey
        }))) fail('lastAction伤害目标与行动目标不一致')

        const structuredFields = [
          action.mechanicKind,
          action.recoveryResolutions,
          action.resourceResolutions,
          action.statusResolutions,
          action.expiredStatusKeys,
        ]
        if (structuredAction) {
          if (!runtimeV2 || input.modules.progression.version !== 2) fail('Action v17 lastAction必须属于CombatRuntimeState v2')
          if (!Array.isArray(action.recoveryResolutions) || !Array.isArray(action.resourceResolutions)
            || !Array.isArray(action.statusResolutions) || !Array.isArray(action.expiredStatusKeys)) {
            fail('Action v17战斗lastAction缺少结构化结算')
          }
          const structuredSkill = action.skillKey
            ? input.modules.progression.skills.find(item => item.key === action.skillKey) ?? fail('Action v17 lastAction技能不存在')
            : null
          const mechanicKind = structuredSkill?.mechanic.kind === 'passive-static'
            ? fail('lastAction不能主动执行passive-static技能')
            : structuredSkill?.mechanic.kind ?? null
          if (action.mechanicKind !== mechanicKind
            || ((action.kind === 'item' || action.kind === 'escape') !== (mechanicKind == null))
            || (action.kind === 'basic-attack' && mechanicKind !== 'attack')
            || (action.kind === 'enemy-skill' && mechanicKind === 'resource')) {
            fail('lastAction行动与mechanicKind不一致')
          }
          if ((mechanicKind === 'attack') !== (action.targetResolutions.length > 0)
            || (mechanicKind === 'recovery') !== (action.recoveryResolutions.length === 1)
            || (mechanicKind === 'resource') !== (action.resourceResolutions.length === 1)
            || (mechanicKind !== 'status' && action.statusResolutions.length > 0)) {
            fail('lastAction结构化结算数量无效')
          }
          if (mechanicKind === 'recovery') {
            const resolution = action.recoveryResolutions[0]
            const maximumHealth = integer(resolution.maximumHealth, 'lastAction recovery maximumHealth', 1, 1_000_000_000)
            const beforeHealth = integer(resolution.beforeHealth, 'lastAction recovery beforeHealth', 1, maximumHealth)
            const afterHealth = integer(resolution.afterHealth, 'lastAction recovery afterHealth', beforeHealth, maximumHealth)
            const baseAmount = integer(resolution.baseAmount, 'lastAction recovery baseAmount', 0, 1_000_000_000)
            const scalingValue = integer(resolution.scalingValue, 'lastAction recovery scalingValue', 0, 1_000_000_000)
            const numerator = integer(resolution.scalingNumerator, 'lastAction recovery scalingNumerator', 0, 100)
            const denominator = integer(resolution.scalingDenominator, 'lastAction recovery scalingDenominator', 1, 100)
            const skillPower = integer(resolution.skillPower, 'lastAction recovery skillPower', -1_000_000_000, 1_000_000_000)
            const requested = integer(resolution.requestedRecovery, 'lastAction recovery requestedRecovery', 0, 1_000_000_000)
            const applied = integer(resolution.appliedRecovery, 'lastAction recovery appliedRecovery', 0, 1_000_000_000)
            if (resolution.targetCombatantKey !== action.actorCombatantKey
              || !['power', 'vitality', 'agility'].includes(resolution.scalingAttribute)
              || requested !== Math.max(0, baseAmount + Math.floor(scalingValue * numerator / denominator) + skillPower)
              || afterHealth !== Math.min(maximumHealth, beforeHealth + requested)
              || applied !== afterHealth - beforeHealth) fail('lastAction recovery结算不自洽')
          }
          if (mechanicKind === 'resource') {
            const resolution = action.resourceResolutions[0]
            const maximum = integer(resolution.maximumSkillResource, 'lastAction resource maximumSkillResource', 0, 1_000_000_000)
            const before = integer(resolution.beforeSkillResource, 'lastAction resource beforeSkillResource', 0, maximum)
            const after = integer(resolution.afterSkillResource, 'lastAction resource afterSkillResource', before, maximum)
            const baseAmount = integer(resolution.baseAmount, 'lastAction resource baseAmount', 0, 1_000_000_000)
            const scalingValue = integer(resolution.scalingValue, 'lastAction resource scalingValue', 0, 1_000_000_000)
            const numerator = integer(resolution.scalingNumerator, 'lastAction resource scalingNumerator', 0, 100)
            const denominator = integer(resolution.scalingDenominator, 'lastAction resource scalingDenominator', 1, 100)
            const skillPower = integer(resolution.skillPower, 'lastAction resource skillPower', -1_000_000_000, 1_000_000_000)
            const requested = integer(resolution.requestedRecovery, 'lastAction resource requestedRecovery', 0, 1_000_000_000)
            const applied = integer(resolution.appliedRecovery, 'lastAction resource appliedRecovery', 0, 1_000_000_000)
            if (resolution.targetCombatantKey !== 'player' || action.actorCombatantKey !== 'player'
              || !['power', 'vitality', 'agility'].includes(resolution.scalingAttribute)
              || requested !== Math.max(0, baseAmount + Math.floor(scalingValue * numerator / denominator) + skillPower)
              || after !== Math.min(maximum, before + requested) || applied !== after - before) {
              fail('lastAction resource结算不自洽')
            }
          }
          if (mechanicKind === 'status') {
            const statusTargets = action.statusResolutions.map((resolution, index) => {
              if (!resolution || typeof resolution !== 'object'
                || !['applied', 'rejected', 'refreshed', 'stacked', 'max-stacks'].includes(resolution.outcome)
                || !input.modules.progression.statuses.some(status => status.key === resolution.statusKey)) {
                fail(`lastAction.statusResolutions[${index}]无效`)
              }
              if ((resolution.beforeStatus && resolution.beforeStatus.statusKey !== resolution.statusKey)
                || (resolution.afterStatus && resolution.afterStatus.statusKey !== resolution.statusKey)
                || (resolution.outcome === 'applied' && (resolution.beforeStatus != null || resolution.afterStatus == null))
                || ((resolution.outcome === 'rejected' || resolution.outcome === 'max-stacks')
                  && canonicalProductProductionJsonV2(resolution.beforeStatus) !== canonicalProductProductionJsonV2(resolution.afterStatus))
                || ((resolution.outcome === 'refreshed' || resolution.outcome === 'stacked')
                  && (resolution.beforeStatus == null || resolution.afterStatus == null))) {
                fail(`lastAction.statusResolutions[${index}]不自洽`)
              }
              return resolution.targetCombatantKey
            })
            if (canonicalProductProductionJsonV2(statusTargets) !== canonicalProductProductionJsonV2(action.targetCombatantKeys)) {
              fail('lastAction status目标与行动目标不一致')
            }
          }
          if (new Set(action.expiredStatusKeys).size !== action.expiredStatusKeys.length
            || action.expiredStatusKeys.some(statusKey => !input.modules.progression.statuses.some(status => status.key === statusKey))) {
            fail('lastAction到期状态无效')
          }
        } else if (structuredFields.some(field => field !== undefined)) {
          fail('Action v11～v16战斗lastAction不能包含结构化结算')
        }
      } else if (action.targetResolutions !== undefined) fail('Action v10战斗lastAction不能包含伤害结算')
    }
  } else if (combat.cooldownUntilRoundBySkillKey != null || combat.lastAction !== undefined) fail('旧战斗投影不能包含Action v10字段')
  const expectedOrder = orderFor({ playerInitiative, enemies: combat.enemies })
  if (!Array.isArray(combat.turnOrder) || canonicalProductProductionJsonV2(combat.turnOrder) !== canonicalProductProductionJsonV2(expectedOrder)) fail('战斗回合顺序漂移')
  const round = integer(combat.round, 'combat.round', 0, 100_000)
  const phase = combat.phase
  const terminal = ['victory', 'defeat', 'escaped'].includes(combat.status)
  if (terminal !== (phase === 'terminal')) fail('战斗终态与阶段不一致')
  if (!terminal && combat.status !== 'active') fail('进行中战斗status无效')
  if (phase === 'started') {
    if (round !== 0 || combat.turnIndex !== null || combat.activeCombatantKey !== null) fail('started阶段游标无效')
  } else if (phase === 'round-start' || phase === 'round-end' || phase === 'terminal') {
    if (round < 1 || combat.turnIndex !== null || combat.activeCombatantKey !== null) fail(`${phase}阶段游标无效`)
  } else if (phase === 'actor-turn' || phase === 'action-resolved') {
    if (round < 1 || combat.turnIndex == null || combat.activeCombatantKey == null) fail(`${phase}阶段缺少行动者`)
    const turnIndex = integer(combat.turnIndex, 'combat.turnIndex', 0, combat.turnOrder.length - 1)
    if (combat.turnOrder[turnIndex] !== combat.activeCombatantKey || !alive(combat, input.state.player.health, combat.activeCombatantKey)) fail(`${phase}行动者无效`)
  } else fail('战斗phase无效')
  if (runtimeV2) {
    if (input.modules.progression.version !== 2) fail('CombatRuntimeState v2必须搭配Progression v2')
    validateTextOpenWorldCombatStatusStateV2({ combat, progression: input.modules.progression })
    if (terminal && Object.values(combat.statusInstancesByCombatantKey).some(instances => instances.length > 0)) {
      fail('CombatRuntimeState v2终态必须清空战斗状态')
    }
  }
  return combat
}

export function createTextOpenWorldCombatStateMachineV1(
  value: TextOpenWorldRuntimePackageV1 | string | unknown,
  parsedModules?: TextOpenWorldParsedModulesV1,
) {
  const modules = parsedModules ?? parseTextOpenWorldModulesV1(value)
  const definitions = createTextOpenWorldCombatDefinitionCatalogV1(value, modules)
  const initialize = (input: {
    state: TextOpenWorldEffectStateV1
    encounterKey: string
    instanceKey: string
  }): TextOpenWorldModernCombatRuntimeState => {
    if (input.state.player.health <= 0 || input.state.combat?.status === 'active') fail('当前不能开始新战斗')
    if (typeof input.instanceKey !== 'string' || !input.instanceKey || input.instanceKey.length > 200) fail('combat instanceKey无效')
    const encounter = definitions.getEncounter(input.encounterKey) ?? fail(`遭遇不存在:${input.encounterKey}`)
    const playerStats = deriveTextOpenWorldPlayerStatsFromModulesV1({
      modules,
      level: input.state.player.level,
      attributes: input.state.player.attributes,
      equippedItemKeyBySlot: deriveTextOpenWorldEquippedItemKeysV1(modules, input.state.inventory),
    })
    const enemies = expectedEnemies(modules, encounter.key)
    const baseCombat: Omit<TextOpenWorldCombatRuntimeStateV1, 'version'> = {
      instanceKey: input.instanceKey,
      encounterKey: encounter.key,
      status: 'active',
      phase: 'started',
      round: 0,
      turnIndex: null,
      activeCombatantKey: null,
      playerInitiative: playerStats.initiative,
      turnOrder: [],
      ...(modules.actions.version >= 10 ? { cooldownUntilRoundBySkillKey: {}, lastAction: null } : {}),
      enemies,
    }
    const combat: TextOpenWorldModernCombatRuntimeState = modules.combat.sourceVersion === 4
      ? {
          ...baseCombat,
          version: 2,
          actorTurnOrdinalByCombatantKey: {},
          statusInstancesByCombatantKey: {},
        }
      : { ...baseCombat, version: 1 }
    combat.turnOrder = orderFor(combat)
    if (isTextOpenWorldCombatRuntimeStateV2(combat)) {
      combat.actorTurnOrdinalByCombatantKey = Object.fromEntries(combat.turnOrder.map(combatantKey => [combatantKey, 0]))
      combat.statusInstancesByCombatantKey = Object.fromEntries(combat.turnOrder.map(combatantKey => [combatantKey, []]))
    }
    const state = structuredClone(input.state)
    state.combat = combat
    validateTextOpenWorldCombatRuntimeStateV1({ modules, state })
    return combat
  }

  const prepare = (input: {
    state: TextOpenWorldEffectStateV1
    intent: TextOpenWorldCombatTransitionIntentV1
  }): TextOpenWorldCombatTransitionAuthorizationV1 => {
    const combat = validateTextOpenWorldCombatRuntimeStateV1({ modules, state: input.state }) ?? fail('当前没有Combat v2战斗')
    if (combat.status !== 'active') fail('战斗已进入终态')
    let afterStatus: TextOpenWorldModernCombatRuntimeState['status'] = combat.status
    let afterPhase: TextOpenWorldModernCombatRuntimeState['phase'] = combat.phase
    let afterRound = combat.round
    let afterTurnIndex = combat.turnIndex
    let afterActiveCombatantKey = combat.activeCombatantKey
    let removedPlayerStatusKeys: string[] = []
    if (input.intent === 'begin-round') {
      if (!['started', 'round-end'].includes(combat.phase)) fail('只有started或round-end可以开始新回合')
      afterPhase = 'round-start'; afterRound += 1; afterTurnIndex = null; afterActiveCombatantKey = null
    } else if (input.intent === 'begin-turn') {
      if (combat.phase !== 'round-start') fail('只有round-start可以开始行动者回合')
      const firstIndex = combat.turnOrder.findIndex(combatantKey => alive(combat, input.state.player.health, combatantKey))
      if (firstIndex < 0) fail('当前没有可行动战斗参与者')
      afterPhase = 'actor-turn'; afterTurnIndex = firstIndex; afterActiveCombatantKey = combat.turnOrder[firstIndex]
    } else if (input.intent === 'complete-turn') {
      if (combat.phase !== 'actor-turn') fail('只有actor-turn可以完成行动')
      afterPhase = 'action-resolved'
    } else if (input.intent === 'advance-turn') {
      if (combat.phase !== 'action-resolved' || combat.turnIndex == null) fail('只有action-resolved可以推进回合')
      const nextIndex = combat.turnOrder.findIndex((combatantKey, index) => index > combat.turnIndex! && alive(combat, input.state.player.health, combatantKey))
      if (nextIndex < 0) {
        afterPhase = 'round-end'; afterTurnIndex = null; afterActiveCombatantKey = null
      } else {
        afterPhase = 'actor-turn'; afterTurnIndex = nextIndex; afterActiveCombatantKey = combat.turnOrder[nextIndex]
      }
    } else {
      if (combat.phase !== 'action-resolved') fail('战斗只能在行动结算后进入终态')
      const outcome = input.intent === 'finish-victory' ? 'victory' : input.intent === 'finish-defeat' ? 'defeat' : 'escaped'
      if (modules.actions.version >= 11) {
        if (outcome === 'victory' && (input.state.player.health <= 0 || combat.enemies.some(enemy => !enemy.defeated))) fail('只有击败全部敌人后才能胜利')
        if (outcome === 'defeat' && input.state.player.health > 0) fail('只有玩家生命归零后才能战败')
        if (outcome === 'escaped' && combat.lastAction?.kind !== 'escape') fail('只有已结算逃跑行动才能退出战斗')
        if (modules.combat.sourceVersion === 3) {
          removedPlayerStatusKeys = modules.combat.transientPlayerStatusKeys.filter(statusKey => input.state.player.statusKeys.includes(statusKey))
        }
      }
      if (outcome === 'escaped') {
        const encounter = modules.combat.encounters.find(item => item.key === combat.encounterKey)!
        if (!encounter.escapePolicy.allowed) fail('该遭遇不允许逃跑')
      }
      afterStatus = outcome; afterPhase = 'terminal'; afterTurnIndex = null; afterActiveCombatantKey = null
    }
    let afterActorTurnOrdinalByCombatantKey: Record<string, number> | undefined
    let afterStatusInstancesByCombatantKey: TextOpenWorldCombatRuntimeStateV2['statusInstancesByCombatantKey'] | undefined
    if (isTextOpenWorldCombatRuntimeStateV2(combat)) {
      if (modules.progression.version !== 2) fail('CombatRuntimeState v2缺少Progression v2')
      let nextCombat: TextOpenWorldCombatRuntimeStateV2 = {
        ...structuredClone(combat),
        status: afterStatus,
        phase: afterPhase,
        round: afterRound,
        turnIndex: afterTurnIndex,
        activeCombatantKey: afterActiveCombatantKey,
      }
      if (input.intent === 'complete-turn') {
        const completedCombatantKey = combat.activeCombatantKey ?? fail('完成行动缺少战斗员')
        nextCombat = settleTextOpenWorldCombatStatusesAfterTurnV2({
          combat: nextCombat,
          progression: modules.progression,
          combatantKey: completedCombatantKey,
        }).combat
      }
      if ((input.intent === 'begin-turn' || input.intent === 'advance-turn') && afterPhase === 'actor-turn') {
        const begunCombatantKey = afterActiveCombatantKey ?? fail('开始行动缺少战斗员')
        nextCombat = beginTextOpenWorldCombatantTurnV2({
          combat: nextCombat,
          progression: modules.progression,
          combatantKey: begunCombatantKey,
        })
      }
      if (afterPhase === 'terminal') {
        nextCombat = clearTextOpenWorldCombatStatusesAtTerminalV2({ combat: nextCombat, progression: modules.progression })
      }
      afterActorTurnOrdinalByCombatantKey = structuredClone(nextCombat.actorTurnOrdinalByCombatantKey)
      afterStatusInstancesByCombatantKey = structuredClone(nextCombat.statusInstancesByCombatantKey)
    }
    return {
      kind: 'combat-transition', instanceKey: combat.instanceKey, encounterKey: combat.encounterKey, intent: input.intent,
      beforePhase: combat.phase, beforeRound: combat.round, beforeTurnIndex: combat.turnIndex,
      beforeActiveCombatantKey: combat.activeCombatantKey,
      afterStatus, afterPhase, afterRound, afterTurnIndex, afterActiveCombatantKey,
      ...(modules.combat.sourceVersion === 3 ? { removedPlayerStatusKeys } : {}),
      ...(isTextOpenWorldCombatRuntimeStateV2(combat) ? {
        combatRuntimeVersion: 2 as const,
        afterActorTurnOrdinalByCombatantKey: afterActorTurnOrdinalByCombatantKey!,
        afterStatusInstancesByCombatantKey: afterStatusInstancesByCombatantKey!,
      } : {}),
    }
  }

  const assertAuthorization = (input: {
    state: TextOpenWorldEffectStateV1
    authorization: TextOpenWorldCombatTransitionAuthorizationV1
  }) => {
    const expected = prepare({ state: input.state, intent: input.authorization.intent })
    if (canonicalProductProductionJsonV2(expected) !== canonicalProductProductionJsonV2(input.authorization)) fail('战斗阶段授权与当前状态不一致')
  }

  const applyAuthorization = (input: {
    state: TextOpenWorldEffectStateV1
    authorization: TextOpenWorldCombatTransitionAuthorizationV1
  }): TextOpenWorldModernCombatRuntimeState => {
    assertAuthorization(input)
    const combat = structuredClone(input.state.combat) as TextOpenWorldModernCombatRuntimeState
    combat.status = input.authorization.afterStatus
    combat.phase = input.authorization.afterPhase
    combat.round = input.authorization.afterRound
    combat.turnIndex = input.authorization.afterTurnIndex
    combat.activeCombatantKey = input.authorization.afterActiveCombatantKey
    if (isTextOpenWorldCombatRuntimeStateV2(combat)) {
      if (input.authorization.combatRuntimeVersion !== 2
        || !input.authorization.afterActorTurnOrdinalByCombatantKey
        || !input.authorization.afterStatusInstancesByCombatantKey) {
        fail('CombatRuntimeState v2阶段授权缺少状态快照')
      }
      combat.actorTurnOrdinalByCombatantKey = structuredClone(input.authorization.afterActorTurnOrdinalByCombatantKey)
      combat.statusInstancesByCombatantKey = structuredClone(input.authorization.afterStatusInstancesByCombatantKey)
    } else if (input.authorization.combatRuntimeVersion !== undefined
      || input.authorization.afterActorTurnOrdinalByCombatantKey !== undefined
      || input.authorization.afterStatusInstancesByCombatantKey !== undefined) {
      fail('旧CombatRuntimeState不能应用v2状态快照')
    }
    if (input.authorization.removedPlayerStatusKeys) {
      const removed = new Set(input.authorization.removedPlayerStatusKeys)
      input.state.player.statusKeys = input.state.player.statusKeys.filter(statusKey => !removed.has(statusKey))
    }
    const state = structuredClone(input.state)
    state.combat = combat
    if (combat.status === 'defeat') state.player.health = 0
    validateTextOpenWorldCombatRuntimeStateV1({ modules, state })
    return combat
  }

  const nextSystemIntent = (state: TextOpenWorldEffectStateV1): TextOpenWorldCombatTransitionIntentV1 | null => {
    const combat = validateTextOpenWorldCombatRuntimeStateV1({ modules, state })
    if (!combat || combat.status !== 'active') return null
    if (combat.phase === 'started' || combat.phase === 'round-end') return 'begin-round'
    if (combat.phase === 'round-start') return 'begin-turn'
    if (combat.phase === 'action-resolved') {
      if (combat.lastAction?.kind === 'escape') return 'finish-escaped'
      if (modules.actions.version >= 11 && state.player.health === 0) return 'finish-defeat'
      if (modules.actions.version >= 11 && combat.enemies.every(enemy => enemy.defeated)) return 'finish-victory'
      return 'advance-turn'
    }
    return null
  }

  return { initialize, prepare, assertAuthorization, applyAuthorization, nextSystemIntent }
}
