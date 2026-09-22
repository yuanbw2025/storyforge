import { describe, expect, it } from 'vitest'
import {
  classifyTextOpenWorldPlayerQuestLogCategoryV1,
  projectTextOpenWorldPlayerQuestLogV1,
} from '../../src/lib/open-world/player-quest-log'
import { createTextOpenWorldEffectCatalogV1 } from '../../src/lib/open-world/effect-dsl'
import { createTextOpenWorldOutcomeFingerprintV1 } from '../../src/lib/open-world/event-contract'
import { createTextOpenWorldObjectiveCatalogV1 } from '../../src/lib/open-world/objective-state'
import { createTextOpenWorldQuestTransitionCatalogV1 } from '../../src/lib/open-world/quest-state-machine'
import {
  createTextOpenWorldDirectorQuestInstanceV1,
  createTextOpenWorldQuestInstanceKeyV1,
} from '../../src/lib/open-world/quests'
import { createInitialTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import type {
  ProductRuntimeEvent,
  TextOpenWorldActionModuleV1,
  TextOpenWorldEffectPlanV1,
  TextOpenWorldEffectStateV1,
  TextOpenWorldItemModuleV1,
  TextOpenWorldQuestModuleV1,
  TextOpenWorldQuestStatusV1,
  TextOpenWorldRuntimePackageV1,
  TextOpenWorldSessionProjectionV1,
} from '../../src/lib/types'
import {
  createTextOpenWorldVNextFixture,
  createTextOpenWorldVNextP9Fixture,
} from '../helpers/text-open-world-vnext-fixture'

const MAIN_INSTANCE_KEY = 'quest-instance.12.quest.main.1.release.13.session-start'
const ORDINARY_INSTANCE_KEY = createTextOpenWorldQuestInstanceKeyV1({
  definitionKey: 'quest.ordinary.log', sourceKind: 'release', sourceInstanceKey: 'session-start',
})

function addDisclosedAndFutureObjectives() {
  const runtimePackage = createTextOpenWorldVNextFixture()
  const quests = runtimePackage.modules.quests.payload as TextOpenWorldQuestModuleV1
  const actions = runtimePackage.modules.actions.payload as TextOpenWorldActionModuleV1
  const items = runtimePackage.modules.items.payload as TextOpenWorldItemModuleV1
  const main = quests.quests.find(quest => quest.key === 'quest.main.1')!
  const firstStage = quests.stages.find(stage => stage.key === 'quest-stage.main.1')!
  const firstObjective = quests.objectives.find(objective => objective.key === 'objective.main.1')!

  // Keep the current objective local to the known opening region. The future
  // objective is intentionally placed at another already-known map node so a
  // projector that joins all Release associations would leak it.
  firstObjective.actionKeys = ['action.complete-main-objective']
  firstStage.objectiveKeys.push('objective.main.optional')
  main.stageKeys.push('quest-stage.main.2')
  quests.objectives.push({
    key: 'objective.main.optional', stageKey: 'quest-stage.main.1', title: '记录渠壁盐痕', optional: true,
    actionKeys: ['action.complete-main-optional'],
  }, {
    key: 'objective.main.future', stageKey: 'quest-stage.main.2', title: '未来才应揭示的渠口目标', optional: false,
    actionKeys: ['action.complete-main-future'],
  })
  quests.stages.push({
    key: 'quest-stage.main.2', questKey: 'quest.main.1', order: 2, title: '未来才应揭示的上游阶段',
    objectiveKeys: ['objective.main.future'], completionConditionKeys: ['condition.always'],
    completionActionKey: 'action.complete-main-final',
  })
  const firstCompletion = actions.effects.find(effect => effect.key === 'effect.complete-main-quest')!
  if (firstCompletion.operation !== 'transition-quest') throw new Error('fixture main completion effect must be transition-quest')
  firstCompletion.payload = {
    questKey: 'quest.main.1', status: 'active', stageKey: 'quest-stage.main.2',
  }
  actions.effects.push(
    { key: 'effect.complete-main-optional', operation: 'complete-objective', payload: { objectiveKey: 'objective.main.optional' } },
    { key: 'effect.complete-main-future', operation: 'complete-objective', payload: { objectiveKey: 'objective.main.future' } },
    { key: 'effect.complete-main-final', operation: 'transition-quest', payload: { questKey: 'quest.main.1', status: 'completed', stageKey: 'quest-stage.main.2' } },
  )
  actions.actions.push({
    key: 'action.complete-main-optional', category: 'objective-action', label: '记录盐痕', description: '记录当前渠壁的盐痕。',
    actorScope: 'player', targetScope: 'quest', locationKeys: ['location.salt-port'], requirementConditionKeys: [], costEffectKeys: [],
    successEffectKeys: ['effect.complete-main-optional'], failureEffectKeys: [], timeCostMinutes: 0,
    confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
  }, {
    key: 'action.complete-main-future', category: 'objective-action', label: '确认上游渠口', description: '确认未来阶段的上游渠口。',
    actorScope: 'player', targetScope: 'quest', locationKeys: ['location.ridge-channel'], requirementConditionKeys: [], costEffectKeys: [],
    successEffectKeys: ['effect.complete-main-future'], failureEffectKeys: [], timeCostMinutes: 0,
    confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
  }, {
    key: 'action.complete-main-final', category: 'quest-action', label: '结算最终主线阶段', description: '完成最终主线阶段。',
    actorScope: 'system', targetScope: 'quest', locationKeys: [], requirementConditionKeys: ['condition.always'], costEffectKeys: [],
    successEffectKeys: ['effect.complete-main-final'], failureEffectKeys: [], timeCostMinutes: 0,
    confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
  })
  items.rewardContracts.find(reward => reward.key === 'reward.quest-supplies')!.dropTableKeys = ['drop.salt-jackal']
  return runtimePackage
}

function addRestartableHistoryQuest(): TextOpenWorldRuntimePackageV1 {
  const runtimePackage = createTextOpenWorldVNextFixture()
  const quests = runtimePackage.modules.quests.payload as TextOpenWorldQuestModuleV1
  const actions = runtimePackage.modules.actions.payload as TextOpenWorldActionModuleV1
  quests.quests.push({
    key: 'quest.ordinary.log', type: 'ordinary', ownerKind: 'location', ownerKey: 'location.salt-port',
    title: '遗失的渠尺', description: '寻找工匠遗失的渠尺。', storylineKey: null,
    regionKeys: ['region.salt-port'], stageKeys: ['quest-stage.ordinary.log'], prerequisiteConditionKeys: [],
    rewardEffectKeys: [], rewardContractKey: null, claimActionKey: null,
    lifecyclePolicy: 'abandon-restart', timePolicy: 'waits', expirationMinutes: null, repeatable: false,
    instantiationPolicy: 'session-start', initialStatus: 'revealed', estimatedMinutes: 10, tags: ['local'],
  })
  quests.stages.push({
    key: 'quest-stage.ordinary.log', questKey: 'quest.ordinary.log', order: 1, title: '寻找渠尺',
    objectiveKeys: ['objective.ordinary.log'], completionConditionKeys: ['condition.always'],
    completionActionKey: 'action.complete-ordinary-log',
  })
  quests.objectives.push({
    key: 'objective.ordinary.log', stageKey: 'quest-stage.ordinary.log', title: '询问盐港工匠', optional: false,
    actionKeys: ['action.complete-ordinary-log-objective'],
  })
  actions.effects.push(
    { key: 'effect.complete-ordinary-log-objective', operation: 'complete-objective', payload: { objectiveKey: 'objective.ordinary.log' } },
    { key: 'effect.complete-ordinary-log', operation: 'transition-quest', payload: { questKey: 'quest.ordinary.log', status: 'completed', stageKey: 'quest-stage.ordinary.log' } },
    { key: 'effect.accept-ordinary-log', operation: 'transition-quest', payload: { questKey: 'quest.ordinary.log', status: 'accepted', stageKey: null } },
    { key: 'effect.activate-ordinary-log', operation: 'transition-quest', payload: { questKey: 'quest.ordinary.log', status: 'active', stageKey: 'quest-stage.ordinary.log' } },
    { key: 'effect.abandon-ordinary-log', operation: 'transition-quest', payload: { questKey: 'quest.ordinary.log', status: 'abandoned', stageKey: 'quest-stage.ordinary.log' } },
    { key: 'effect.reoffer-ordinary-log', operation: 'transition-quest', payload: { questKey: 'quest.ordinary.log', status: 'available', stageKey: null } },
    { key: 'effect.reveal-ordinary-log', operation: 'transition-quest', payload: { questKey: 'quest.ordinary.log', status: 'revealed', stageKey: null } },
    { key: 'effect.fail-ordinary-log', operation: 'transition-quest', payload: { questKey: 'quest.ordinary.log', status: 'failed', stageKey: 'quest-stage.ordinary.log' } },
  )
  const action = (
    key: string,
    category: TextOpenWorldActionModuleV1['actions'][number]['category'],
    label: string,
    actorScope: 'player' | 'system',
    successEffectKeys: string[],
    requirementConditionKeys: string[] = [],
    confirmationPolicy: 'never' | 'always' = 'never',
  ): TextOpenWorldActionModuleV1['actions'][number] => ({
    key, category, label, description: `${label}。`, actorScope, targetScope: 'quest', locationKeys: [],
    requirementConditionKeys, costEffectKeys: [], successEffectKeys, failureEffectKeys: [], timeCostMinutes: 0,
    confirmationPolicy, repeatPolicy: 'repeatable', cooldownMinutes: null,
  })
  actions.actions.push(
    action('action.complete-ordinary-log-objective', 'objective-action', '完成渠尺询问', 'player', ['effect.complete-ordinary-log-objective']),
    action('action.complete-ordinary-log', 'quest-action', '结算渠尺任务', 'system', ['effect.complete-ordinary-log'], ['condition.always']),
    action('action.accept-ordinary-log', 'accept-quest', '接受渠尺委托', 'player', ['effect.accept-ordinary-log', 'effect.activate-ordinary-log']),
    action('action.abandon-ordinary-log', 'abandon-quest', '放弃渠尺委托', 'player', ['effect.abandon-ordinary-log'], [], 'always'),
    action('action.reoffer-ordinary-log', 'quest-action', '重新开放渠尺委托', 'system', ['effect.reoffer-ordinary-log', 'effect.reveal-ordinary-log']),
    action('action.fail-ordinary-log', 'quest-action', '判定渠尺委托失败', 'system', ['effect.fail-ordinary-log']),
  )
  return runtimePackage
}

interface HistoryContext {
  runtimePackage: TextOpenWorldRuntimePackageV1
  state: TextOpenWorldEffectStateV1
  events: ProductRuntimeEvent[]
  lastCommandId: string | null
  lastOutcomeFingerprint: string | null
}

async function appendAuthorizedEffectEvent(input: {
  context: HistoryContext
  sessionId: number
  targetKey: string
  effectKeys: string[]
  authorization: NonNullable<TextOpenWorldEffectPlanV1['authorization']>
}) {
  const { context } = input
  const sequence = context.events.length + 1
  const commandId = `command.quest-log.${sequence}`
  const effects = createTextOpenWorldEffectCatalogV1(context.runtimePackage)
  const plan = await effects.plan({
    effectKeys: input.effectKeys, claimKey: `claim.quest-log.${sequence}`, state: context.state,
    authorization: input.authorization,
  })
  const applied = await effects.apply({ plan, state: context.state })
  const outcomeFingerprint = await createTextOpenWorldOutcomeFingerprintV1({
    commandId, commandSequence: sequence, ruleset: { key: 'storyforge.standard', version: 1 },
    randomRequests: [], plan, receipt: applied.receipt, outcome: 'success', reason: null, degradation: null,
  })
  context.state = applied.state
  context.lastCommandId = commandId
  context.lastOutcomeFingerprint = outcomeFingerprint
  context.events.push({
    projectId: 1, sessionId: input.sessionId, sequence, type: 'text-open-world.effects.applied',
    actorKey: input.authorization.kind === 'quest-transition' && input.authorization.transitions[0].actorKind === 'system'
      ? 'system' : 'player',
    targetKey: input.targetKey, commandId, baseSequence: sequence - 1, baseStateHash: plan.baseStateHash,
    payloadJson: JSON.stringify({
      schema: 'storyforge.text-open-world.effects-applied-event', version: 1,
      commandId, commandSequence: sequence, ruleset: { key: 'storyforge.standard', version: 1 },
      randomEventSequences: [], outcome: 'success', reason: null, degradation: null,
      plan, receipt: applied.receipt, outcomeFingerprint,
    }),
    createdAt: context.state.time.worldMinute,
  })
}

async function appendTransitionEvent(input: {
  context: HistoryContext
  sessionId: number
  instanceKey: string
  effectKeys: string[]
  transitions: Array<{ toStatus: TextOpenWorldQuestStatusV1; stageKey: string | null }>
}) {
  const authorization = createTextOpenWorldQuestTransitionCatalogV1(input.context.runtimePackage).prepare({
    instanceKey: input.instanceKey, state: input.context.state, transitions: input.transitions,
  })
  await appendAuthorizedEffectEvent({
    context: input.context, sessionId: input.sessionId, targetKey: input.instanceKey,
    effectKeys: input.effectKeys, authorization,
  })
}

async function appendObjectiveEvent(input: {
  context: HistoryContext
  sessionId: number
  instanceKey: string
  objectiveKey: string
  effectKey: string
}) {
  const authorization = createTextOpenWorldObjectiveCatalogV1(input.context.runtimePackage).prepare({
    instanceKey: input.instanceKey, objectiveKey: input.objectiveKey, state: input.context.state,
  })
  await appendAuthorizedEffectEvent({
    context: input.context, sessionId: input.sessionId, targetKey: input.instanceKey,
    effectKeys: [input.effectKey], authorization,
  })
}

function synchronizeProjection(
  projection: TextOpenWorldSessionProjectionV1,
  context: HistoryContext,
): TextOpenWorldSessionProjectionV1 {
  const synchronized = structuredClone(projection)
  synchronized.state = structuredClone(context.state)
  synchronized.director = structuredClone(context.state.director)
  synchronized.protocol.lastCompletedCommandId = context.lastCommandId
  synchronized.protocol.lastOutcomeFingerprint = context.lastOutcomeFingerprint
  synchronized.lastEventSequence = context.events.length
  return synchronized
}

describe('Text Open World vNext · complete player Quest log projection', () => {
  it('把四类冻结Quest映射到玩家分类，而不把瞬时随机事件伪装成任务', () => {
    expect(classifyTextOpenWorldPlayerQuestLogCategoryV1('mainline')).toBe('main')
    expect(classifyTextOpenWorldPlayerQuestLogCategoryV1('significant')).toBe('significant')
    expect(classifyTextOpenWorldPlayerQuestLogCategoryV1('ordinary')).toBe('ordinary')
    expect(classifyTextOpenWorldPlayerQuestLogCategoryV1('template')).toBe('random')
  })

  it('投影显式追踪、当前Stage、必需/可选目标、期限与筛选，并隐藏未来Stage关联', () => {
    const runtimePackage = addDisclosedAndFutureObjectives()
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    const main = projection.state.quests.instancesByKey[MAIN_INSTANCE_KEY]
    main.status = 'active'
    main.acceptedAtWorldMinute = 480
    main.currentStageKey = 'quest-stage.main.1'
    main.objectiveStatusByKey['objective.main.1'] = 'active'
    main.objectiveStatusByKey['objective.main.optional'] = 'active'

    const random = createTextOpenWorldDirectorQuestInstanceV1(runtimePackage, {
      definitionKey: 'quest.template.supplies', sourceInstanceKey: 'quest-log.1', worldMinute: 480,
    })
    random.status = 'active'
    random.acceptedAtWorldMinute = 480
    random.currentStageKey = 'quest-stage.template.supplies'
    random.objectiveStatusByKey['objective.template.supplies'] = 'active'
    projection.state.quests.instancesByKey[random.instanceKey] = random
    projection.state.quests.tracking.pinnedInstanceKeys = [random.instanceKey]
    projection.state.director.generatedQuestInstanceCount = 1
    projection.state.director.revealedQuestInstanceKeys = [random.instanceKey]
    projection.state.director.activeQuestInstanceKeys = [random.instanceKey]
    projection.state.director.drawCount = 1
    projection.state.director.history = [{
      drawNumber: 1, worldMinute: 480, regionKey: 'region.salt-port', trigger: 'talk',
      outcomeKind: 'template-quest', sourceKey: 'template.supplies', questInstanceKey: random.instanceKey,
      variantTextKey: 'task-text.supplies.2', fingerprint: 'fingerprint.supplies', intensity: 2,
    }]
    projection.director = structuredClone(projection.state.director)

    const log = projectTextOpenWorldPlayerQuestLogV1({ sessionId: 1, projection, events: [] })
    expect(log).toMatchObject({
      historyStatus: 'ready', visibleTotal: 2, filteredTotal: 2,
      facets: {
        categories: { main: 1, significant: 0, ordinary: 0, random: 1 },
        statuses: { active: 2 }, primary: 1, pinned: 1, untracked: 0,
      },
    })
    expect(log.entries.map(entry => [entry.category, entry.tracking])).toEqual([
      ['main', 'primary'], ['random', 'pinned'],
    ])
    const mainLog = log.entries[0]
    expect(mainLog).toMatchObject({
      title: '断流的盐渠', status: 'active',
      currentStage: { stageKey: 'quest-stage.main.1', title: '检查内渠' },
      owner: { kind: 'actor', key: 'actor.caretaker', title: '岑阿婆' },
      lifecycle: {
        lifecyclePolicy: 'protected-wait', timePolicy: 'waits', estimatedMinutes: 30,
        abandonment: 'protected', reofferWindow: 'not-restartable',
      },
      reward: {
        contractKey: 'reward.quest-main', title: '断流盐渠任务奖励',
        configured: true, claimable: false, claimed: false,
        preview: { mode: 'fixed-preview', lines: ['获得100点经验'] },
      },
    })
    expect(mainLog.stages).toHaveLength(1)
    expect(mainLog.stages[0].objectives).toMatchObject([
      { objectiveKey: 'objective.main.1', required: true, status: 'active' },
      { objectiveKey: 'objective.main.optional', required: false, status: 'active' },
    ])
    expect(JSON.stringify(mainLog)).not.toContain('未来才应揭示')
    expect(mainLog).not.toHaveProperty('hiddenFutureStageCount')
    expect(mainLog.locations.map(location => location.locationKey)).toEqual(['location.salt-port'])
    expect(mainLog.regions.map(region => region.regionKey)).toEqual(['region.salt-port'])
    expect(mainLog.locations[0]).toMatchObject({
      title: '盐港广场', knowledge: 'visited', current: true,
      mapFocus: { kind: 'map-location', locationKey: 'location.salt-port' },
    })
    expect(JSON.stringify(mainLog.locations)).not.toContain('action.')
    expect(log.entries[1]).toMatchObject({
      category: 'random', title: '渠砖缺料', description: '修补渠墙还缺两块盐晶。',
      tracking: 'pinned', deadline: { label: '剩余1天' },
      owner: { kind: 'region', key: 'region.salt-port', title: '盐港' },
      lifecycle: { abandonment: 'terminal', reofferWindow: 'not-restartable' },
      reward: {
        preview: {
          mode: 'fixed-preview-and-random-hidden', lines: ['获得10盐票'],
        },
      },
    })
    expect(log.entries[1].title).not.toBe('短缺物资')
    expect(JSON.stringify(log.entries[1].reward.preview)).not.toContain('盐晶')

    expect(projectTextOpenWorldPlayerQuestLogV1({
      sessionId: 1, projection, events: [],
      filter: { categories: ['main'], statuses: ['active'], tracking: 'tracked' },
    }).entries.map(entry => entry.instanceKey)).toEqual([MAIN_INSTANCE_KEY])
    expect(projectTextOpenWorldPlayerQuestLogV1({
      sessionId: 1, projection, events: [], filter: { tracking: 'pinned' },
    }).entries.map(entry => entry.instanceKey)).toEqual([random.instanceKey])
    expect(projectTextOpenWorldPlayerQuestLogV1({
      sessionId: 1, projection, events: [], filter: { statuses: ['completed'] },
    }).entries).toEqual([])
  })

  it('不显示locked/available实例，且显式primary为空时绝不拿pin冒充', () => {
    for (const status of ['locked', 'available'] as const) {
      const projection = createInitialTextOpenWorldSessionProjectionV1(createTextOpenWorldVNextFixture())
      const main = projection.state.quests.instancesByKey[MAIN_INSTANCE_KEY]
      main.status = status
      main.offeredAtWorldMinute = null
      projection.state.quests.tracking.primaryInstanceKey = null
      expect(projectTextOpenWorldPlayerQuestLogV1({ sessionId: 1, projection, events: [] })).toMatchObject({
        visibleTotal: 0, entries: [], facets: { primary: 0, pinned: 0, untracked: 0 },
      })
    }

    const runtimePackage = createTextOpenWorldVNextFixture()
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    projection.state.quests.tracking.primaryInstanceKey = null
    const random = createTextOpenWorldDirectorQuestInstanceV1(runtimePackage, {
      definitionKey: 'quest.template.supplies', sourceInstanceKey: 'pin-only.1', worldMinute: 480,
    })
    projection.state.quests.instancesByKey[random.instanceKey] = random
    projection.state.quests.tracking.pinnedInstanceKeys = [random.instanceKey]
    projection.state.director.generatedQuestInstanceCount = 1
    projection.state.director.revealedQuestInstanceKeys = [random.instanceKey]
    projection.director = structuredClone(projection.state.director)
    const log = projectTextOpenWorldPlayerQuestLogV1({ sessionId: 1, projection, events: [] })
    expect(log.entries.find(entry => entry.instanceKey === random.instanceKey)?.tracking).toBe('pinned')
    expect(log.facets.primary).toBe(0)
  })

  it('只显示任务关联且当前Session已经揭示的关键事实', () => {
    const runtimePackage = createTextOpenWorldVNextP9Fixture()
    const narrative = runtimePackage.modules.narrative.payload
    if (narrative.version !== 2) throw new Error('fixture必须提供Narrative v2')
    narrative.scenes
      .filter(scene => scene.questKey === 'quest.main.1')
      .forEach(scene => { scene.allowedKnowledgeClaimKeys = ['knowledge.caretaker'] })
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)

    projection.state.knowledge.visibilityByKey['knowledge.caretaker'] = 'hidden'
    expect(projectTextOpenWorldPlayerQuestLogV1({ sessionId: 1, projection, events: [] })
      .entries[0]?.knownFacts).toEqual([])

    projection.state.knowledge.visibilityByKey['knowledge.caretaker'] = 'rumor'
    expect(projectTextOpenWorldPlayerQuestLogV1({ sessionId: 1, projection, events: [] })
      .entries[0]?.knownFacts).toEqual([])

    runtimePackage.modules.knowledge.payload.rumors.push({
      key: 'rumor.a-unread-caretaker', knowledgeKey: 'knowledge.caretaker',
      text: '这条传闻从未被当前存档读到。', reliability: 'likely',
    })
    projection.state.knowledge.readRumorKeys = ['rumor.channel']
    expect(projectTextOpenWorldPlayerQuestLogV1({ sessionId: 1, projection, events: [] })
      .entries[0]?.knownFacts).toEqual([{
        knowledgeKey: 'knowledge.caretaker',
        title: '老守渠人',
        content: '有人看见断脊渠口附近有野兽。',
        visibility: 'rumor',
      }])

    projection.state.knowledge.visibilityByKey['knowledge.caretaker'] = 'known'
    expect(projectTextOpenWorldPlayerQuestLogV1({ sessionId: 1, projection, events: [] })
      .entries[0]?.knownFacts).toEqual([{
        knowledgeKey: 'knowledge.caretaker',
        title: '老守渠人',
        content: '岑阿婆知道盐渠的旧路线。',
        visibility: 'known',
      }])
  })

  it('不会借已知事实提前暴露它与未来任务收束场景的关联', () => {
    const runtimePackage = createTextOpenWorldVNextP9Fixture()
    const narrative = runtimePackage.modules.narrative.payload
    if (narrative.version !== 2) throw new Error('fixture必须提供Narrative v2')
    narrative.scenes.forEach(scene => { scene.allowedKnowledgeClaimKeys = [] })
    narrative.scenes.find(scene => scene.key === 'scene.resolution.main')!
      .allowedKnowledgeClaimKeys = ['knowledge.caretaker']
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    projection.state.knowledge.visibilityByKey['knowledge.caretaker'] = 'known'

    expect(projectTextOpenWorldPlayerQuestLogV1({ sessionId: 1, projection, events: [] })
      .entries[0]?.knownFacts).toEqual([])

    const main = projection.state.quests.instancesByKey[MAIN_INSTANCE_KEY]
    main.status = 'completed'
    main.acceptedAtWorldMinute = projection.state.time.worldMinute
    main.currentStageKey = 'quest-stage.main.1'
    main.objectiveStatusByKey['objective.main.1'] = 'completed'
    main.terminalAtWorldMinute = projection.state.time.worldMinute
    expect(projectTextOpenWorldPlayerQuestLogV1({ sessionId: 1, projection, events: [] })
      .entries[0]?.knownFacts.map(fact => fact.title)).toEqual(['老守渠人'])
  })

  it('旧Action v15角色委托沿用运行时端点归一，不把误写的未来Stage地点挂进日志', () => {
    const runtimePackage = createTextOpenWorldVNextP9Fixture()
    const narrative = runtimePackage.modules.narrative.payload
    if (narrative.version !== 2) throw new Error('fixture必须提供Narrative v2')
    narrative.scenes
      .filter(scene => scene.questKey === 'quest.main.1'
        && (scene.sourceKind === 'quest-offer' || scene.sourceKind === 'quest-resolution'))
      .forEach(scene => {
        scene.regionKey = 'region.ridge'
        scene.locationKey = 'location.ridge-channel'
      })
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    const entry = projectTextOpenWorldPlayerQuestLogV1({ sessionId: 1, projection, events: [] }).entries[0]

    expect(entry.locations.map(location => location.locationKey)).toEqual(['location.salt-port'])
    expect(JSON.stringify(entry.locations)).not.toContain('location.ridge-channel')
  })

  it('从canonical Effect事件还原接取、目标、放弃、重接、失败与过期证据，且严格归属任务实例', async () => {
    const sessionId = 41
    const runtimePackage = addRestartableHistoryQuest()
    const initialProjection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    const context: HistoryContext = {
      runtimePackage, state: structuredClone(initialProjection.state), events: [],
      lastCommandId: null, lastOutcomeFingerprint: null,
    }
    await appendTransitionEvent({
      context, sessionId, instanceKey: ORDINARY_INSTANCE_KEY,
      effectKeys: ['effect.accept-ordinary-log', 'effect.activate-ordinary-log'],
      transitions: [
        { toStatus: 'accepted', stageKey: null },
        { toStatus: 'active', stageKey: 'quest-stage.ordinary.log' },
      ],
    })
    await appendObjectiveEvent({
      context, sessionId, instanceKey: ORDINARY_INSTANCE_KEY,
      objectiveKey: 'objective.ordinary.log', effectKey: 'effect.complete-ordinary-log-objective',
    })
    await appendTransitionEvent({
      context, sessionId, instanceKey: ORDINARY_INSTANCE_KEY,
      effectKeys: ['effect.abandon-ordinary-log'],
      transitions: [{ toStatus: 'abandoned', stageKey: 'quest-stage.ordinary.log' }],
    })

    const abandonedProjection = synchronizeProjection(initialProjection, context)
    const abandoned = projectTextOpenWorldPlayerQuestLogV1({
      sessionId, projection: abandonedProjection, events: context.events,
    }).entries.find(entry => entry.instanceKey === ORDINARY_INSTANCE_KEY)
    expect(abandoned).toMatchObject({
      status: 'abandoned', lifecycle: { abandonment: 'terminal', reofferWindow: 'not-restartable' },
      reward: { configured: false, preview: { mode: 'none', lines: [] } },
    })
    expect((runtimePackage.modules.actions.payload as TextOpenWorldActionModuleV1).version).toBeLessThan(16)
    expect(abandoned?.history.map(entry => entry.kind)).toEqual([
      'accepted', 'activated', 'objective-completed', 'abandoned',
    ])

    context.state.time.worldMinute = 600
    await appendTransitionEvent({
      context, sessionId, instanceKey: ORDINARY_INSTANCE_KEY,
      effectKeys: ['effect.reoffer-ordinary-log', 'effect.reveal-ordinary-log'],
      transitions: [{ toStatus: 'available', stageKey: null }, { toStatus: 'revealed', stageKey: null }],
    })
    await appendTransitionEvent({
      context, sessionId, instanceKey: ORDINARY_INSTANCE_KEY,
      effectKeys: ['effect.accept-ordinary-log', 'effect.activate-ordinary-log'],
      transitions: [
        { toStatus: 'accepted', stageKey: null },
        { toStatus: 'active', stageKey: 'quest-stage.ordinary.log' },
      ],
    })
    await appendTransitionEvent({
      context, sessionId, instanceKey: ORDINARY_INSTANCE_KEY,
      effectKeys: ['effect.fail-ordinary-log'],
      transitions: [{ toStatus: 'failed', stageKey: 'quest-stage.ordinary.log' }],
    })

    const timed = createTextOpenWorldDirectorQuestInstanceV1(runtimePackage, {
      definitionKey: 'quest.template.supplies', sourceInstanceKey: 'quest-log-expiry.1', worldMinute: 600,
    })
    context.state.quests.instancesByKey[timed.instanceKey] = timed
    context.state.director.generatedQuestInstanceCount = 1
    context.state.director.revealedQuestInstanceKeys = [timed.instanceKey]
    context.state.director.activeQuestInstanceKeys = []
    context.state.time.worldMinute = timed.deadlineWorldMinute!
    await appendTransitionEvent({
      context, sessionId, instanceKey: timed.instanceKey,
      effectKeys: ['effect.expire-supplies-unstarted'],
      transitions: [{ toStatus: 'expired', stageKey: null }],
    })
    context.state.director.revealedQuestInstanceKeys = []
    const projection = synchronizeProjection(initialProjection, context)
    const log = projectTextOpenWorldPlayerQuestLogV1({
      sessionId, projection, events: context.events,
      filter: { statuses: ['failed', 'expired'] },
    })
    expect(log.historyStatus).toBe('ready')
    expect(log.entries.map(entry => [entry.instanceKey, entry.status])).toEqual([
      [ORDINARY_INSTANCE_KEY, 'failed'], [timed.instanceKey, 'expired'],
    ])
    const ordinary = log.entries[0]
    expect(ordinary.history.map(entry => entry.kind)).toEqual([
      'accepted', 'activated', 'objective-completed', 'abandoned', 'reoffered', 'accepted', 'activated', 'failed',
    ])
    expect(ordinary.history.map(entry => entry.summary)).toContain('遗失的渠尺：已重新开放')
    expect(ordinary.history.map(entry => entry.summary)).toContain('遗失的渠尺：永久失败')
    expect(ordinary.history.map(entry => entry.summary).join(' ')).not.toMatch(/：(?:accepted|failed|reoffered)\b/)
    expect(ordinary.lifecycleEvidence).toMatchObject({
      failed: [{ instanceKey: ORDINARY_INSTANCE_KEY, kind: 'failed' }],
      abandoned: [{ instanceKey: ORDINARY_INSTANCE_KEY, kind: 'abandoned' }],
      reoffered: [{ instanceKey: ORDINARY_INSTANCE_KEY, kind: 'reoffered' }],
      expired: [],
    })
    const expired = log.entries[1]
    expect(expired.history).toMatchObject([{ instanceKey: timed.instanceKey, kind: 'expired' }])
    expect(expired.lifecycleEvidence).toMatchObject({
      expired: [{ instanceKey: timed.instanceKey, kind: 'expired' }],
      failed: [], abandoned: [], reoffered: [],
    })
    expect(ordinary.history.every(entry => entry.instanceKey === ORDINARY_INSTANCE_KEY)).toBe(true)
    expect(expired.history.every(entry => entry.instanceKey === timed.instanceKey)).toBe(true)
  })

  it('Projection领先Event读取时保留任务主体并等待历史，完整但损坏的事件前缀失败关闭', () => {
    const projection = createInitialTextOpenWorldSessionProjectionV1(createTextOpenWorldVNextFixture())
    projection.lastEventSequence = 2
    const awaiting = projectTextOpenWorldPlayerQuestLogV1({ sessionId: 7, projection, events: [] })
    expect(awaiting).toMatchObject({ historyStatus: 'awaiting-events', visibleTotal: 1 })
    expect(awaiting.entries[0]).toMatchObject({ instanceKey: MAIN_INSTANCE_KEY, history: [] })

    const malformed = [{
      projectId: 1, sessionId: 7, sequence: 2, type: 'narrative.started' as const,
      payloadJson: '{}', createdAt: 1,
    }, {
      projectId: 1, sessionId: 7, sequence: 1, type: 'narrative.node.entered' as const,
      payloadJson: '{}', createdAt: 2,
    }]
    expect(() => projectTextOpenWorldPlayerQuestLogV1({ sessionId: 7, projection, events: malformed }))
      .toThrow('事件序号不连续')
    const crossSession = malformed.map((event, index) => ({ ...event, sequence: index + 1, sessionId: index ? 8 : 7 }))
    expect(() => projectTextOpenWorldPlayerQuestLogV1({ sessionId: 7, projection, events: crossSession }))
      .toThrow('事件流混入其他Session')
    const malformedEffect = malformed.map((event, index) => ({
      ...event, sequence: index + 1, sessionId: 7,
      type: index === 1 ? 'text-open-world.effects.applied' as const : 'narrative.started' as const,
      payloadJson: index === 1 ? '{}' : event.payloadJson,
    }))
    expect(() => projectTextOpenWorldPlayerQuestLogV1({ sessionId: 7, projection, events: malformedEffect }))
      .toThrow('effectsEvent字段不符合合同')
  })
})
