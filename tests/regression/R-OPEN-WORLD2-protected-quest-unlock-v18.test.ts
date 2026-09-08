import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  executeTextOpenWorldActionV1,
  resumeTextOpenWorldSystemWorkV1,
  textOpenWorldQuestSettlementLimitV1,
} from '../../src/lib/open-world/action-executor'
import { commitTextOpenWorldCommandV1 } from '../../src/lib/open-world/commands'
import { createTextOpenWorldEffectCatalogV1 } from '../../src/lib/open-world/effect-dsl'
import { commitTextOpenWorldOutcomeBatchV1 } from '../../src/lib/open-world/events'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import { createTextOpenWorldObjectiveCatalogV1 } from '../../src/lib/open-world/objective-state'
import { projectTextOpenWorldPlayerQuestLogV1 } from '../../src/lib/open-world/player-quest-log'
import { projectTextOpenWorldScenesV1 } from '../../src/lib/open-world/scene-projection'
import { parseTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import { hashProductRuntimeStateV1, readProductRuntimeState } from '../../src/lib/product/runtime-core'
import type { ProductRuntimeEvent, TextOpenWorldRuntimePackageV1 } from '../../src/lib/types'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextP9Fixture } from '../helpers/text-open-world-vnext-fixture'

type ProtectedQuestKind = 'mainline' | 'significant'

interface ProtectedQuestInput {
  key: string
  kind: ProtectedQuestKind
  storylineKey: string
  narrativeStageKey: string
  narrativeStageOrder: number
  prerequisiteQuestKey: string
}

function eventPayload(event: ProductRuntimeEvent): any {
  return JSON.parse(event.payloadJson)
}

function bindingHash(order: number): string {
  return order.toString(16).padStart(64, '0')
}

function addInputBinding(actions: any, action: any, fixedChoiceKeys: string[] = []) {
  const order = actions.inputBindings.actions.length + 1
  const actionDefinitionHash = bindingHash(order)
  const mode = action.actorScope === 'system' ? 'disabled-system-only' : 'existing-action-candidate'
  actions.inputBindings.actions.push({
    key: `binding.${action.key}`,
    order,
    actionKey: action.key,
    actionDefinitionHash,
    actorScope: action.actorScope,
    category: action.category,
    targetScope: action.targetScope,
    systemAction: {
      enabled: action.actorScope === 'player',
      label: action.label,
      description: action.description,
      executionSource: 'system-action',
    },
    fixedChoiceKeys,
    naturalLanguage: {
      mode,
      exampleUtterances: mode === 'existing-action-candidate'
        ? [`执行${action.key}`, `确认${action.key}`]
        : [],
      candidateMayOnlySelectThisAction: true,
      targetResolution: 'current-projection-valid-targets-only',
      highConfidenceLowRisk: 'execute-after-runtime-validation',
      highRiskOrIrreversible: 'require-explicit-confirmation',
      lowConfidence: 'respond-and-recommend-formal-actions',
      mayCreateAction: false,
      mayCreateQuest: false,
      mayCreateMapContent: false,
      mayWriteState: false,
    },
    resultAuthority: {
      artifactKey: 'text-open-world.quest-design-documents',
      collection: 'actions',
      actionKey: action.key,
      actionDefinitionHash,
    },
  })
}

function addAction(actions: any, action: any, fixedChoiceKeys: string[] = []) {
  actions.actions.push(action)
  addInputBinding(actions, action, fixedChoiceKeys)
}

function action(input: {
  key: string
  category: 'accept-quest' | 'objective-action' | 'quest-action'
  label: string
  actorScope?: 'player' | 'system'
  requirementConditionKeys?: string[]
  successEffectKeys: string[]
}) {
  return {
    key: input.key,
    category: input.category,
    label: input.label,
    description: `${input.label}。`,
    actorScope: input.actorScope ?? 'player',
    targetScope: 'quest',
    locationKeys: [],
    requirementConditionKeys: input.requirementConditionKeys ?? [],
    costEffectKeys: [],
    successEffectKeys: input.successEffectKeys,
    failureEffectKeys: [],
    timeCostMinutes: 0,
    confirmationPolicy: 'never',
    repeatPolicy: 'repeatable',
    cooldownMinutes: null,
  }
}

function scene(input: {
  key: string
  order: number
  sourceKind: 'quest-offer' | 'quest-objective' | 'quest-resolution'
  questKey: string
  stageKey: string | null
  objectiveKey: string | null
  actionKeys: string[]
  fixedChoiceKeys: string[]
  availabilityConditionKeys?: string[]
}) {
  return {
    key: input.key,
    order: input.order,
    sourceKind: input.sourceKind,
    sourceKey: input.sourceKind === 'quest-objective' ? input.objectiveKey : input.questKey,
    title: `场景${input.key}`,
    purpose: `验证${input.questKey}的持久任务入口。`,
    regionKey: 'region.salt-port',
    locationKey: 'location.salt-port',
    questKey: input.questKey,
    stageKey: input.stageKey,
    objectiveKey: input.objectiveKey,
    actorKey: null,
    interactionKey: null,
    randomEventKey: null,
    participantKeys: [],
    openingText: `${input.questKey}入口已经满足运行条件。`,
    bodyText: `${input.questKey}只由冻结Action与任务实例状态控制。`,
    successText: `${input.questKey}的确定性行动已完成。`,
    failureText: null,
    attitudeOpenings: null,
    allowedKnowledgeClaimKeys: [],
    forbiddenFutureObjectiveKeys: [],
    availabilityConditionKeys: input.availabilityConditionKeys ?? [],
    actionKeys: input.actionKeys,
    fixedChoiceKeys: input.fixedChoiceKeys,
  }
}

function addProtectedQuest(runtimePackage: TextOpenWorldRuntimePackageV1, input: ProtectedQuestInput) {
  const narrative = runtimePackage.modules.narrative.payload as any
  const quests = runtimePackage.modules.quests.payload as any
  const actions = runtimePackage.modules.actions.payload as any
  const suffix = input.key.slice('quest.'.length)
  const conditionKey = `condition.unlock.${input.key}`
  const questStageKey = `quest-stage.${suffix}`
  const objectiveKey = `objective.${suffix}`
  const acceptActionKey = `action.accept.${input.key}`
  const objectiveActionKey = `action.complete.${objectiveKey}`
  const completionActionKey = `action.advance.${questStageKey}`
  const revealActionKey = `action.reveal.${input.key}`
  const offerSceneKey = `scene.offer.${suffix}`
  const objectiveSceneKey = `scene.objective.${suffix}`
  const resolutionSceneKey = `scene.resolution.${suffix}`
  const offerChoiceKey = `choice.accept.${suffix}`
  const objectiveChoiceKey = `choice.complete.${suffix}`

  actions.conditions.push({
    key: conditionKey,
    expression: { op: 'quest-status', questKey: input.prerequisiteQuestKey, statuses: ['completed'] },
    failureMessage: '前置受保护故事尚未完成。',
  })
  actions.effects.push(
    { key: `effect.unlock.${input.key}`, operation: 'transition-quest', payload: { questKey: input.key, status: 'available', stageKey: null } },
    { key: `effect.reveal.${input.key}`, operation: 'transition-quest', payload: { questKey: input.key, status: 'revealed', stageKey: null } },
    { key: `effect.accept.${input.key}`, operation: 'transition-quest', payload: { questKey: input.key, status: 'accepted', stageKey: null } },
    { key: `effect.activate.${input.key}`, operation: 'transition-quest', payload: { questKey: input.key, status: 'active', stageKey: questStageKey } },
    { key: `effect.complete.${objectiveKey}`, operation: 'complete-objective', payload: { objectiveKey } },
    { key: `effect.advance.${questStageKey}`, operation: 'transition-quest', payload: { questKey: input.key, status: 'completed', stageKey: questStageKey } },
  )

  const accept = action({
    key: acceptActionKey,
    category: 'accept-quest',
    label: `接受${input.key}`,
    requirementConditionKeys: [conditionKey],
    successEffectKeys: [`effect.accept.${input.key}`, `effect.activate.${input.key}`],
  })
  const completeObjective = action({
    key: objectiveActionKey,
    category: 'objective-action',
    label: `完成${objectiveKey}`,
    requirementConditionKeys: ['condition.always'],
    successEffectKeys: [`effect.complete.${objectiveKey}`],
  })
  const completeQuest = action({
    key: completionActionKey,
    category: 'quest-action',
    label: `结算${questStageKey}`,
    actorScope: 'system',
    requirementConditionKeys: ['condition.always'],
    successEffectKeys: [`effect.advance.${questStageKey}`],
  })
  const reveal = action({
    key: revealActionKey,
    category: 'quest-action',
    label: `揭示${input.key}`,
    actorScope: 'system',
    requirementConditionKeys: [conditionKey],
    successEffectKeys: [`effect.unlock.${input.key}`, `effect.reveal.${input.key}`],
  })

  narrative.fixedChoices.push(
    { key: offerChoiceKey, sceneKey: offerSceneKey, label: accept.label, description: accept.description, actionKey: acceptActionKey },
    { key: objectiveChoiceKey, sceneKey: objectiveSceneKey, label: completeObjective.label, description: completeObjective.description, actionKey: objectiveActionKey },
  )
  let nextSceneOrder = narrative.scenes.length + 1
  const authoredScenes = [
    scene({
      key: offerSceneKey,
      order: nextSceneOrder++,
      sourceKind: 'quest-offer',
      questKey: input.key,
      stageKey: null,
      objectiveKey: null,
      availabilityConditionKeys: [conditionKey],
      actionKeys: [acceptActionKey],
      fixedChoiceKeys: [offerChoiceKey],
    }),
    scene({
      key: objectiveSceneKey,
      order: nextSceneOrder++,
      sourceKind: 'quest-objective',
      questKey: input.key,
      stageKey: questStageKey,
      objectiveKey,
      actionKeys: [objectiveActionKey],
      fixedChoiceKeys: [objectiveChoiceKey],
    }),
    scene({
      key: resolutionSceneKey,
      order: nextSceneOrder,
      sourceKind: 'quest-resolution',
      questKey: input.key,
      stageKey: questStageKey,
      objectiveKey: null,
      actionKeys: [],
      fixedChoiceKeys: [],
    }),
  ]
  // Deliberately keep storage order unrelated to narrative order. Runtime must
  // consume frozen order/prerequisite keys rather than array adjacency.
  narrative.scenes.unshift(...authoredScenes.reverse())

  addAction(actions, accept, [offerChoiceKey])
  addAction(actions, completeObjective, [objectiveChoiceKey])
  addAction(actions, completeQuest)
  addAction(actions, reveal)

  quests.quests.unshift({
    key: input.key,
    type: input.kind,
    ownerKind: input.kind === 'mainline' ? 'global' : 'region',
    ownerKey: input.kind === 'mainline' ? null : 'region.salt-port',
    title: `任务${input.key}`,
    description: `验证${input.key}的受保护等待与揭示。`,
    storylineKey: input.storylineKey,
    regionKeys: ['region.salt-port'],
    stageKeys: [questStageKey],
    prerequisiteConditionKeys: [conditionKey],
    rewardEffectKeys: [],
    rewardContractKey: null,
    claimActionKey: null,
    lifecyclePolicy: 'protected-wait',
    timePolicy: 'waits',
    expirationMinutes: null,
    repeatable: false,
    instantiationPolicy: 'session-start',
    initialStatus: 'locked',
    estimatedMinutes: 10,
    tags: [input.kind],
  })
  quests.stages.unshift({
    key: questStageKey,
    questKey: input.key,
    order: 1,
    title: `阶段${questStageKey}`,
    objectiveKeys: [objectiveKey],
    completionConditionKeys: ['condition.always'],
    completionActionKey,
  })
  quests.objectives.unshift({
    key: objectiveKey,
    stageKey: questStageKey,
    title: `目标${objectiveKey}`,
    optional: false,
    actionKeys: [objectiveActionKey],
  })

  if (input.kind === 'mainline') {
    const mainline = narrative.storylines.find((candidate: any) => candidate.key === input.storylineKey)
    mainline.stageKeys.push(input.narrativeStageKey)
  } else {
    narrative.storylines.unshift({
      key: input.storylineKey,
      kind: 'significant',
      ownerKind: 'region',
      ownerKey: 'region.salt-port',
      title: `故事线${input.storylineKey}`,
      summary: `验证${input.storylineKey}的安全等待。`,
      stageKeys: [input.narrativeStageKey],
      endingKeys: [],
    })
  }
  narrative.stages.unshift({
    key: input.narrativeStageKey,
    storylineKey: input.storylineKey,
    order: input.narrativeStageOrder,
    title: `叙事阶段${input.narrativeStageKey}`,
    summary: `由${input.prerequisiteQuestKey}完成后揭示。`,
    questKeys: [input.key],
    sceneKeys: [offerSceneKey, objectiveSceneKey, resolutionSceneKey],
    safeWaitPoint: true,
  })
}

function upgradeFixtureToActionV18(runtimePackage: TextOpenWorldRuntimePackageV1) {
  const actions = runtimePackage.modules.actions.payload as any
  const progression = runtimePackage.modules.progression.payload as any
  const combat = runtimePackage.modules.combat.payload as any

  // The broad fixture predates Action v16's explicit unstarted-abandon edge.
  const stagedAbandon = actions.actions.find((candidate: any) => candidate.key === 'action.abandon-supplies')
  actions.effects.push({
    key: 'effect.abandon-supplies-unstarted-follow-up-v18',
    operation: 'transition-quest',
    payload: { questKey: 'quest.template.supplies', status: 'abandoned', stageKey: null },
  })
  addAction(actions, {
    ...structuredClone(stagedAbandon),
    key: 'action.abandon-supplies-unstarted-follow-up-v18',
    successEffectKeys: ['effect.abandon-supplies-unstarted-follow-up-v18'],
  })

  actions.version = 18
  runtimePackage.modules.actions.schemaVersion = 18
  progression.version = 2
  progression.skills = progression.skills.map((candidate: any) => {
    const { activation: _activation, kind, ...skill } = candidate
    if (kind !== 'attack') throw new Error(`Action v18测试夹具遇到未定义机制:${String(kind)}`)
    return { ...skill, mechanic: { kind: 'attack' } }
  })
  progression.statuses = progression.statuses.map((status: any) => ({
    ...status,
    duration: { clock: 'combat' },
    reapplyPolicy: 'reject',
    maxStacks: 1,
    modifiers: [],
  }))
  runtimePackage.modules.progression.schemaVersion = 2
  combat.version = 4
  delete combat.transientPlayerStatusKeys
  runtimePackage.modules.combat.schemaVersion = 4
}

function protectedStoryRuntime(input: {
  continuation?: boolean
  significantCount: number
}): TextOpenWorldRuntimePackageV1 {
  const runtimePackage = createTextOpenWorldVNextP9Fixture()
  if (input.continuation) {
    addProtectedQuest(runtimePackage, {
      key: 'quest.main.2',
      kind: 'mainline',
      storylineKey: 'story.main',
      narrativeStageKey: 'story-stage.main.2',
      narrativeStageOrder: 2,
      prerequisiteQuestKey: 'quest.main.1',
    })
    addProtectedQuest(runtimePackage, {
      key: 'quest.main.3',
      kind: 'mainline',
      storylineKey: 'story.main',
      narrativeStageKey: 'story-stage.main.3',
      narrativeStageOrder: 3,
      prerequisiteQuestKey: 'quest.main.2',
    })
  }
  for (let index = 1; index <= input.significantCount; index += 1) {
    const suffix = String(index).padStart(3, '0')
    addProtectedQuest(runtimePackage, {
      key: `quest.significant.${suffix}`,
      kind: 'significant',
      storylineKey: `story.significant.${suffix}`,
      narrativeStageKey: `story-stage.significant.${suffix}`,
      narrativeStageOrder: 1,
      prerequisiteQuestKey: 'quest.main.1',
    })
  }
  upgradeFixtureToActionV18(runtimePackage)
  return runtimePackage
}

function instanceKeyFor(runtime: Awaited<ReturnType<typeof readProductRuntimeState>>, definitionKey: string): string {
  const projection = runtime.textOpenWorld ?? (() => { throw new Error('测试缺少文字开放世界投影') })()
  return Object.values(projection.state.quests.instancesByKey)
    .find(instance => instance.definitionKey === definitionKey)?.instanceKey
    ?? (() => { throw new Error(`任务实例不存在:${definitionKey}`) })()
}

async function allEvents(sessionId: number): Promise<ProductRuntimeEvent[]> {
  return db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence')
}

async function completeOpeningMainline(sessionId: number, prefix: string) {
  let runtime = await readProductRuntimeState(sessionId)
  const instanceKey = instanceKeyFor(runtime, 'quest.main.1')
  await executeTextOpenWorldActionV1({
    sessionId,
    actionKey: 'action.accept-main',
    targetKey: instanceKey,
    commandId: `${prefix}.accept`,
    requestedAt: 1,
  })
  await executeTextOpenWorldActionV1({
    sessionId,
    actionKey: 'action.complete-main-objective',
    targetKey: instanceKey,
    commandId: `${prefix}.objective`,
    requestedAt: 2,
  })
  runtime = await readProductRuntimeState(sessionId)
  return { runtime, instanceKey, causeCommandId: `${prefix}.objective` }
}

async function commitOpeningObjectiveWithoutFollowUps(input: {
  sessionId: number
  instanceKey: string
  commandId: string
}) {
  const before = await readProductRuntimeState(input.sessionId)
  await commitTextOpenWorldCommandV1({
    schema: 'storyforge.text-open-world.command',
    version: 1,
    commandId: input.commandId,
    sessionId: input.sessionId,
    actorKey: 'player',
    actionKey: 'action.complete-main-objective',
    payload: { targetKey: input.instanceKey },
    baseSequence: before.lastSequence,
    baseStateHash: await hashProductRuntimeStateV1(before),
    source: 'fixed-choice',
    requestedAt: 2,
  })
  const pending = await readProductRuntimeState(input.sessionId)
  const projection = parseTextOpenWorldSessionProjectionV1(pending.textOpenWorld)
  const modules = parseTextOpenWorldModulesV1(projection.runtimePackage)
  const actionDefinition = modules.actions.actions.find(action => action.key === 'action.complete-main-objective')
    ?? (() => { throw new Error('测试缺少主线Objective Action') })()
  const completion = actionDefinition.successEffectKeys
    .map(effectKey => modules.actions.effects.find(effect => effect.key === effectKey))
    .find(effect => effect?.operation === 'complete-objective')
  if (!completion || completion.operation !== 'complete-objective') throw new Error('测试主线Objective Action缺少完成Effect')
  const authorization = createTextOpenWorldObjectiveCatalogV1(projection.runtimePackage).prepare({
    instanceKey: input.instanceKey,
    objectiveKey: completion.payload.objectiveKey,
    state: projection.state,
  })
  const effects = createTextOpenWorldEffectCatalogV1(projection.runtimePackage)
  const plan = await effects.plan({
    effectKeys: actionDefinition.successEffectKeys,
    claimKey: `claim.${input.commandId}`,
    state: projection.state,
    authorization,
  })
  const applied = await effects.apply({ plan, state: projection.state })
  await commitTextOpenWorldOutcomeBatchV1({
    sessionId: input.sessionId,
    commandId: input.commandId,
    ruleset: projection.ruleset,
    randomRequests: [],
    plan,
    receipt: applied.receipt,
    outcome: 'success',
    reason: null,
    degradation: null,
  })
}

function linkedSystemCommands(events: ProductRuntimeEvent[], causeCommandId: string) {
  return events.filter(event => event.type === 'text-open-world.command.committed'
    && event.actorKey === 'system'
    && eventPayload(event).envelope.payload.systemCauseCommandId === causeCommandId)
}

describe('Text Open World · Action v18 protected story unlock and reveal', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('乱序定义仍按冻结前置图完成主线与重要故事揭示，并经事件重放进入Scene和任务日志', async () => {
    const runtimePackage = protectedStoryRuntime({ continuation: true, significantCount: 1 })
    const parsed = parseTextOpenWorldModulesV1(runtimePackage)
    expect(parsed.actions.version).toBe(18)
    expect(parsed.quests.quests.findIndex(quest => quest.key === 'quest.main.3'))
      .toBeLessThan(parsed.quests.quests.findIndex(quest => quest.key === 'quest.main.2'))

    const created = await createGovernedTextOpenWorldSessionFixtureV1({
      name: `TEXT-OPEN-WORLD Protected Story v18-${crypto.randomUUID()}`,
      textOpenWorldVNext: runtimePackage,
      title: 'Protected Story v18',
      seed: 'protected-story-v18',
    })
    const sessionId = created.session.id!
    const before = await readProductRuntimeState(sessionId)
    const beforeEvents = await allEvents(sessionId)
    const beforeScenes = projectTextOpenWorldScenesV1(before.textOpenWorld!)
    const beforeLog = projectTextOpenWorldPlayerQuestLogV1({
      sessionId,
      projection: before.textOpenWorld!,
      events: beforeEvents,
    })
    for (const definitionKey of ['quest.main.2', 'quest.main.3', 'quest.significant.001']) {
      expect(before.textOpenWorld!.state.quests.instancesByKey[instanceKeyFor(before, definitionKey)].status).toBe('locked')
      expect(beforeScenes.scenes.some(scene => scene.sourceKey === definitionKey)).toBe(false)
      expect(beforeLog.entries.some(entry => entry.definitionKey === definitionKey)).toBe(false)
    }

    const { runtime: head, causeCommandId } = await completeOpeningMainline(sessionId, 'command.protected-story')
    const replay = await readProductRuntimeState(sessionId, head.lastSequence)
    expect(replay).toEqual(head)

    for (const definitionKey of ['quest.main.2', 'quest.significant.001']) {
      const instance = head.textOpenWorld!.state.quests.instancesByKey[instanceKeyFor(head, definitionKey)]
      expect(instance).toMatchObject({ status: 'revealed', deadlineWorldMinute: null })
      expect(instance.offeredAtWorldMinute).toBe(head.textOpenWorld!.state.time.worldMinute)
    }
    expect(head.textOpenWorld!.state.quests.instancesByKey[instanceKeyFor(head, 'quest.main.3')])
      .toMatchObject({ status: 'locked', offeredAtWorldMinute: null })

    const events = await allEvents(sessionId)
    const linked = linkedSystemCommands(events, causeCommandId)
    const linkedActionKeys = linked.map(event => eventPayload(event).envelope.actionKey)
    expect(linkedActionKeys.indexOf('action.complete-main-quest')).toBeGreaterThanOrEqual(0)
    expect(linkedActionKeys.indexOf('action.complete-main-quest'))
      .toBeLessThan(linkedActionKeys.indexOf('action.reveal.quest.main.2'))
    expect(linkedActionKeys).toEqual(expect.arrayContaining([
      'action.reveal.quest.main.2',
      'action.reveal.quest.significant.001',
    ]))
    expect(linkedActionKeys).not.toContain('action.reveal.quest.main.3')

    const revealCommand = linked.find(event => eventPayload(event).envelope.actionKey === 'action.reveal.quest.main.2')!
    const revealOutcome = events.find(event => event.type === 'text-open-world.effects.applied'
      && eventPayload(event).commandId === revealCommand.commandId)!
    expect(eventPayload(revealOutcome).plan.authorization.transitions).toEqual([
      expect.objectContaining({ intent: 'unlock', fromStatus: 'locked', toStatus: 'available', stageKey: null, actorKind: 'system' }),
      expect.objectContaining({ intent: 'reveal', fromStatus: 'available', toStatus: 'revealed', stageKey: null, actorKind: 'system' }),
    ])
    expect(eventPayload(revealOutcome).receipt.changes).toHaveLength(2)

    const scenes = projectTextOpenWorldScenesV1(replay.textOpenWorld!)
    expect(scenes.scenes.map(scene => scene.sourceKey)).toEqual(expect.arrayContaining([
      'quest.main.2',
      'quest.significant.001',
    ]))
    expect(scenes.scenes.some(scene => scene.sourceKey === 'quest.main.3')).toBe(false)
    const questLog = projectTextOpenWorldPlayerQuestLogV1({ sessionId, projection: replay.textOpenWorld!, events })
    expect(questLog.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ definitionKey: 'quest.main.2', category: 'main', status: 'revealed' }),
      expect.objectContaining({ definitionKey: 'quest.significant.001', category: 'significant', status: 'revealed' }),
    ]))
    expect(questLog.entries.some(entry => entry.definitionKey === 'quest.main.3')).toBe(false)
  }, 60_000)

  it('玩家Effect已落盘但系统揭示未开始时可幂等续跑，重复恢复不增加Command、Effect或claim', async () => {
    const created = await createGovernedTextOpenWorldSessionFixtureV1({
      name: `TEXT-OPEN-WORLD Protected Story Recovery v18-${crypto.randomUUID()}`,
      textOpenWorldVNext: protectedStoryRuntime({ continuation: true, significantCount: 1 }),
      title: 'Protected Story Recovery v18',
      seed: 'protected-story-recovery-v18',
    })
    const sessionId = created.session.id!
    const initial = await readProductRuntimeState(sessionId)
    const mainInstanceKey = instanceKeyFor(initial, 'quest.main.1')
    await executeTextOpenWorldActionV1({
      sessionId,
      actionKey: 'action.accept-main',
      targetKey: mainInstanceKey,
      commandId: 'command.protected-story-recovery.accept',
      requestedAt: 1,
    })
    const causeCommandId = 'command.protected-story-recovery.objective'
    await commitOpeningObjectiveWithoutFollowUps({ sessionId, instanceKey: mainInstanceKey, commandId: causeCommandId })

    const prefix = await readProductRuntimeState(sessionId)
    expect(prefix.textOpenWorld!.state.quests.instancesByKey[mainInstanceKey]).toMatchObject({
      status: 'active',
      objectiveStatusByKey: { 'objective.main.1': 'completed' },
    })
    expect(prefix.textOpenWorld!.state.quests.instancesByKey[instanceKeyFor(prefix, 'quest.main.2')].status).toBe('locked')

    await resumeTextOpenWorldSystemWorkV1(sessionId)
    const once = await readProductRuntimeState(sessionId)
    const onceEvents = await allEvents(sessionId)
    const linkedOnce = linkedSystemCommands(onceEvents, causeCommandId)
      .filter(event => eventPayload(event).envelope.actionKey.startsWith('action.reveal.'))
    expect(linkedOnce.map(event => eventPayload(event).envelope.actionKey).sort()).toEqual([
      'action.reveal.quest.main.2',
      'action.reveal.quest.significant.001',
    ])
    expect(once.textOpenWorld!.state.quests.instancesByKey[instanceKeyFor(once, 'quest.main.2')].status).toBe('revealed')
    const eventCount = onceEvents.length
    const claimKeys = [...once.textOpenWorld!.state.appliedClaimKeys]
    const replay = await readProductRuntimeState(sessionId, once.lastSequence)
    expect(replay).toEqual(once)

    await resumeTextOpenWorldSystemWorkV1(sessionId)
    const twice = await readProductRuntimeState(sessionId)
    const twiceEvents = await allEvents(sessionId)
    expect(twiceEvents).toHaveLength(eventCount)
    expect(twice.textOpenWorld!.state.appliedClaimKeys).toEqual(claimKeys)
    expect(linkedSystemCommands(twiceEvents, causeCommandId)
      .filter(event => eventPayload(event).envelope.actionKey.startsWith('action.reveal.'))
      .map(event => event.commandId)).toEqual(linkedOnce.map(event => event.commandId))
  }, 60_000)

  it('33条同时可揭示故事的v18上限越过旧32步，旧版本仍冻结且非法输入fail-close', () => {
    // main.1 + main.2 + main.3 + 32 significant = 35 durable instances.
    // Completing main.1 makes main.2 and all significant quests ready at once:
    // 33 reveal Commands, while main.3 correctly keeps waiting for main.2.
    const runtimePackage = protectedStoryRuntime({ continuation: true, significantCount: 32 })
    const instanceCount = parseTextOpenWorldModulesV1(runtimePackage).quests.quests
      .filter(quest => quest.instantiationPolicy === 'session-start').length
    expect(instanceCount).toBe(35)
    expect(textOpenWorldQuestSettlementLimitV1(18, instanceCount)).toBe(78)

    const largestAcceptedCount = Math.floor((Number.MAX_SAFE_INTEGER - 8) / 2)
    expect([0, instanceCount, largestAcceptedCount]
      .map(count => textOpenWorldQuestSettlementLimitV1(17, count))).toEqual([32, 32, 32])

    for (const [version, count] of [
      [0, instanceCount],
      [18.5, instanceCount],
      [18, -1],
      [18, 1.5],
      [18, largestAcceptedCount + 1],
    ]) {
      expect(() => textOpenWorldQuestSettlementLimitV1(version!, count!))
        .toThrow('任务系统结算上限输入无效')
    }
  })
})
