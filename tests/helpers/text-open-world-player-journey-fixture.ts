import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import {
  freezeTextOpenWorldRuntimeModuleV1,
} from '../../src/lib/open-world/runtime-package-production'
import { parseTextOpenWorldRuntimePackageV1 } from '../../src/lib/open-world/runtime-package'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import {
  TEXT_OPEN_WORLD_RUNTIME_MODULE_KEYS_V1,
  type TextOpenWorldParsedModulesV1,
  type TextOpenWorldRuntimePackageV1,
} from '../../src/lib/types'
import { createTextOpenWorldVNextP9Fixture } from './text-open-world-vnext-fixture'

export const TEXT_OPEN_WORLD_PLAYER_JOURNEY_KEYS_V1 = {
  finalQuestKey: 'quest.main.1',
  finalResolutionSceneKey: 'scene.resolution.main',
  finalObjectiveSceneKey: 'scene.objective.main.1',
  completeMainObjectiveActionKey: 'action.complete-main-objective',
  completeMainObjectiveChoiceKey: 'choice.complete-main-objective',
  claimActionKey: 'action.claim-main-reward',
  endingKeys: ['ending.cooperate', 'ending.control'],
  endingActionKeys: ['action.ending.ending.cooperate', 'action.ending.ending.control'],
  endingChoiceKeys: ['choice.ending.ending.cooperate', 'choice.ending.ending.control'],
  encounterKey: 'encounter.ridge-jackal',
  enemyKey: 'enemy.salt-jackal',
  craftMaterialKey: 'item.salt-crystal',
  recipeKey: 'recipe.brine-tonic',
  vendorKey: 'vendor.caretaker',
} as const

export interface TextOpenWorldPlayerJourneyFixtureV1 {
  runtimePackage: TextOpenWorldRuntimePackageV1
  parsedModules: TextOpenWorldParsedModulesV1
  packageHash: string
  keys: typeof TEXT_OPEN_WORLD_PLAYER_JOURNEY_KEYS_V1
}

type MutableAction = TextOpenWorldParsedModulesV1['actions']['actions'][number]

function inputBindingFor(
  action: MutableAction,
  order: number,
  fixedChoiceKeys: string[],
  exampleUtterances: string[],
) {
  const systemOnly = action.actorScope === 'system'
  return {
    key: `binding.${action.key}`,
    order,
    actionKey: action.key,
    actionDefinitionHash: '0'.repeat(64),
    actorScope: action.actorScope,
    category: action.category,
    targetScope: action.targetScope,
    systemAction: {
      enabled: !systemOnly,
      label: action.label,
      description: action.description,
      executionSource: 'system-action' as const,
    },
    fixedChoiceKeys,
    naturalLanguage: {
      mode: systemOnly ? 'disabled-system-only' as const : 'existing-action-candidate' as const,
      exampleUtterances: systemOnly ? [] : exampleUtterances,
      candidateMayOnlySelectThisAction: true as const,
      targetResolution: 'current-projection-valid-targets-only' as const,
      highConfidenceLowRisk: 'execute-after-runtime-validation' as const,
      highRiskOrIrreversible: 'require-explicit-confirmation' as const,
      lowConfidence: 'respond-and-recommend-formal-actions' as const,
      mayCreateAction: false as const,
      mayCreateQuest: false as const,
      mayCreateMapContent: false as const,
      mayWriteState: false as const,
    },
    resultAuthority: {
      artifactKey: 'text-open-world.quest-design-documents' as const,
      collection: 'actions' as const,
      actionKey: action.key,
      actionDefinitionHash: '0'.repeat(64),
    },
  }
}

function addBoundAction(
  actions: any,
  action: MutableAction,
  fixedChoiceKeys: string[] = [],
  exampleUtterances: string[] = [`执行${action.label}`, `确认${action.label}`],
): void {
  actions.actions.push(action)
  actions.inputBindings.actions.push(inputBindingFor(
    action,
    actions.inputBindings.actions.length + 1,
    fixedChoiceKeys,
    exampleUtterances,
  ))
}

function upgradeQuestLifecycleToV18(actions: any): void {
  const stagedAbandon = actions.actions.find((action: MutableAction) => (
    action.key === 'action.abandon-supplies'
  )) as MutableAction | undefined
  if (!stagedAbandon) throw new Error('玩家纵向验收夹具缺少普通任务放弃 Action')

  const unstartedEffectKey = 'effect.abandon-supplies-unstarted-player-journey'
  actions.effects.push({
    key: unstartedEffectKey,
    operation: 'transition-quest',
    payload: { questKey: 'quest.template.supplies', status: 'abandoned', stageKey: null },
  })
  addBoundAction(actions, {
    ...structuredClone(stagedAbandon),
    key: 'action.abandon-supplies-unstarted-player-journey',
    label: '开始前放弃物资任务',
    description: '在尚未开始时放弃本轮限时物资委托。',
    successEffectKeys: [unstartedEffectKey],
  })
  actions.version = 18
}

function upgradeStructuredCombatTriplet(runtimePackage: TextOpenWorldRuntimePackageV1): void {
  const progression = runtimePackage.modules.progression.payload as any
  const combat = runtimePackage.modules.combat.payload as any

  progression.version = 2
  progression.skills = progression.skills.map((skill: any) => {
    const { activation: _activation, kind, ...rest } = skill
    if (kind !== 'attack') throw new Error(`玩家纵向验收夹具遇到未定义技能机制:${String(kind)}`)
    return { ...rest, mechanic: { kind: 'attack' } }
  })
  progression.statuses = progression.statuses.map((status: any) => ({
    ...status,
    duration: { clock: 'combat' },
    reapplyPolicy: 'reject',
    maxStacks: 1,
    modifiers: [],
  }))

  combat.version = 4
  delete combat.transientPlayerStatusKeys
  const enemy = combat.enemies.find((candidate: any) => (
    candidate.key === TEXT_OPEN_WORLD_PLAYER_JOURNEY_KEYS_V1.enemyKey
  ))
  if (!enemy) throw new Error('玩家纵向验收夹具缺少指定敌人')
  enemy.maximumHealth = 1
}

function upgradeDirectorToV3(runtimePackage: TextOpenWorldRuntimePackageV1): void {
  const narrative = runtimePackage.modules.narrative.payload as any
  const director = runtimePackage.modules.director.payload as any
  director.version = 3
  director.randomEvents = director.randomEvents.map((event: any) => {
    const scene = narrative.scenes.find((candidate: any) => (
      candidate.sourceKind === 'random-event' && candidate.randomEventKey === event.key
    ))
    if (!scene) throw new Error(`玩家纵向验收夹具缺少随机事件场景:${String(event.key)}`)
    return { ...event, locationKeys: [scene.locationKey] }
  })
}

function bindMainObjectiveCompletion(runtimePackage: TextOpenWorldRuntimePackageV1): void {
  const narrative = runtimePackage.modules.narrative.payload as any
  const actions = runtimePackage.modules.actions.payload as any
  const keys = TEXT_OPEN_WORLD_PLAYER_JOURNEY_KEYS_V1
  const scene = narrative.scenes.find((candidate: any) => (
    candidate.key === keys.finalObjectiveSceneKey
  ))
  if (!scene || scene.sourceKind !== 'quest-objective' || scene.questKey !== keys.finalQuestKey) {
    throw new Error('玩家纵向验收夹具缺少最终主线目标场景')
  }
  const action = actions.actions.find((candidate: MutableAction) => (
    candidate.key === keys.completeMainObjectiveActionKey
  )) as MutableAction | undefined
  if (!action || action.category !== 'objective-action' || action.targetScope !== 'quest') {
    throw new Error('玩家纵向验收夹具缺少主线目标完成 Action')
  }
  const binding = actions.inputBindings.actions.find((candidate: any) => (
    candidate.actionKey === action.key
  ))
  if (!binding) throw new Error('玩家纵向验收夹具缺少主线目标完成 InputBinding')

  scene.actionKeys = [...new Set([...scene.actionKeys, action.key])]
  scene.fixedChoiceKeys = [...new Set([
    ...scene.fixedChoiceKeys,
    keys.completeMainObjectiveChoiceKey,
  ])]
  narrative.fixedChoices.push({
    key: keys.completeMainObjectiveChoiceKey,
    sceneKey: scene.key,
    label: '提交盐渠检查结果',
    description: '把已经查明的水痕与渠壁线索提交给任务状态机，完成当前目标。',
    actionKey: action.key,
  })
  binding.fixedChoiceKeys = [...new Set([
    ...binding.fixedChoiceKeys,
    keys.completeMainObjectiveChoiceKey,
  ])]
}

function addTwoEndingRoutes(runtimePackage: TextOpenWorldRuntimePackageV1): void {
  const narrative = runtimePackage.modules.narrative.payload as any
  const actions = runtimePackage.modules.actions.payload as any
  const selectionReadyConditionKey = 'condition.system.ending-selection-ready'
  actions.conditions.push({
    key: selectionReadyConditionKey,
    expression: {
      op: 'quest-status',
      questKey: TEXT_OPEN_WORLD_PLAYER_JOURNEY_KEYS_V1.finalQuestKey,
      statuses: ['completed'],
    },
    failureMessage: '完成主线最终任务后，才能作出最终选择。',
  })

  const routeSpecs = [
    {
      endingKey: 'ending.cooperate',
      value: '让盐港与断脊共同守渠',
      actionLabel: '选择共管盐渠',
      description: '把盐渠交给两地共同维护，以协商约束未来的分配。',
      utterances: ['我选择让两地共管盐渠', '让盐港与断脊一起守渠'],
    },
    {
      endingKey: 'ending.control',
      value: '让盐港统一接管盐渠',
      actionLabel: '选择港口控渠',
      description: '把盐渠交由盐港统一管理，以集中权力保障供水。',
      utterances: ['我选择让盐港接管盐渠', '由港口统一控制水渠'],
    },
  ] as const

  const resolutionScene = narrative.scenes.find((scene: any) => (
    scene.key === TEXT_OPEN_WORLD_PLAYER_JOURNEY_KEYS_V1.finalResolutionSceneKey
      && scene.sourceKind === 'quest-resolution'
      && scene.questKey === TEXT_OPEN_WORLD_PLAYER_JOURNEY_KEYS_V1.finalQuestKey
  ))
  if (!resolutionScene) throw new Error('玩家纵向验收夹具缺少唯一最终主线收束场景')

  for (const spec of routeSpecs) {
    const conditionKey = `condition.ending.${spec.endingKey}`
    const actionKey = `action.ending.${spec.endingKey}`
    const choiceKey = `choice.ending.${spec.endingKey}`
    const routeEffectKey = `effect.ending.route.${spec.endingKey}`
    const unlockEffectKey = `effect.ending.unlock.${spec.endingKey}`
    const reachEffectKey = `effect.ending.reach.${spec.endingKey}`

    actions.conditions.push({
      key: conditionKey,
      expression: {
        op: 'all',
        conditions: [
          {
            op: 'quest-status',
            questKey: TEXT_OPEN_WORLD_PLAYER_JOURNEY_KEYS_V1.finalQuestKey,
            statuses: ['completed'],
          },
          { op: 'world-flag', flagKey: 'flag.ending.route', value: spec.endingKey },
        ],
      },
      failureMessage: `尚未选择“${spec.value}”对应的最终道路。`,
    })
    actions.effects.push(
      { key: routeEffectKey, operation: 'set-world-flag', payload: { flagKey: 'flag.ending.route', value: spec.endingKey } },
      { key: unlockEffectKey, operation: 'unlock-ending', payload: { endingKey: spec.endingKey } },
      { key: reachEffectKey, operation: 'reach-ending', payload: { endingKey: spec.endingKey } },
    )
    const endingAction: MutableAction = {
      key: actionKey,
      category: 'quest-action',
      label: spec.actionLabel,
      description: spec.description,
      actorScope: 'player',
      targetScope: 'none',
      locationKeys: ['location.salt-port'],
      requirementConditionKeys: [selectionReadyConditionKey],
      costEffectKeys: [],
      successEffectKeys: [routeEffectKey, unlockEffectKey, reachEffectKey],
      failureEffectKeys: [],
      timeCostMinutes: 0,
      confirmationPolicy: 'always',
      repeatPolicy: 'once',
      cooldownMinutes: null,
    }
    addBoundAction(actions, endingAction, [choiceKey], [...spec.utterances])
    narrative.fixedChoices.push({
      key: choiceKey,
      sceneKey: resolutionScene.key,
      label: spec.actionLabel,
      description: spec.description,
      actionKey,
    })
    resolutionScene.actionKeys.push(actionKey)
    resolutionScene.fixedChoiceKeys.push(choiceKey)
    const ending = narrative.endings.find((candidate: any) => candidate.key === spec.endingKey)
    if (!ending) throw new Error(`玩家纵向验收夹具缺少结局定义:${spec.endingKey}`)
    ending.conditionKeys = [conditionKey]
  }
}

async function sealInputBindings(actions: any): Promise<void> {
  const actionByKey = new Map<string, MutableAction>(actions.actions.map((action: MutableAction) => (
    [action.key, action]
  )))
  for (const binding of actions.inputBindings.actions) {
    const action = actionByKey.get(binding.actionKey)
    if (!action) throw new Error(`玩家纵向验收夹具 InputBinding 引用未知 Action:${String(binding.actionKey)}`)
    const actionDefinitionHash = await hashProductProductionValueV2(action)
    binding.actionDefinitionHash = actionDefinitionHash
    binding.resultAuthority.actionDefinitionHash = actionDefinitionHash
  }
  actions.inputBindings.sourceActionBindingsHash = await hashProductProductionValueV2({
    actions: actions.inputBindings.actions,
    unmatchedNaturalLanguage: actions.inputBindings.unmatchedNaturalLanguage,
    thresholds: actions.inputBindings.thresholds,
    governance: actions.inputBindings.governance,
  })
}

async function sealRuntimePackage(
  runtimePackage: TextOpenWorldRuntimePackageV1,
): Promise<TextOpenWorldRuntimePackageV1> {
  const entries = await Promise.all(TEXT_OPEN_WORLD_RUNTIME_MODULE_KEYS_V1.map(async moduleKey => {
    const payload = runtimePackage.modules[moduleKey].payload as TextOpenWorldParsedModulesV1[typeof moduleKey]
    const schemaVersion = Number((payload as { version: number }).version)
    return [moduleKey, await freezeTextOpenWorldRuntimeModuleV1({ moduleKey, schemaVersion, payload })] as const
  }))
  runtimePackage.modules = Object.fromEntries(entries) as TextOpenWorldRuntimePackageV1['modules']
  return parseTextOpenWorldRuntimePackageV1(runtimePackage)
}

/**
 * Frozen, parser-verified Release payload for G4's real player journey. It
 * intentionally starts from the public P9 compatibility fixture, then closes
 * every contract required by the current fresh Action v18 runtime.
 */
export async function createTextOpenWorldPlayerJourneyFixtureV1(): Promise<TextOpenWorldPlayerJourneyFixtureV1> {
  const runtimePackage = createTextOpenWorldVNextP9Fixture()
  const actions = runtimePackage.modules.actions.payload as any

  upgradeQuestLifecycleToV18(actions)
  upgradeStructuredCombatTriplet(runtimePackage)
  upgradeDirectorToV3(runtimePackage)
  bindMainObjectiveCompletion(runtimePackage)
  addTwoEndingRoutes(runtimePackage)
  await sealInputBindings(actions)

  const sealed = await sealRuntimePackage(runtimePackage)
  const parsedModules = parseTextOpenWorldModulesV1(sealed)
  const packageHash = await hashProductProductionValueV2(sealed)
  return {
    runtimePackage: sealed,
    parsedModules,
    packageHash,
    keys: TEXT_OPEN_WORLD_PLAYER_JOURNEY_KEYS_V1,
  }
}
