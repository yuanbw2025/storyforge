import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import type {
  TextOpenWorldCombatActionAuthorizationV1,
  TextOpenWorldCombatActionKindV1,
  TextOpenWorldCombatRuntimeStateV1,
  TextOpenWorldCombatTargetResolutionV1,
  TextOpenWorldEffectDefinitionV1,
  TextOpenWorldEffectStateV1,
  TextOpenWorldParsedModulesV1,
  TextOpenWorldRandomEvidenceV1,
  TextOpenWorldRandomRequestV1,
  TextOpenWorldRuntimePackageV1,
} from '../types'
import { deriveTextOpenWorldEquippedItemKeysV1, deriveTextOpenWorldInventoryQuantitiesV1 } from './inventory'
import { parseTextOpenWorldRandomEvidenceV1 } from './event-contract'
import { parseTextOpenWorldModulesV1 } from './modules'
import { deriveTextOpenWorldPlayerStatsFromModulesV1 } from './player-stats'
import { createTextOpenWorldSkillCatalogV1 } from './skills'
import {
  isTextOpenWorldCombatRuntimeStateV1,
  validateTextOpenWorldCombatRuntimeStateV1,
} from './combat-state-machine'

const PLAYER_ACTION_CATEGORIES = new Set(['combat-basic-attack', 'combat-skill', 'combat-item', 'escape'])

function fail(message: string): never { throw new Error(`[text-open-world-combat-action] ${message}`) }
function unique(values: readonly string[]): string[] { return [...new Set(values)] }

type CombatActionInput = {
  state: TextOpenWorldEffectStateV1
  actionKey: string
  targetKey: string | null
  actorKey: 'player' | 'system'
  conditionResults: Record<string, boolean>
  evidence?: TextOpenWorldRandomEvidenceV1[]
}

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
  const prepareBase = (input: CombatActionInput): TextOpenWorldCombatActionAuthorizationV1 => {
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

  const randomRequestsForBase = (authorization: TextOpenWorldCombatActionAuthorizationV1): TextOpenWorldRandomRequestV1[] => {
    if (modules.actions.version < 11) return []
    const skill = authorization.skillKey
      ? modules.progression.skills.find(item => item.key === authorization.skillKey) ?? fail(`战斗技能不存在:${authorization.skillKey}`)
      : null
    if (!skill || skill.kind !== 'attack') return []
    return authorization.targetCombatantKeys.map(targetCombatantKey => ({
      drawKey: `combat.critical.${authorization.beforeRound}.${authorization.beforeTurnIndex}.${authorization.actorCombatantKey}.${targetCombatantKey}`,
      minimumInclusive: 1,
      maximumInclusive: modules.combat.resolution.criticalRollMaximum,
    }))
  }

  const randomRequestsFor = (input: Omit<CombatActionInput, 'evidence'>): TextOpenWorldRandomRequestV1[] => (
    randomRequestsForBase(prepareBase(input))
  )

  const targetResolutionsFor = (input: {
    state: TextOpenWorldEffectStateV1
    authorization: TextOpenWorldCombatActionAuthorizationV1
    evidence: TextOpenWorldRandomEvidenceV1[]
  }): TextOpenWorldCombatTargetResolutionV1[] => {
    const skillKey = input.authorization.skillKey
    const skill = skillKey ? modules.progression.skills.find(item => item.key === skillKey) ?? fail(`战斗技能不存在:${skillKey}`) : null
    if (!skill || skill.kind !== 'attack') {
      if (input.evidence.length) fail('非伤害战斗行动不能包含随机证据')
      return []
    }
    const skillResolution = modules.combat.skillResolutions.find(item => item.skillKey === skill.key)
      ?? fail(`攻击技能缺少冻结伤害公式:${skill.key}`)
    const requests = randomRequestsForBase(input.authorization)
    if (input.evidence.length !== requests.length) fail('战斗随机证据数量不一致')
    const parsedEvidence = input.evidence.map((item, index) => {
      const evidence = parseTextOpenWorldRandomEvidenceV1(item, `combat.evidence[${index}]`)
      const request = requests[index]
      if (evidence.drawIndex !== index
        || evidence.drawKey !== request.drawKey
        || evidence.minimumInclusive !== request.minimumInclusive
        || evidence.maximumInclusive !== request.maximumInclusive) fail(`战斗随机证据与请求不一致:${index}`)
      return evidence
    })
    const playerStats = deriveTextOpenWorldPlayerStatsFromModulesV1({
      modules,
      level: input.state.player.level,
      attributes: input.state.player.attributes,
      equippedItemKeyBySlot: deriveTextOpenWorldEquippedItemKeysV1(modules, input.state.inventory),
    })
    const actorEnemy = input.authorization.actorCombatantKey === 'player'
      ? null
      : input.state.combat && 'version' in input.state.combat
        ? input.state.combat.enemies.find(enemy => enemy.combatantKey === input.authorization.actorCombatantKey) ?? fail('伤害行动者敌人不存在')
        : fail('伤害结算缺少新版战斗投影')
    const actorDefinition = actorEnemy ? modules.combat.enemies.find(enemy => enemy.key === actorEnemy.enemyKey) ?? fail('伤害行动者定义不存在') : null
    const attack = Math.floor(actorDefinition?.attack ?? playerStats.attack)
    const criticalChance = actorDefinition?.criticalChance ?? playerStats.criticalChance
    const criticalChanceBasisPoints = Math.min(
      modules.combat.resolution.criticalChanceCapBasisPoints,
      Math.max(0, Math.round(criticalChance * modules.combat.resolution.criticalRollMaximum)),
    )
    return input.authorization.targetCombatantKeys.map((targetCombatantKey, index) => {
      const targetEnemy = targetCombatantKey === 'player'
        ? null
        : input.state.combat && 'version' in input.state.combat
          ? input.state.combat.enemies.find(enemy => enemy.combatantKey === targetCombatantKey) ?? fail(`伤害目标不存在:${targetCombatantKey}`)
          : fail('伤害结算缺少新版战斗投影')
      const targetDefinition = targetEnemy ? modules.combat.enemies.find(enemy => enemy.key === targetEnemy.enemyKey) ?? fail('伤害目标定义不存在') : null
      const defense = Math.floor(targetDefinition?.defense ?? playerStats.defense)
      const beforeHealth = Math.floor(targetEnemy?.currentHealth ?? input.state.player.health)
      if (beforeHealth <= 0) fail(`不能伤害已经战败的目标:${targetCombatantKey}`)
      const damageBeforeDefense = Math.min(
        modules.combat.resolution.maximumDamage,
        Math.floor(attack * skillResolution.powerNumerator / skillResolution.powerDenominator) + skillResolution.flatDamage,
      )
      const damageAfterDefense = Math.min(
        modules.combat.resolution.maximumDamage,
        Math.max(modules.combat.resolution.minimumDamage, damageBeforeDefense - defense),
      )
      const criticalDrawValue = parsedEvidence[index].value
      const critical = criticalChanceBasisPoints > 0 && criticalDrawValue <= criticalChanceBasisPoints
      const computedDamage = Math.min(
        modules.combat.resolution.maximumDamage,
        critical
          ? Math.floor(damageAfterDefense * modules.combat.resolution.criticalMultiplierNumerator / modules.combat.resolution.criticalMultiplierDenominator)
          : damageAfterDefense,
      )
      const appliedDamage = Math.min(beforeHealth, computedDamage)
      const afterHealth = beforeHealth - appliedDamage
      return {
        targetCombatantKey, attack, defense,
        powerNumerator: skillResolution.powerNumerator,
        powerDenominator: skillResolution.powerDenominator,
        flatDamage: skillResolution.flatDamage,
        damageBeforeDefense, damageAfterDefense,
        criticalChanceBasisPoints, criticalDrawValue, critical,
        computedDamage, appliedDamage, beforeHealth, afterHealth,
        defeated: afterHealth === 0,
      }
    })
  }

  const prepare = (input: CombatActionInput): TextOpenWorldCombatActionAuthorizationV1 => {
    const authorization = prepareBase(input)
    if (modules.actions.version < 11) {
      if (input.evidence?.length) fail('Action v10战斗不能包含随机证据')
      return authorization
    }
    const randomRequests = randomRequestsForBase(authorization)
    const evidence = input.evidence ?? fail('Action v11战斗行动缺少随机证据')
    const targetResolutions = targetResolutionsFor({ state: input.state, authorization, evidence })
    const statusEffectKeys = authorization.effectKeys.filter(effectKey => {
      const effect = modules.actions.effects.find(item => item.key === effectKey)!
      return effect.operation === 'apply-status' || effect.operation === 'remove-status'
    })
    return {
      ...authorization,
      resolutionVersion: 1,
      randomRequests,
      targetResolutions,
      statusEffectKeys,
    }
  }

  const assertAuthorization = (input: {
    state: TextOpenWorldEffectStateV1
    authorization: TextOpenWorldCombatActionAuthorizationV1
    conditionResults?: Record<string, boolean>
    evidence?: TextOpenWorldRandomEvidenceV1[]
  }) => {
    let evidence = input.evidence
    if (modules.actions.version >= 11 && !evidence) {
      if (input.authorization.resolutionVersion !== 1 || !input.authorization.randomRequests || !input.authorization.targetResolutions) fail('Action v11战斗授权缺少结算字段')
      evidence = input.authorization.randomRequests.map((request, index) => ({
        ...request,
        algorithm: 'sha256-range-v1' as const,
        seedHash: '0'.repeat(64),
        inputHash: '0'.repeat(64),
        drawIndex: index,
        value: input.authorization.targetResolutions?.[index]?.criticalDrawValue ?? fail(`战斗授权缺少随机结果:${index}`),
      }))
    }
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
      evidence,
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
      ...(input.authorization.resolutionVersion === 1
        ? { targetResolutions: structuredClone(input.authorization.targetResolutions ?? []) }
        : {}),
    }
    for (const resolution of input.authorization.targetResolutions ?? []) {
      if (resolution.targetCombatantKey === 'player') {
        if (input.state.player.health !== resolution.beforeHealth) fail('玩家伤害应用基线已变化')
        input.state.player.health = resolution.afterHealth
      } else {
        const enemy = combat.enemies.find(item => item.combatantKey === resolution.targetCombatantKey) ?? fail('敌人伤害目标不存在')
        if (enemy.currentHealth !== resolution.beforeHealth) fail('敌人伤害应用基线已变化')
        enemy.currentHealth = resolution.afterHealth
        enemy.defeated = resolution.defeated
      }
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

  return { prepare, randomRequestsFor, assertAuthorization, applyAuthorization, nextEnemyAction, remainingCooldowns: (state: TextOpenWorldEffectStateV1) => {
    const combat = combatV10({ modules, state })
    return remainingCooldowns(modules, combat, 'player')
  } }
}
