import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import type {
  TextOpenWorldEffectStateV1,
  TextOpenWorldParsedModulesV1,
  TextOpenWorldQuestInstanceV1,
  TextOpenWorldQuestStatusV1,
  TextOpenWorldQuestTransitionAuthorizationV1,
  TextOpenWorldQuestTransitionIntentV1,
  TextOpenWorldRuntimePackageV1,
} from '../types'
import { parseTextOpenWorldModulesV1 } from './modules'

const PLAYER_INTENTS = new Set<TextOpenWorldQuestTransitionIntentV1>(['accept', 'abandon'])

function fail(message: string): never { throw new Error(`[text-open-world-quest-state] ${message}`) }

function intentFor(fromStatus: TextOpenWorldQuestStatusV1, toStatus: TextOpenWorldQuestStatusV1): TextOpenWorldQuestTransitionIntentV1 {
  if (fromStatus === 'locked' && toStatus === 'available') return 'unlock'
  if (fromStatus === 'available' && toStatus === 'revealed') return 'reveal'
  if (fromStatus === 'revealed' && toStatus === 'accepted') return 'accept'
  if (fromStatus === 'accepted' && toStatus === 'active') return 'activate'
  if (fromStatus === 'active' && toStatus === 'suspended') return 'suspend'
  if (fromStatus === 'suspended' && toStatus === 'active') return 'resume'
  if (fromStatus === 'active' && toStatus === 'completed') return 'complete'
  if (fromStatus === 'active' && toStatus === 'failed') return 'fail'
  if (['revealed', 'accepted', 'active', 'suspended'].includes(fromStatus) && toStatus === 'abandoned') return 'abandon'
  if (['revealed', 'accepted', 'active', 'suspended'].includes(fromStatus) && toStatus === 'expired') return 'expire'
  if (['available', 'revealed'].includes(fromStatus) && toStatus === 'withdrawn') return 'withdraw'
  if (fromStatus === 'abandoned' && toStatus === 'available') return 'reoffer'
  fail(`不存在合法迁移:${fromStatus}->${toStatus}`)
}

function assertPolicy(
  definition: TextOpenWorldParsedModulesV1['quests']['quests'][number],
  instance: TextOpenWorldQuestInstanceV1,
  intent: TextOpenWorldQuestTransitionIntentV1,
  actorKind: 'player' | 'system',
  worldMinute: number,
  stageKey: string | null,
) {
  const expectedActor = PLAYER_INTENTS.has(intent) ? 'player' : 'system'
  if (actorKind !== expectedActor) fail(`${intent}只能由${expectedActor}执行`)
  if (definition.type === 'mainline' && ['fail', 'abandon', 'expire', 'withdraw', 'reoffer'].includes(intent)) fail(`主线不允许${intent}`)
  if (definition.type === 'significant' && ['fail', 'abandon', 'expire', 'withdraw', 'reoffer'].includes(intent)) fail(`重要故事线不允许${intent}`)
  if (definition.lifecyclePolicy === 'protected-wait' && ['fail', 'abandon', 'expire', 'withdraw', 'reoffer'].includes(intent)) fail(`protected-wait任务不允许${intent}`)
  if (intent === 'reoffer' && (definition.type !== 'ordinary' || definition.lifecyclePolicy !== 'abandon-restart')) fail('只有可重接普通任务能够重新开放原实例')
  if (intent === 'expire') {
    if (definition.timePolicy !== 'timed' || instance.deadlineWorldMinute == null) fail('非限时任务不能过期')
    if (worldMinute < instance.deadlineWorldMinute) fail('任务尚未到期')
  }
  if (intent === 'activate') {
    if (stageKey == null || !definition.stageKeys.includes(stageKey)) fail('激活任务必须指定本定义的Stage')
  } else if (intent === 'resume') {
    if (stageKey == null || stageKey !== instance.currentStageKey) fail('恢复任务必须保留暂停前Stage')
  } else if (['suspend', 'complete', 'fail', 'abandon', 'expire'].includes(intent)) {
    if (stageKey !== instance.currentStageKey) fail(`${intent}必须保留当前Stage引用`)
  } else if (stageKey != null) fail(`${intent}不能提前写入Stage`)
}

function applyStep(
  definition: TextOpenWorldParsedModulesV1['quests']['quests'][number],
  instance: TextOpenWorldQuestInstanceV1,
  step: TextOpenWorldQuestTransitionAuthorizationV1['transitions'][number],
  worldMinute: number,
) {
  if (instance.status !== step.fromStatus) fail(`迁移基线状态漂移:${instance.status}!=${step.fromStatus}`)
  const intent = intentFor(instance.status, step.toStatus)
  if (intent !== step.intent) fail(`迁移意图与状态边不一致:${step.intent}`)
  assertPolicy(definition, instance, intent, step.actorKind, worldMinute, step.stageKey)
  if (intent === 'reoffer') {
    instance.currentStageKey = null
    Object.keys(instance.objectiveStatusByKey).forEach(key => { instance.objectiveStatusByKey[key] = 'inactive' })
    instance.offeredAtWorldMinute = null
    instance.acceptedAtWorldMinute = null
    instance.deadlineWorldMinute = null
    instance.terminalAtWorldMinute = null
    instance.rewardClaimKey = null
    instance.resultTag = null
  }
  if (intent === 'reveal') {
    instance.offeredAtWorldMinute = worldMinute
    instance.deadlineWorldMinute = definition.timePolicy === 'timed' ? worldMinute + definition.expirationMinutes! : null
  }
  if (intent === 'accept') instance.acceptedAtWorldMinute = worldMinute
  if (intent === 'activate' || intent === 'resume') instance.currentStageKey = step.stageKey
  if (['complete', 'fail', 'abandon', 'expire', 'withdraw'].includes(intent)) instance.terminalAtWorldMinute = worldMinute
  instance.status = step.toStatus
}

export interface TextOpenWorldQuestTransitionCatalogV1 {
  prepare(input: {
    instanceKey: string
    state: TextOpenWorldEffectStateV1
    transitions: Array<{ toStatus: TextOpenWorldQuestStatusV1; stageKey: string | null }>
  }): TextOpenWorldQuestTransitionAuthorizationV1
  apply(input: {
    state: TextOpenWorldEffectStateV1
    authorization: TextOpenWorldQuestTransitionAuthorizationV1
  }): Array<{ before: TextOpenWorldQuestInstanceV1; after: TextOpenWorldQuestInstanceV1 }>
  assertAuthorization(input: {
    state: TextOpenWorldEffectStateV1
    authorization: TextOpenWorldQuestTransitionAuthorizationV1
  }): void
}

export function createTextOpenWorldQuestTransitionCatalogV1(
  value: TextOpenWorldRuntimePackageV1 | string | unknown,
): TextOpenWorldQuestTransitionCatalogV1 {
  const modules = parseTextOpenWorldModulesV1(value)
  const clone = <T>(item: T): T => structuredClone(item)
  const applyAuthorization = (input: {
    state: TextOpenWorldEffectStateV1
    authorization: TextOpenWorldQuestTransitionAuthorizationV1
  }) => {
    const { authorization, state } = input
    if (!Array.isArray(authorization.transitions) || authorization.transitions.length < 1 || authorization.transitions.length > 8) fail('任务迁移授权必须包含1到8步')
    if (state.time.worldMinute !== authorization.worldMinute) fail('任务迁移世界时间基线已变化')
    const instance = state.quests.instancesByKey[authorization.instanceKey] ?? fail(`任务实例不存在:${authorization.instanceKey}`)
    if (instance.definitionKey !== authorization.definitionKey) fail('任务迁移定义引用漂移')
    const definition = modules.quests.quests.find(candidate => candidate.key === instance.definitionKey) ?? fail('任务定义不存在')
    const changes: Array<{ before: TextOpenWorldQuestInstanceV1; after: TextOpenWorldQuestInstanceV1 }> = []
    authorization.transitions.forEach(step => {
      const before = clone(instance)
      applyStep(definition, instance, step, authorization.worldMinute)
      changes.push({ before, after: clone(instance) })
    })
    return changes
  }
  const prepare: TextOpenWorldQuestTransitionCatalogV1['prepare'] = input => {
    const instance = input.state.quests.instancesByKey[input.instanceKey] ?? fail(`任务实例不存在:${input.instanceKey}`)
    if (!Array.isArray(input.transitions) || input.transitions.length < 1 || input.transitions.length > 8) fail('任务迁移序列必须包含1到8步')
    const simulatedState = clone(input.state)
    const transitions: TextOpenWorldQuestTransitionAuthorizationV1['transitions'] = []
    for (const request of input.transitions) {
      const current = simulatedState.quests.instancesByKey[input.instanceKey]
      const intent = intentFor(current.status, request.toStatus)
      const step = {
        intent,
        actorKind: (PLAYER_INTENTS.has(intent) ? 'player' : 'system') as 'player' | 'system',
        fromStatus: current.status,
        toStatus: request.toStatus,
        stageKey: request.stageKey,
      }
      const authorization: TextOpenWorldQuestTransitionAuthorizationV1 = {
        kind: 'quest-transition', instanceKey: input.instanceKey, definitionKey: instance.definitionKey,
        worldMinute: input.state.time.worldMinute, transitions: [step],
      }
      applyAuthorization({ state: simulatedState, authorization })
      transitions.push(step)
    }
    return {
      kind: 'quest-transition', instanceKey: input.instanceKey, definitionKey: instance.definitionKey,
      worldMinute: input.state.time.worldMinute, transitions,
    }
  }
  return {
    prepare,
    apply: input => applyAuthorization({ state: input.state, authorization: clone(input.authorization) }),
    assertAuthorization: input => {
      const requests = input.authorization.transitions.map(step => ({ toStatus: step.toStatus, stageKey: step.stageKey }))
      const expected = prepare({ instanceKey: input.authorization.instanceKey, state: clone(input.state), transitions: requests })
      if (canonicalProductProductionJsonV2(expected) !== canonicalProductProductionJsonV2(input.authorization)) fail('任务迁移授权与权威状态不一致')
    },
  }
}
