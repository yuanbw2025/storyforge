import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import type {
  TextOpenWorldCombatActionAuthorizationV1,
  TextOpenWorldCombatActionKindV1,
  TextOpenWorldCombatRuntimeStateV1,
  TextOpenWorldEffectDefinitionV1,
  TextOpenWorldEffectStateV1,
  TextOpenWorldParsedModulesV1,
  TextOpenWorldRuntimePackageV1,
} from '../types'
import { deriveTextOpenWorldInventoryQuantitiesV1 } from './inventory'
import { parseTextOpenWorldModulesV1 } from './modules'
import { createTextOpenWorldSkillCatalogV1 } from './skills'
import {
  isTextOpenWorldCombatRuntimeStateV1,
  validateTextOpenWorldCombatRuntimeStateV1,
} from './combat-state-machine'

const PLAYER_ACTION_CATEGORIES = new Set(['combat-basic-attack', 'combat-skill', 'combat-item', 'escape'])

function fail(message: string): never { throw new Error(`[text-open-world-combat-action] ${message}`) }
function unique(values: readonly string[]): string[] { return [...new Set(values)] }

function performEffect(
  modules: TextOpenWorldParsedModulesV1,
  actionKey: string,
): Extract<TextOpenWorldEffectDefinitionV1, { operation: 'perform-combat-action' }> {
  const action = modules.actions.actions.find(item => item.key === actionKey) ?? fail(`战斗Action不存在:${actionKey}`)
  const effects = [...action.costEffectKeys, ...action.successEffectKeys]
    .map(effectKey => modules.actions.effects.find(effect => effect.key === effectKey) ?? fail(`战斗Action引用Effect不存在:${effectKey}`))
    .filter((effect): effect is Extract<TextOpenWorldEffectDefinitionV1, { operation: 'perform-combat-action' }> => effect.operation === 'perform-combat-action')
  if (effects.length !== 1) fail(`战斗Action必须绑定唯一perform-combat-action Effect:${actionKey}`)
  return effects[0]
}

function combatV10(input: {
  modules: TextOpenWorldParsedModulesV1
  state: TextOpenWorldEffectStateV1
}): TextOpenWorldCombatRuntimeStateV1 {
  if (input.modules.actions.version < 10) fail('旧Action版本没有正式战斗操作合同')
  const combat = validateTextOpenWorldCombatRuntimeStateV1(input) ?? fail('当前没有Combat v2战斗')
  if (combat.status !== 'active' || combat.phase !== 'actor-turn' || combat.turnIndex == null || !combat.activeCombatantKey) fail('当前不是可提交行动的战斗回合')
  if (!combat.cooldownUntilRoundBySkillKey || combat.lastAction === undefined
    || combat.enemies.some(enemy => !enemy.cooldownUntilRoundBySkillKey)) fail('Action v10战斗投影字段缺失')
  return combat
}

function remainingCooldowns(
  modules: TextOpenWorldParsedModulesV1,
  combat: TextOpenWorldCombatRuntimeStateV1,
  actorCombatantKey: string,
): Record<string, number> {
  const readyRounds = actorCombatantKey === 'player'
    ? combat.cooldownUntilRoundBySkillKey!
    : combat.enemies.find(enemy => enemy.combatantKey === actorCombatantKey)?.cooldownUntilRoundBySkillKey ?? fail('敌人行动者不存在')
  return Object.fromEntries(modules.progression.skills.map(skill => [skill.key, Math.max(0, (readyRounds[skill.key] ?? 0) - combat.round)]))
}

function targetsFor(input: {
  modules: TextOpenWorldParsedModulesV1
  state: TextOpenWorldEffectStateV1
  combat: TextOpenWorldCombatRuntimeStateV1
  actionKind: TextOpenWorldCombatActionKindV1
  skillKey: string | null
  targetKey: string | null
}): string[] {
  if (input.actionKind === 'escape') return []
  if (input.actionKind === 'item') return ['player']
  if (input.actionKind === 'enemy-skill') return ['player']
  const skill = input.modules.progression.skills.find(item => item.key === input.skillKey) ?? fail(`战斗技能不存在:${String(input.skillKey)}`)
  if (skill.target === 'self') {
    if (input.targetKey != null) fail('自身技能不能指定敌人目标')
    return ['player']
  }
  const aliveEnemies = input.combat.enemies.filter(enemy => !enemy.defeated).map(enemy => enemy.combatantKey)
  if (!aliveEnemies.length) fail('当前没有可选敌人目标')
  if (skill.target === 'all-enemies') {
    if (input.targetKey != null) fail('全体技能不能指定单个敌人目标')
    return aliveEnemies
  }
  if (!input.targetKey || !aliveEnemies.includes(input.targetKey)) fail('单体技能缺少存活敌人目标')
  return [input.targetKey]
}

export function createTextOpenWorldCombatActionCatalogV1(
  value: TextOpenWorldRuntimePackageV1 | string | unknown,
  parsedModules?: TextOpenWorldParsedModulesV1,
) {
  const modules = parsedModules ?? parseTextOpenWorldModulesV1(value)
  const prepare = (input: {
    state: TextOpenWorldEffectStateV1
    actionKey: string
    targetKey: string | null
    actorKey: 'player' | 'system'
    conditionResults: Record<string, boolean>
  }): TextOpenWorldCombatActionAuthorizationV1 => {
    const combat = combatV10({ modules, state: input.state })
    const action = modules.actions.actions.find(item => item.key === input.actionKey) ?? fail(`Action不存在:${input.actionKey}`)
    const effect = performEffect(modules, action.key)
    const actionKind = effect.payload.kind
    const playerAction = PLAYER_ACTION_CATEGORIES.has(action.category)
    if (playerAction !== (input.actorKey === 'player') || (input.actorKey === 'system') !== (action.category === 'combat-enemy-skill')) fail('战斗Action操作者或类别无效')
    const beforeActiveCombatantKey = combat.activeCombatantKey ?? fail('战斗Action缺少activeCombatantKey')
    const expectedActorCombatantKey = input.actorKey === 'player' ? 'player' : beforeActiveCombatantKey
    if (combat.activeCombatantKey !== expectedActorCombatantKey) fail('只能由当前行动者提交战斗Action')
    if (action.requirementConditionKeys.some(conditionKey => input.conditionResults[conditionKey] !== true)) fail('战斗Action条件未满足')
    const beforeTurnIndex = combat.turnIndex ?? fail('战斗Action缺少turnIndex')

    let resourceCost = 0
    let cooldownTurns = 0
    if (actionKind === 'basic-attack' || actionKind === 'skill' || actionKind === 'enemy-skill') {
      const skill = modules.progression.skills.find(item => item.key === effect.payload.skillKey) ?? fail(`战斗技能不存在:${String(effect.payload.skillKey)}`)
      if (skill.activation !== 'active') fail('战斗不能主动使用被动技能')
      if (input.actorKey === 'player') {
        const prepared = createTextOpenWorldSkillCatalogV1(value).prepare({
          learnedSkillKeys: input.state.player.learnedSkillKeys,
          skillResource: input.state.player.skillResource,
          cooldownRemainingTurnsBySkillKey: remainingCooldowns(modules, combat, 'player'),
          conditionResults: input.conditionResults,
          skillKey: skill.key,
        })
        resourceCost = prepared.resourceCost
        cooldownTurns = prepared.cooldownTurns
      } else {
        const enemy = combat.enemies.find(item => item.combatantKey === combat.activeCombatantKey) ?? fail('当前敌人行动者不存在')
        const definition = modules.combat.enemies.find(item => item.key === enemy.enemyKey)!
        if (!definition.skillKeys.includes(skill.key)) fail('敌人不能使用未声明技能')
        if ((enemy.cooldownUntilRoundBySkillKey?.[skill.key] ?? 0) > combat.round) fail('敌人技能仍在冷却')
        resourceCost = skill.resourceCost
        cooldownTurns = skill.cooldownTurns
      }
    } else if (actionKind === 'item') {
      const itemKey = effect.payload.itemKey ?? fail('战斗道具Action缺少itemKey')
      const item = modules.items.items.find(candidate => candidate.key === itemKey) ?? fail(`战斗道具不存在:${itemKey}`)
      if (!item.consumable || (deriveTextOpenWorldInventoryQuantitiesV1(modules, input.state.inventory)[itemKey] ?? 0) < 1) fail('战斗道具当前不可用')
      if (input.targetKey !== itemKey) fail('战斗道具命令目标不一致')
    } else if (actionKind === 'escape') {
      const encounter = modules.combat.encounters.find(item => item.key === combat.encounterKey)!
      if (!encounter.escapePolicy.allowed) fail('该遭遇不允许逃跑')
      if (input.targetKey != null) fail('逃跑Action不能指定目标')
    }

    const effectKeys = unique([...action.costEffectKeys, ...action.successEffectKeys])
    const cooldownUntilRound = combat.round + cooldownTurns
    return {
      kind: 'combat-action', instanceKey: combat.instanceKey, encounterKey: combat.encounterKey,
      actionKey: action.key, actorKey: input.actorKey, actorCombatantKey: expectedActorCombatantKey,
      actionKind, skillKey: effect.payload.skillKey, itemKey: effect.payload.itemKey,
      targetCombatantKeys: targetsFor({ modules, state: input.state, combat, actionKind, skillKey: effect.payload.skillKey, targetKey: input.targetKey }),
      beforePhase: 'actor-turn', beforeRound: combat.round, beforeTurnIndex,
      beforeActiveCombatantKey,
      effectKeys, resourceCost, cooldownTurns, cooldownUntilRound,
      afterSkillResource: input.actorKey === 'player' ? input.state.player.skillResource - resourceCost : input.state.player.skillResource,
    }
  }

  const assertAuthorization = (input: {
    state: TextOpenWorldEffectStateV1
    authorization: TextOpenWorldCombatActionAuthorizationV1
    conditionResults?: Record<string, boolean>
  }) => {
    const expected = prepare({
      state: input.state,
      actionKey: input.authorization.actionKey,
      targetKey: input.authorization.actionKind === 'item'
        ? input.authorization.itemKey
        : input.authorization.targetCombatantKeys.length === 1 && input.authorization.targetCombatantKeys[0] !== 'player'
          ? input.authorization.targetCombatantKeys[0]
          : null,
      actorKey: input.authorization.actorKey,
      conditionResults: input.conditionResults ?? Object.fromEntries(modules.actions.conditions.map(condition => [condition.key, true])),
    })
    if (canonicalProductProductionJsonV2(expected) !== canonicalProductProductionJsonV2(input.authorization)) fail('战斗行动授权与当前状态不一致')
  }

  const applyAuthorization = (input: {
    beforeState: TextOpenWorldEffectStateV1
    state: TextOpenWorldEffectStateV1
    authorization: TextOpenWorldCombatActionAuthorizationV1
  }): TextOpenWorldCombatRuntimeStateV1 => {
    assertAuthorization({ state: input.beforeState, authorization: input.authorization })
    const combat = structuredClone(input.state.combat)
    if (!isTextOpenWorldCombatRuntimeStateV1(combat)) fail('战斗行动缺少Combat v2投影')
    if (combat.instanceKey !== input.authorization.instanceKey || combat.phase !== input.authorization.beforePhase
      || combat.round !== input.authorization.beforeRound || combat.turnIndex !== input.authorization.beforeTurnIndex
      || combat.activeCombatantKey !== input.authorization.beforeActiveCombatantKey) fail('战斗行动应用基线已变化')
    if (input.state.player.skillResource !== input.authorization.afterSkillResource) fail('战斗行动资源消耗与授权不一致')
    combat.phase = 'action-resolved'
    combat.lastAction = {
      actionKey: input.authorization.actionKey,
      actorCombatantKey: input.authorization.actorCombatantKey,
      kind: input.authorization.actionKind,
      skillKey: input.authorization.skillKey,
      itemKey: input.authorization.itemKey,
      targetCombatantKeys: [...input.authorization.targetCombatantKeys],
      round: input.authorization.beforeRound,
      turnIndex: input.authorization.beforeTurnIndex,
    }
    if (input.authorization.skillKey && input.authorization.cooldownTurns > 0) {
      const cooldowns = input.authorization.actorCombatantKey === 'player'
        ? combat.cooldownUntilRoundBySkillKey!
        : combat.enemies.find(enemy => enemy.combatantKey === input.authorization.actorCombatantKey)?.cooldownUntilRoundBySkillKey ?? fail('敌人冷却投影不存在')
      cooldowns[input.authorization.skillKey] = input.authorization.cooldownUntilRound
    }
    const verificationState = structuredClone(input.state)
    verificationState.combat = combat
    validateTextOpenWorldCombatRuntimeStateV1({ modules, state: verificationState })
    return combat
  }

  const nextEnemyAction = (state: TextOpenWorldEffectStateV1): { actionKey: string; targetKey: null } | null => {
    const combat = combatV10({ modules, state })
    if (combat.activeCombatantKey === 'player') return null
    const enemy = combat.enemies.find(item => item.combatantKey === combat.activeCombatantKey) ?? fail('当前敌人行动者不存在')
    const definition = modules.combat.enemies.find(item => item.key === enemy.enemyKey)!
    const strategy = modules.combat.strategyProfiles.find(item => item.key === definition.strategyProfileKey)!
    const skillKey = strategy.prioritySkillKeys.find(candidate => (enemy.cooldownUntilRoundBySkillKey?.[candidate] ?? 0) <= combat.round)
      ?? strategy.fallbackSkillKey
    const owners = modules.actions.actions.filter(action => action.category === 'combat-enemy-skill'
      && performEffect(modules, action.key).payload.skillKey === skillKey)
    if (owners.length !== 1) fail(`敌人技能必须对应唯一系统战斗Action:${skillKey}`)
    return { actionKey: owners[0].key, targetKey: null }
  }

  return { prepare, assertAuthorization, applyAuthorization, nextEnemyAction, remainingCooldowns: (state: TextOpenWorldEffectStateV1) => {
    const combat = combatV10({ modules, state })
    return remainingCooldowns(modules, combat, 'player')
  } }
}
