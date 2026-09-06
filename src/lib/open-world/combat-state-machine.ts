import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import type {
  TextOpenWorldCombatRuntimeStateV1,
  TextOpenWorldCombatTransitionAuthorizationV1,
  TextOpenWorldCombatTransitionIntentV1,
  TextOpenWorldEffectStateV1,
  TextOpenWorldParsedModulesV1,
  TextOpenWorldRuntimePackageV1,
} from '../types'
import { deriveTextOpenWorldEquippedItemKeysV1 } from './inventory'
import { parseTextOpenWorldModulesV1 } from './modules'
import { deriveTextOpenWorldPlayerStatsFromModulesV1 } from './player-stats'

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
    }))
  })
}

function orderFor(combat: Pick<TextOpenWorldCombatRuntimeStateV1, 'playerInitiative' | 'enemies'>): string[] {
  return [
    { combatantKey: 'player', initiative: combat.playerInitiative, sideOrder: 0 },
    ...combat.enemies.map(enemy => ({ combatantKey: enemy.combatantKey, initiative: enemy.initiative, sideOrder: 1 })),
  ].sort((left, right) => right.initiative - left.initiative
    || left.sideOrder - right.sideOrder
    || left.combatantKey.localeCompare(right.combatantKey))
    .map(item => item.combatantKey)
}

function alive(combat: TextOpenWorldCombatRuntimeStateV1, playerHealth: number, combatantKey: string): boolean {
  return combatantKey === 'player'
    ? playerHealth > 0
    : combat.enemies.find(enemy => enemy.combatantKey === combatantKey)?.defeated === false
}

export function validateTextOpenWorldCombatRuntimeStateV1(input: {
  modules: TextOpenWorldParsedModulesV1
  state: TextOpenWorldEffectStateV1
}): TextOpenWorldCombatRuntimeStateV1 | null {
  const combat = input.state.combat
  if (combat == null) return null
  if (!isTextOpenWorldCombatRuntimeStateV1(combat)) {
    if (input.modules.combat.sourceVersion !== 1) fail('Combat v2 Session不能使用旧战斗投影')
    if (!input.modules.combat.encounters.some(item => item.key === combat.encounterKey)) fail(`旧战斗遭遇不存在:${combat.encounterKey}`)
    if (!['active', 'victory', 'defeat', 'escaped'].includes(combat.status)) fail('旧战斗状态无效')
    return null
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
  })
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
  return combat
}

export function createTextOpenWorldCombatStateMachineV1(
  value: TextOpenWorldRuntimePackageV1 | string | unknown,
  parsedModules?: TextOpenWorldParsedModulesV1,
) {
  const modules = parsedModules ?? parseTextOpenWorldModulesV1(value)
  const initialize = (input: {
    state: TextOpenWorldEffectStateV1
    encounterKey: string
    instanceKey: string
  }): TextOpenWorldCombatRuntimeStateV1 => {
    if (input.state.player.health <= 0 || input.state.combat?.status === 'active') fail('当前不能开始新战斗')
    if (typeof input.instanceKey !== 'string' || !input.instanceKey || input.instanceKey.length > 200) fail('combat instanceKey无效')
    const encounter = modules.combat.encounters.find(item => item.key === input.encounterKey) ?? fail(`遭遇不存在:${input.encounterKey}`)
    const playerStats = deriveTextOpenWorldPlayerStatsFromModulesV1({
      modules,
      level: input.state.player.level,
      attributes: input.state.player.attributes,
      equippedItemKeyBySlot: deriveTextOpenWorldEquippedItemKeysV1(modules, input.state.inventory),
    })
    const enemies = expectedEnemies(modules, encounter.key)
    const combat: TextOpenWorldCombatRuntimeStateV1 = {
      version: 1,
      instanceKey: input.instanceKey,
      encounterKey: encounter.key,
      status: 'active',
      phase: 'started',
      round: 0,
      turnIndex: null,
      activeCombatantKey: null,
      playerInitiative: playerStats.initiative,
      turnOrder: [],
      enemies,
    }
    combat.turnOrder = orderFor(combat)
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
    let afterStatus: TextOpenWorldCombatRuntimeStateV1['status'] = combat.status
    let afterPhase: TextOpenWorldCombatRuntimeStateV1['phase'] = combat.phase
    let afterRound = combat.round
    let afterTurnIndex = combat.turnIndex
    let afterActiveCombatantKey = combat.activeCombatantKey
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
      if (outcome === 'escaped') {
        const encounter = modules.combat.encounters.find(item => item.key === combat.encounterKey)!
        if (!encounter.escapePolicy.allowed) fail('该遭遇不允许逃跑')
      }
      afterStatus = outcome; afterPhase = 'terminal'; afterTurnIndex = null; afterActiveCombatantKey = null
    }
    return {
      kind: 'combat-transition', instanceKey: combat.instanceKey, encounterKey: combat.encounterKey, intent: input.intent,
      beforePhase: combat.phase, beforeRound: combat.round, beforeTurnIndex: combat.turnIndex,
      beforeActiveCombatantKey: combat.activeCombatantKey,
      afterStatus, afterPhase, afterRound, afterTurnIndex, afterActiveCombatantKey,
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
  }): TextOpenWorldCombatRuntimeStateV1 => {
    assertAuthorization(input)
    const combat = structuredClone(input.state.combat) as TextOpenWorldCombatRuntimeStateV1
    combat.status = input.authorization.afterStatus
    combat.phase = input.authorization.afterPhase
    combat.round = input.authorization.afterRound
    combat.turnIndex = input.authorization.afterTurnIndex
    combat.activeCombatantKey = input.authorization.afterActiveCombatantKey
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
    if (combat.phase === 'action-resolved') return 'advance-turn'
    return null
  }

  return { initialize, prepare, assertAuthorization, applyAuthorization, nextSystemIntent }
}
