import { estimateTokens } from '../ai/context-budget'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { db } from '../db/schema'
import {
  readProductRuntimeStateVersion,
  readVerifiedProductRuntimeHeadV1,
} from '../product/runtime-core'
import type {
  ContextResourceDescriptorV1,
  ContextResourceKind,
  ContextResourceProviderV1,
  ContextResourceReadV1,
  ContextSourceRefV1,
  FrozenResourceScopeV1,
  OriginalEvidenceReadInputV1,
  OriginalEvidenceReadV1,
  ResourceListInputV1,
  ResourcePageV1,
  ResourceReadInputV1,
  ResourceSearchInputV1,
} from '../registry/types'
import type {
  ProductRuntimeEvent,
  ProductRuntimeSession,
  TextOpenWorldParsedModulesV1,
} from '../types'
import { createTextOpenWorldActionRegistryV1 } from './action-registry'
import { projectTextOpenWorldActorsV1 } from './actors'
import { projectTextOpenWorldDirectorCandidatesV1 } from './director'
import { deriveTextOpenWorldEquippedItemKeysV1, deriveTextOpenWorldInventoryQuantitiesV1 } from './inventory'
import { projectTextOpenWorldPlayerMapV1 } from './map-view'
import { parseTextOpenWorldModulesV1 } from './modules'
import { projectTextOpenWorldQuestInstancesV1 } from './quests'
import { projectTextOpenWorldScenesV1 } from './scene-projection'
import {
  deriveTextOpenWorldContextsV1,
  parseTextOpenWorldSessionProjectionV1,
} from './session-projection'
import {
  assertTextOpenWorldVNextProjectionBindingV1,
  verifyTextOpenWorldVNextSessionBindingV1,
} from './session-binding'
import { createTextOpenWorldSkillCatalogV1 } from './skills'
import { projectTextOpenWorldClockWeatherV1 } from './weather'
import {
  TEXT_OPEN_WORLD_DIRECTOR_TRIGGERS_V1,
  TEXT_OPEN_WORLD_RUNTIME_CONTEXT_NORMALIZATION_VERSION_V1,
  TEXT_OPEN_WORLD_RUNTIME_CONTEXT_PROVIDER_ID_V1,
  TEXT_OPEN_WORLD_RUNTIME_CONTEXT_PROVIDER_VERSION_V1,
  TEXT_OPEN_WORLD_RUNTIME_CONTEXT_RESOURCE_KINDS_V1,
} from './runtime-ai-context-provider-contract'

export {
  TEXT_OPEN_WORLD_DIRECTOR_TRIGGERS_V1,
  TEXT_OPEN_WORLD_RUNTIME_CONTEXT_NORMALIZATION_VERSION_V1,
  TEXT_OPEN_WORLD_RUNTIME_CONTEXT_PROVIDER_ID_V1,
  TEXT_OPEN_WORLD_RUNTIME_CONTEXT_PROVIDER_VERSION_V1,
  TEXT_OPEN_WORLD_RUNTIME_CONTEXT_RESOURCE_KINDS_V1,
} from './runtime-ai-context-provider-contract'

type RuntimeSlice = string

type PlayerKnownFactV1 = {
  key: string
  knowledgeKey: string
  kind: TextOpenWorldParsedModulesV1['knowledge']['entries'][number]['kind']
  title: string
  content: string
  visibility: 'known' | 'rumor'
  reliability?: TextOpenWorldParsedModulesV1['knowledge']['rumors'][number]['reliability']
}

export interface TextOpenWorldRuntimeContextResourceV1 {
  descriptor: ContextResourceDescriptorV1
  fullContent: string
  focusedContent: string
  logicalSlices: RuntimeSlice[]
  targetKeys: string[]
}

export interface TextOpenWorldRuntimeContextCatalogV1 {
  session: ProductRuntimeSession & { id: number }
  sequence: number
  stateHash: string
  runtimeSourceHash: string
  visibilityHash: string
  scopeFingerprint: string
  resources: TextOpenWorldRuntimeContextResourceV1[]
}

const CATALOG_CACHE_LIMIT = 16
const catalogCache = new Map<string, TextOpenWorldRuntimeContextCatalogV1>()

class TextOpenWorldRuntimeContextProviderErrorV1 extends Error {
  constructor(readonly code: string, message: string) {
    super(`[text-open-world-runtime-context:${code}] ${message}`)
    this.name = 'TextOpenWorldRuntimeContextProviderErrorV1'
  }
}

function fail(code: string, message: string): never {
  throw new TextOpenWorldRuntimeContextProviderErrorV1(code, message)
}

function safeKey(value: string | number): string {
  return encodeURIComponent(String(value).normalize('NFC'))
}

function resourceKey(_sessionId: number, suffix: string): string {
  return `fact:tow-runtime:${suffix}`
}

function typedResourceKey(kind: ContextResourceKind, _sessionId: number, suffix: string): string {
  return `${kind}:tow-runtime:${suffix}`
}

function entityAnchor(key: string): string {
  return `fact:tow-entity:${safeKey(key)}`
}

function concise(value: string, maximum = 780): string {
  const normalized = value.trim().replace(/\s+/g, ' ')
  return normalized.length <= maximum ? normalized : `${normalized.slice(0, maximum - 1)}…`
}

function parseEventPayload(event: ProductRuntimeEvent): unknown {
  try { return JSON.parse(event.payloadJson) }
  catch { fail('event-json', `事件 ${event.sequence} payload 不是合法JSON`) }
}

async function exactSourceRefs(input: {
  session: ProductRuntimeSession & { id: number }
  stateJson: string
  stateHash: string
  sequence: number
  fromCache: boolean
  events: readonly ProductRuntimeEvent[]
  binding: Awaited<ReturnType<typeof verifyTextOpenWorldVNextSessionBindingV1>>
}): Promise<ContextSourceRefV1[]> {
  const stateHash = await sha256Text(input.stateJson)
  const exactCachedHead = input.fromCache
    && input.session.runtimeHeadSequence >= 0
    && input.session.runtimeHeadStateJson === input.stateJson
    && input.session.runtimeHeadStateHash === input.stateHash
  if (stateHash !== input.stateHash || (input.fromCache && !exactCachedHead)) {
    fail('runtime-head', '正式AI读取的Session运行状态头无法验签')
  }
  const stateRefs: ContextSourceRefV1[] = exactCachedHead
    ? [{
        table: 'productRuntimeSessions',
        recordId: input.session.id,
        field: 'runtimeHeadStateJson',
        revision: input.session.runtimeHeadSequence,
        contentHash: stateHash,
      }]
    : [{
        table: 'productRuntimeSessions',
        recordId: input.session.id,
        field: 'initialStateJson',
        revision: 0,
        contentHash: await sha256Text(input.session.initialStateJson),
      }, ...await eventSourceRefs(input.events)]
  if (input.binding.formal.source.kind === 'release') {
    const release = input.binding.formal.source.release
    return [...stateRefs, {
      table: 'productReleases',
      recordId: release.id,
      field: 'manifestJson',
      revision: release.version,
      contentHash: await sha256Text(release.manifestJson),
    }]
  }
  const build = input.binding.formal.source.build
  return [...stateRefs, {
    table: 'productBuilds',
    recordId: build.id,
    field: 'previewManifestJson',
    revision: `${build.buildNumber}:${build.stateRevision}`,
    contentHash: await sha256Text(build.previewManifestJson),
  }]
}

async function eventSourceRefs(events: readonly ProductRuntimeEvent[]): Promise<ContextSourceRefV1[]> {
  if (events.length > 64) fail('event-evidence', '单项终态结果超过64条事件证据，拒绝静默截断')
  return Promise.all(events.map(async event => {
    if (event.id == null) fail('event-evidence', `事件 ${event.sequence} 缺少持久化ID`)
    return {
      table: 'productRuntimeEvents',
      recordId: event.id!,
      field: 'payloadJson',
      revision: event.sequence,
      contentHash: await sha256Text(event.payloadJson),
    }
  }))
}

function relationTargets(keys: readonly string[]): ContextResourceDescriptorV1['relations'] {
  return [...new Set(keys)].sort().map(key => ({
    kind: 'same-entity' as const,
    targetResourceKey: entityAnchor(key),
    direction: 'undirected' as const,
  }))
}

function eventGroups(events: readonly ProductRuntimeEvent[]): Array<{
  commandId: string
  events: ProductRuntimeEvent[]
}> {
  const commandIdFor = (event: ProductRuntimeEvent): string | null => {
    if (event.commandId) return event.commandId
    const payload = parseEventPayload(event)
    if (!payload || typeof payload !== 'object') return null
    const raw = payload as Record<string, unknown>
    if (typeof raw.commandId === 'string') return raw.commandId
    if (raw.envelope && typeof raw.envelope === 'object') {
      const envelope = raw.envelope as Record<string, unknown>
      if (typeof envelope.commandId === 'string') return envelope.commandId
    }
    return null
  }
  const commandEvents = events.filter(event => (
    event.type === 'text-open-world.command.committed' && event.commandId
  ))
  return commandEvents.flatMap(command => {
    const terminal = events.find(event => (
      event.type === 'text-open-world.effects.applied'
      && commandIdFor(event) === command.commandId
      && event.sequence >= command.sequence
    ))
    if (!terminal || !command.commandId) return []
    return [{
      commandId: command.commandId,
      events: events.filter(event => (
        commandIdFor(event) === command.commandId
        && event.sequence >= command.sequence
        && event.sequence <= terminal.sequence
      )).sort((left, right) => left.sequence - right.sequence),
    }]
  })
}

async function loadCatalog(scope: FrozenResourceScopeV1): Promise<TextOpenWorldRuntimeContextCatalogV1> {
  const sessionId = scope.productRuntimeSessionId
  if (!Number.isSafeInteger(sessionId) || Number(sessionId) < 1) {
    fail('scope', '冻结资源scope缺少productRuntimeSessionId')
  }
  const sessionValue = await db.productRuntimeSessions.get(Number(sessionId))
  if (!sessionValue?.id || sessionValue.kind !== 'text-open-world'
    || sessionValue.projectId !== scope.projectId
    || (scope.worldId != null && scope.worldId !== sessionValue.worldId)
    || (scope.workId != null && scope.workId !== sessionValue.workId)
    || (scope.worldGroupId !== undefined
      && (scope.worldGroupId ?? null) !== (sessionValue.worldGroupId ?? null))) {
    fail('scope', 'ProductRuntimeSession不存在、产品类型不符或越过WorkspaceScope')
  }
  const session = sessionValue as ProductRuntimeSession & { id: number }
  const beforeVersion = await readProductRuntimeStateVersion(session.id)
  const cacheKey = canonicalStringify({
    projectId: session.projectId,
    worldId: session.worldId,
    workId: session.workId,
    worldGroupId: session.worldGroupId ?? null,
    sessionId: session.id,
    productReleaseId: session.productReleaseId,
    productBuildId: session.productBuildId,
    runtimeSourceHash: session.runtimeSourceHash,
    updatedAt: session.updatedAt,
    sequence: beforeVersion.sequence,
    stateHash: beforeVersion.stateHash,
  })
  const cached = catalogCache.get(cacheKey)
  if (cached) return cached
  const [binding, head, events] = await Promise.all([
    verifyTextOpenWorldVNextSessionBindingV1(session),
    readVerifiedProductRuntimeHeadV1(session),
    db.productRuntimeEvents.where('sessionId').equals(session.id).sortBy('sequence'),
  ])
  if (head.sequence !== beforeVersion.sequence || head.stateHash !== beforeVersion.stateHash) {
    fail('runtime-head', 'Session运行状态在读取期间发生变化')
  }
  const projection = parseTextOpenWorldSessionProjectionV1(head.state.textOpenWorld)
  assertTextOpenWorldVNextProjectionBindingV1(projection, binding)
  // ProductRuntimeState also contains the instance-created lifecycle events.
  // The vNext projection records only the latest event that changed its own
  // sub-state, so it may legitimately trail the global product sequence.
  if (projection.lastEventSequence > head.sequence) fail('sequence', 'vNext投影序号不能超过产品事件序号')
  const runtimePackage = binding.runtimePackage
  const modules = parseTextOpenWorldModulesV1(runtimePackage)
  const state = projection.state
  const derived = deriveTextOpenWorldContextsV1(projection)
  const baseSourceRefs = await exactSourceRefs({
    session,
    stateJson: head.stateJson,
    stateHash: head.stateHash,
    sequence: head.sequence,
    fromCache: head.fromCache,
    events,
    binding,
  })
  const location = modules.world.locations.find(item => item.key === state.map.currentLocationKey)
    ?? fail('location', '当前位置不在冻结运行包')
  const region = modules.world.regions.find(item => item.key === location.regionKey)
    ?? fail('region', '当前地区不在冻结运行包')
  const projectedActions = createTextOpenWorldActionRegistryV1(runtimePackage).project(derived.action)
  const availableActions = projectedActions.filter(item => item.available)
  const sceneProjection = projectTextOpenWorldScenesV1(projection)
  const currentScenes = sceneProjection.status === 'ready' ? sceneProjection.scenes : []
  const actors = projectTextOpenWorldActorsV1({
    runtimePackage,
    state,
    parsedModules: modules,
    attitudeByActorKey: derived.condition.relations.attitudeByActorKey,
  })
  const visibleQuestRows = projectTextOpenWorldQuestInstancesV1(modules, state.quests)
    .filter(item => !['locked', 'available'].includes(item.instance.status))
  const currentRegionQuestRows = visibleQuestRows.filter(item => item.definition.regionKeys.includes(region.key))
  const knownFacts: PlayerKnownFactV1[] = modules.knowledge.entries.flatMap<PlayerKnownFactV1>(entry => {
    const visibility = state.knowledge.visibilityByKey[entry.key]
    if (visibility === 'known') return [{
      key: entry.key, knowledgeKey: entry.key, kind: entry.kind, title: entry.title, content: entry.content,
      visibility: 'known' as const,
    }]
    if (visibility !== 'rumor') return []
    return modules.knowledge.rumors
      .filter(rumor => rumor.knowledgeKey === entry.key && state.knowledge.readRumorKeys.includes(rumor.key))
      .map(rumor => ({
        key: rumor.key, knowledgeKey: entry.key, kind: entry.kind, title: entry.title, content: rumor.text,
        reliability: rumor.reliability, visibility: 'rumor' as const,
      }))
  })
  const clockWeather = projectTextOpenWorldClockWeatherV1({ runtimePackage, state, parsedModules: modules })
  const playerMap = projectTextOpenWorldPlayerMapV1({ runtimePackage, state })
  const inventoryQuantities = deriveTextOpenWorldInventoryQuantitiesV1(modules, state.inventory)
  const equippedItemKeys = deriveTextOpenWorldEquippedItemKeysV1(modules, state.inventory)
  const skillCatalog = createTextOpenWorldSkillCatalogV1(runtimePackage)
  const skills = skillCatalog.project({
    learnedSkillKeys: state.player.learnedSkillKeys,
    skillResource: state.player.skillResource,
    conditionResults: Object.fromEntries(Object.entries(derived.action.conditionResults)
      .map(([key, result]) => [key, result.satisfied])),
  }).filter(item => item.learned).map(item => ({
    key: item.skill.key,
    title: item.skill.title,
    activation: item.skill.activation,
    kind: item.skill.kind,
    resourceCost: item.skill.resourceCost,
    available: item.available,
    unavailableReasons: item.unavailableReasons,
  }))
  const statuses = skillCatalog.projectStatuses(state.player.statusKeys)
    .filter(item => item.active)
    .map(item => ({ key: item.status.key, title: item.status.title, polarity: item.status.polarity, description: item.status.description }))

  type Draft = Omit<TextOpenWorldRuntimeContextResourceV1, 'descriptor'> & {
    kind: ContextResourceKind
    key: string
    title: string
    summary: string
    sourceRefs?: ContextSourceRefV1[]
    priority?: ContextResourceDescriptorV1['priority']
  }
  const drafts: Draft[] = []
  const add = (draft: Omit<Draft, 'fullContent' | 'focusedContent'> & { content: unknown; focused?: unknown }) => {
    const fullContent = canonicalStringify(draft.content)
    drafts.push({
      kind: draft.kind,
      key: draft.key,
      title: draft.title,
      summary: concise(draft.summary),
      fullContent,
      focusedContent: canonicalStringify(draft.focused ?? draft.content),
      logicalSlices: [...new Set(draft.logicalSlices)].sort(),
      targetKeys: [...new Set(draft.targetKeys)].sort(),
      sourceRefs: draft.sourceRefs,
      priority: draft.priority,
    })
  }

  add({
    kind: 'fact', key: resourceKey(session.id, 'boundary'), title: '运行时事实边界',
    summary: `冻结来源、事件序号 ${head.sequence} 与只读叙事权限。`,
    logicalSlices: ['runtime.boundary'], targetKeys: [], priority: 'must-read',
    content: {
      productType: 'text-open-world', sessionTitle: session.title,
      sequence: head.sequence, stateHash: head.stateHash, runtimeSourceHash: binding.formal.packageHash,
      freedomBoundary: runtimePackage.experienceContract.freedomBoundary,
      authority: {
        mayReadPlayerVisibleProjection: true,
        mayProposeStrictJsonCandidate: true,
        mayCommitActionOrEffect: false,
        mayInventFactOrResult: false,
        mayRevealLockedOrFutureContent: false,
      },
    },
  })
  add({
    kind: 'location', key: typedResourceKey('location', session.id, 'scene-current'), title: '当前场景',
    summary: `${region.title}／${location.title}及当前已满足条件的场景。`,
    logicalSlices: ['scene.current'],
    targetKeys: [region.key, location.key, ...currentScenes.flatMap(scene => scene.participantKeys)],
    content: {
      region: { key: region.key, title: region.title, description: region.description, theme: region.theme },
      location: {
        key: location.key, title: location.title, description: location.description,
        purpose: location.purpose, earlyArrivalDescription: location.earlyArrivalDescription,
      },
      scenes: currentScenes.map(scene => ({
        key: scene.key, sourceKind: scene.sourceKind, sourceKey: scene.sourceKey,
        title: scene.title, openingText: scene.openingText, bodyText: scene.bodyText,
        actor: scene.actor, participantKeys: scene.participantKeys,
        presentationMode: scene.presentationMode, compatibilityNotice: scene.compatibilityNotice,
      })),
      recommendedSceneKey: sceneProjection.status === 'ready' ? sceneProjection.recommendedSceneKey : null,
      compatibility: sceneProjection.status === 'unsupported' ? sceneProjection.message : null,
    },
  })
  add({
    kind: 'fact', key: resourceKey(session.id, 'actions-available'), title: '当前可执行Action闭集',
    summary: `${availableActions.length}项经代码校验可执行的Action及合法目标。`,
    logicalSlices: ['actions.available'], targetKeys: availableActions.flatMap(item => [item.action.key, ...item.validTargetKeys]),
    content: availableActions.map(item => ({
      key: item.action.key, category: item.action.category, label: item.action.label,
      targetScope: item.targetScope, validTargetKeys: item.validTargetKeys,
      confirmationRequired: item.confirmationRequired,
    })),
  })
  add({
    kind: 'storyline-progress', key: typedResourceKey('storyline-progress', session.id, 'choices-available'), title: '当前固定选择闭集',
    summary: `${currentScenes.reduce((sum, scene) => sum + scene.fixedChoices.length, 0)}项当前场景固定选择。`,
    logicalSlices: ['choices.available'], targetKeys: currentScenes.flatMap(scene => scene.fixedChoices.flatMap(choice => [choice.key, choice.actionKey])),
    content: currentScenes.flatMap(scene => scene.fixedChoices.map(choice => ({ sceneKey: scene.key, ...choice }))),
  })
  add({
    kind: 'fact', key: resourceKey(session.id, 'player-known-facts'), title: '玩家已知事实',
    summary: `${knownFacts.length}项已知事实或已读传闻；隐藏知识不在资源中。`,
    logicalSlices: ['player.known-facts'], targetKeys: knownFacts.flatMap(item => [item.key, item.knowledgeKey]),
    content: knownFacts.map(item => ({
      key: item.key,
      knowledgeKey: item.knowledgeKey,
      title: item.title,
      visibility: item.visibility,
      ...('reliability' in item ? { reliability: item.reliability } : {}),
    })),
  })
  for (const fact of knownFacts) {
    add({
      kind: 'fact', key: resourceKey(session.id, `known-fact:${safeKey(fact.key)}`), title: fact.title,
      summary: concise(`${fact.visibility === 'known' ? '已知事实' : '已读传闻'}：${fact.content}`, 600),
      logicalSlices: ['player.known-facts'], targetKeys: [fact.key, fact.knowledgeKey],
      content: fact,
    })
  }
  add({
    kind: 'reference', key: typedResourceKey('reference', session.id, 'conversation-boundary'), title: '当前对话输入边界',
    summary: 'G6-02不伪造持久化对话历史；本轮原始文字由最终rendered request逐字留证。',
    logicalSlices: ['conversation.recent', 'conversation.closed-window'], targetKeys: [],
    content: {
      persistedConversationWindow: null,
      currentInputSource: 'rendered-request-exact-artifact',
      rule: '不得把未留证的历史对话补入上下文；G6-08接入关闭窗口摘要后替换此显式空边界。',
    },
  })
  add({
    kind: 'fact', key: resourceKey(session.id, 'player-visible-state'), title: '玩家可见角色与资源状态',
    summary: `等级${state.player.level}、生命${state.player.health}、背包装备、技能和当前状态。`,
    logicalSlices: ['player.visible-state', 'player.growth-summary'], targetKeys: ['player'],
    content: {
      identity: modules.actors.player.identity,
      progression: derived.progression,
      attributes: state.player.attributes,
      derivedStats: derived.playerStats,
      health: state.player.health,
      skillResource: state.player.skillResource,
      morality: state.relationships.morality,
      factionAffinityByKey: state.relationships.factionAffinityByKey,
      inventory: { quantities: inventoryQuantities, currency: state.inventory.currency },
      equipment: equippedItemKeys,
      skills,
      statuses,
    },
  })
  add({
    kind: 'fact', key: resourceKey(session.id, 'time-weather-current'), title: '当前时间与天气',
    summary: `第${clockWeather.day}天，${clockWeather.timePeriodLabel}，${clockWeather.weatherLabel}。`,
    logicalSlices: ['time-weather.current'], targetKeys: [clockWeather.timePeriodKey, clockWeather.weatherKey],
    content: clockWeather,
  })
  add({
    kind: 'location', key: typedResourceKey('location', session.id, 'region-current-visible'), title: '当前地区玩家视图',
    summary: `${region.title}当前状态、已发现地点及玩家可见地图布局。`,
    logicalSlices: ['region.current-visible', 'region.current-state'], targetKeys: [region.key, location.key],
    content: {
      region: { key: region.key, title: region.title, description: region.description, theme: region.theme },
      pressure: state.world.regionPressureByKey[region.key] ?? 0,
      state: state.world.regionStateByKey[region.key] ?? null,
      locations: playerMap.locations.filter(item => item.regionKey === region.key),
      layoutSource: playerMap.layoutSource,
    },
  })
  add({
    kind: 'character', key: typedResourceKey('character', session.id, 'actors-present'), title: '当前位置公开人物',
    summary: `${actors.length}名当前在场、存活且可被玩家观察的人物。`,
    logicalSlices: ['actors.present-public'], targetKeys: actors.map(actor => actor.key),
    content: actors,
  })

  for (const actor of actors) {
    const actorDefinition = modules.actors.actors.find(item => item.key === actor.key)!
    const currentActorScenes = currentScenes.filter(scene => scene.actor?.key === actor.key)
    const allowedClaimKeys = [...new Set(currentActorScenes.flatMap(scene => (
      modules.narrative.version === 2
        ? modules.narrative.scenes.find(item => item.key === scene.key)?.allowedKnowledgeClaimKeys ?? []
        : []
    )))]
    const scopedKnowledge = modules.knowledge.entries
      .filter(entry => entry.actorKeys.includes(actor.key) && allowedClaimKeys.includes(entry.key))
      .map(entry => ({ key: entry.key, kind: entry.kind, title: entry.title, content: entry.content }))
    add({
      kind: 'character', key: typedResourceKey('character', session.id, `actor:${safeKey(actor.key)}`), title: `${actor.name}公开档案`,
      summary: `${actor.name}当前在场；层级${actor.tier}，态度${actor.attitude}。`,
      logicalSlices: ['actor.present-public-dossier'], targetKeys: [actor.key, ...(actor.factionKey ? [actor.factionKey] : [])],
      content: {
        ...actor,
        portrayal: actorDefinition.tier === 'mainline' || actorDefinition.tier === 'significant'
          ? actorDefinition.portrayal : null,
      },
    })
    add({
      kind: 'character-relation', key: typedResourceKey('character-relation', session.id, `attitude:${safeKey(actor.key)}`), title: `${actor.name}当前态度`,
      summary: `${actor.name}对玩家的三档态度为${actor.attitude}。`,
      logicalSlices: ['relationship.attitude'], targetKeys: [actor.key],
      content: {
        actorKey: actor.key, attitude: actor.attitude, greetingTone: actor.greetingTone,
        optionalInteractionPolicy: actor.optionalInteractionPolicy,
        buyPriceMultiplier: actor.buyPriceMultiplier, sellPriceMultiplier: actor.sellPriceMultiplier,
      },
    })
    add({
      kind: 'fact', key: resourceKey(session.id, `actor-knowledge:${safeKey(actor.key)}`), title: `${actor.name}当前可说知识`,
      summary: `${scopedKnowledge.length}项同时满足角色知情与当前场景允许声明的事实。`,
      logicalSlices: ['actor.knowledge', 'actor.scoped-knowledge'], targetKeys: [actor.key, ...scopedKnowledge.map(item => item.key)],
      content: {
        actorKey: actor.key,
        allowedKnowledgeClaimKeys: allowedClaimKeys,
        knowledge: scopedKnowledge,
        rule: '不在本资源中的角色私密知识、未来目标和隐藏世界事实不得补全或暗示。',
      },
    })
  }

  const questView = currentRegionQuestRows.map(({ definition, instance }) => {
    const stage = instance.currentStageKey
      ? modules.quests.stages.find(item => item.key === instance.currentStageKey) ?? null
      : null
    return {
      instanceKey: instance.instanceKey,
      definitionKey: definition.key,
      type: definition.type,
      owner: { kind: definition.ownerKind, key: definition.ownerKey },
      title: definition.title,
      description: definition.description,
      status: instance.status,
      currentStage: stage ? {
        key: stage.key, title: stage.title,
        objectives: stage.objectiveKeys.map(key => {
          const objective = modules.quests.objectives.find(item => item.key === key)
          return { key, title: objective?.title ?? key, status: instance.objectiveStatusByKey[key] ?? 'inactive' }
        }),
      } : null,
      deadlineWorldMinute: instance.deadlineWorldMinute,
      rewardClaimed: instance.rewardClaimKey != null,
    }
  })
  add({
    kind: 'storyline-progress', key: typedResourceKey('storyline-progress', session.id, 'quests-active-summary'), title: '当前地区可见任务摘要',
    summary: `${questView.length}项当前地区已公开任务；锁定与仅可发放任务不在资源中。`,
    logicalSlices: ['quests.related-visible', 'quests.active-summary'],
    targetKeys: questView.flatMap(quest => [quest.instanceKey, quest.definitionKey, quest.owner.key].filter((key): key is string => !!key)),
    content: questView.map(quest => ({
      instanceKey: quest.instanceKey,
      definitionKey: quest.definitionKey,
      type: quest.type,
      owner: quest.owner,
      title: quest.title,
      status: quest.status,
      currentStageKey: quest.currentStage?.key ?? null,
      deadlineWorldMinute: quest.deadlineWorldMinute,
      rewardClaimed: quest.rewardClaimed,
    })),
  })
  for (const quest of questView) {
    add({
      kind: 'story-arc', key: typedResourceKey('story-arc', session.id, `quest:${safeKey(quest.instanceKey)}`), title: quest.title,
      summary: `${quest.type}任务，当前状态${quest.status}。`,
      logicalSlices: ['quests.related-visible', 'story.open-visible-threads'],
      targetKeys: [quest.instanceKey, quest.definitionKey, quest.owner.key].filter((key): key is string => !!key),
      content: quest,
    })
  }
  add({
    kind: 'storyline-progress', key: typedResourceKey('storyline-progress', session.id, 'story-open-visible-threads'), title: '仍开放的可见故事线',
    summary: '只列出已经由任务状态公开的故事线和当前任务，不读取未来阶段内容。',
    logicalSlices: ['story.open-visible-threads'], targetKeys: questView.flatMap(quest => [quest.instanceKey, quest.definitionKey]),
    content: modules.narrative.storylines.flatMap(storyline => {
      const visible = questView.filter(quest => storyline.stageKeys.some(stageKey => (
        modules.narrative.stages.find(stage => stage.key === stageKey)?.questKeys.includes(quest.definitionKey)
      )))
      return visible.length ? [{
        key: storyline.key, kind: storyline.kind, title: storyline.title,
        ownerKind: storyline.ownerKind, ownerKey: storyline.ownerKey,
        visibleQuestInstanceKeys: visible.map(quest => quest.instanceKey),
      }] : []
    }),
  })

  for (const group of eventGroups(events)) {
    const evidence = group.events.map(event => ({
      id: event.id, sequence: event.sequence, type: event.type,
      actorKey: event.actorKey ?? null, targetKey: event.targetKey ?? null,
      commandId: event.commandId ?? null, payload: parseEventPayload(event),
    }))
    add({
      kind: 'fact', key: resourceKey(session.id, `terminal-receipt:${safeKey(group.commandId)}`), title: `正式结果 ${group.commandId}`,
      summary: `命令${group.commandId}的${group.events.length}条已提交事件证据。`,
      logicalSlices: ['events.terminal-receipts'],
      targetKeys: [group.commandId, ...group.events.flatMap(event => [event.actorKey, event.targetKey].filter((key): key is string => !!key))],
      sourceRefs: await eventSourceRefs(group.events),
      content: { commandId: group.commandId, terminal: true, evidence },
    })
  }

  for (const template of modules.director.templates) {
    const quest = modules.quests.quests.find(item => item.key === template.questKey)
      ?? fail('director-template', `模板${template.key}缺少任务定义`)
    const variants = modules.presentation.taskTextVariants.filter(item => template.variantTextKeys.includes(item.key))
    add({
      kind: 'narrative-blueprint', key: typedResourceKey('narrative-blueprint', session.id, `template:${safeKey(template.key)}`), title: `已选任务模板槽 ${template.key}`,
      summary: `${quest.title}模板槽；仅在调用方精确选择${template.key}时授权。`,
      logicalSlices: ['director.selected-template-slot'], targetKeys: [template.key, quest.key, ...template.regionKeys],
      content: {
        template: {
          key: template.key, questKey: template.questKey, regionKeys: template.regionKeys,
          levelBand: template.levelBand, fingerprint: template.fingerprint,
          intensity: template.intensity, cooldownMinutes: template.cooldownMinutes,
        },
        quest: {
          key: quest.key, type: quest.type, ownerKind: quest.ownerKind, ownerKey: quest.ownerKey,
          title: quest.title, description: quest.description,
        },
        variants,
      },
    })
  }
  add({
    kind: 'reference', key: typedResourceKey('reference', session.id, 'quest-packaging-fingerprints'), title: '地区任务包装去重指纹',
    summary: `${state.director.recentFingerprints.length}项由确定性Director保留的冷却指纹。`,
    logicalSlices: ['quest-packaging.recent-fingerprints'], targetKeys: [],
    content: state.director.recentFingerprints,
  })
  for (const trigger of TEXT_OPEN_WORLD_DIRECTOR_TRIGGERS_V1) {
    const candidates = projectTextOpenWorldDirectorCandidatesV1({
      runtimePackage, state, trigger,
      conditionResults: Object.fromEntries(Object.entries(derived.action.conditionResults)
        .map(([key, result]) => [key, result.satisfied])),
      parsedModules: modules,
    })
    add({
      kind: 'narrative-blueprint', key: typedResourceKey('narrative-blueprint', session.id, `director-candidates:${trigger}`), title: `Director合法候选 ${trigger}`,
      summary: `${trigger}触发下${candidates.candidates.length}项代码已筛选候选，另含Blank权重。`,
      logicalSlices: ['director.legal-candidates'], targetKeys: [trigger, region.key, ...candidates.candidates.map(item => item.sourceKey)],
      content: { trigger, ...candidates },
    })
  }
  add({
    kind: 'storyline-progress', key: typedResourceKey('storyline-progress', session.id, 'director-pacing'), title: 'Director节奏摘要',
    summary: `已抽取${state.director.drawCount}次，当前揭示${state.director.revealedQuestInstanceKeys.length}项、活跃${state.director.activeQuestInstanceKeys.length}项。`,
    logicalSlices: ['director.pacing-summary'], targetKeys: [region.key],
    content: {
      worldMinute: state.time.worldMinute,
      drawCount: state.director.drawCount,
      generatedQuestInstanceCount: state.director.generatedQuestInstanceCount,
      revealedQuestInstanceKeys: state.director.revealedQuestInstanceKeys,
      activeQuestInstanceKeys: state.director.activeQuestInstanceKeys,
      highIntensityStreak: state.director.highIntensityStreak,
      history: state.director.history,
    },
  })
  add({
    kind: 'narrative-blueprint', key: typedResourceKey('narrative-blueprint', session.id, 'mainline-protection'), title: '主线保护等待窗口',
    summary: '只投影当前已经公开的主线任务及其安全等待性质，不暴露未来剧情。',
    logicalSlices: ['mainline.protection-window'], targetKeys: questView.filter(quest => quest.type === 'mainline').map(quest => quest.instanceKey),
    content: questView.filter(quest => quest.type === 'mainline').map(quest => {
      const narrativeStage = modules.narrative.stages.find(stage => stage.questKeys.includes(quest.definitionKey))
      return {
        instanceKey: quest.instanceKey, status: quest.status,
        safeWaitPoint: narrativeStage?.safeWaitPoint ?? true,
        pressurePolicy: 'wait-without-mainline-pressure',
      }
    }),
  })
  add({
    kind: 'fact', key: resourceKey(session.id, 'director-cooldowns-conflicts'), title: 'Director冷却与冲突输入',
    summary: '确定性冷却、牌组容量、战斗阻断和当前任务占用。',
    logicalSlices: ['director.cooldowns-conflicts'], targetKeys: [region.key],
    content: {
      combatActive: state.combat?.status === 'active',
      lastDrawWorldMinute: state.director.lastDrawWorldMinuteByRegionKey[region.key] ?? null,
      lastResolvedWorldMinuteBySourceKey: state.director.lastResolvedWorldMinuteBySourceKey,
      recentFingerprints: state.director.recentFingerprints,
      globalMaximumRevealed: modules.director.rules.globalMaximumRevealed,
      globalMaximumActive: modules.director.rules.globalMaximumActive,
      maximumQuestInstances: modules.director.rules.maximumQuestInstances,
      activeQuestInstanceKeys: state.director.activeQuestInstanceKeys,
      revealedQuestInstanceKeys: state.director.revealedQuestInstanceKeys,
    },
  })

  const descriptorScope: ContextResourceDescriptorV1['scope'] = {
    projectId: session.projectId,
    worldId: session.worldId,
    workId: session.workId,
    worldGroupId: session.worldGroupId ?? null,
    productRuntimeSessionId: session.id,
  }
  const resources = await Promise.all(drafts.map(async draft => {
    const contentHash = await sha256Text(draft.fullContent)
    const descriptor: ContextResourceDescriptorV1 = {
      version: 1,
      resourceKey: draft.key,
      sourceKey: 'openWorldRuntime',
      kind: draft.kind,
      title: draft.title,
      shortSummary: draft.summary,
      authority: 'confirmed-evidence',
      contentRevision: head.sequence,
      contentHash,
      policyRevision: head.sequence,
      policyHash: await hashCanonicalValue({
        providerVersion: TEXT_OPEN_WORLD_RUNTIME_CONTEXT_PROVIDER_VERSION_V1,
        resourceKey: draft.key,
        sequence: head.sequence,
        stateHash: head.stateHash,
        runtimeSourceHash: binding.formal.packageHash,
        logicalSlices: draft.logicalSlices,
        targetKeys: draft.targetKeys,
      }),
      scope: descriptorScope,
      relations: relationTargets(draft.targetKeys),
      sourceRefs: draft.sourceRefs ?? baseSourceRefs,
      tokenEstimate: {
        index: estimateTokens(`${draft.title}\n${draft.summary}`),
        summary: estimateTokens(draft.summary),
        focused: estimateTokens(draft.focusedContent),
        full: estimateTokens(draft.fullContent),
      },
      availableDepths: ['index', 'summary', 'focused', 'full'],
      priority: draft.priority ?? 'normal',
    }
    return {
      descriptor,
      fullContent: draft.fullContent,
      focusedContent: draft.focusedContent,
      logicalSlices: draft.logicalSlices,
      targetKeys: draft.targetKeys,
    }
  }))
  resources.sort((left, right) => left.descriptor.resourceKey.localeCompare(right.descriptor.resourceKey))
  const visibilityHash = await hashCanonicalValue(resources.map(item => ({
    resourceKey: item.descriptor.resourceKey,
    contentHash: item.descriptor.contentHash,
    policyHash: item.descriptor.policyHash,
  })))
  const scopeFingerprint = await hashCanonicalValue({
    providerId: TEXT_OPEN_WORLD_RUNTIME_CONTEXT_PROVIDER_ID_V1,
    providerVersion: TEXT_OPEN_WORLD_RUNTIME_CONTEXT_PROVIDER_VERSION_V1,
    projectId: session.projectId,
    worldId: session.worldId,
    workId: session.workId,
    worldGroupId: session.worldGroupId ?? null,
    productRuntimeSessionId: session.id,
    sequence: head.sequence,
    stateHash: head.stateHash,
    runtimeSourceHash: binding.formal.packageHash,
    visibilityHash,
  })
  const afterVersion = await readProductRuntimeStateVersion(session.id)
  if (afterVersion.sequence !== beforeVersion.sequence || afterVersion.stateHash !== beforeVersion.stateHash) {
    fail('stale', '资源目录构建期间Session已经推进')
  }
  const catalog = {
    session,
    sequence: head.sequence,
    stateHash: head.stateHash,
    runtimeSourceHash: binding.formal.packageHash,
    visibilityHash,
    scopeFingerprint,
    resources,
  }
  if (catalogCache.size >= CATALOG_CACHE_LIMIT) {
    const oldest = catalogCache.keys().next().value
    if (oldest) catalogCache.delete(oldest)
  }
  catalogCache.set(cacheKey, catalog)
  return catalog
}

function cursorOffset(cursor: string | undefined, fingerprint: string): number {
  if (!cursor) return 0
  const match = cursor.match(/^([a-f0-9]{64}):(\d+)$/)
  if (!match || match[1] !== fingerprint) fail('cursor', '目录cursor不属于当前冻结scope')
  const offset = Number(match[2])
  if (!Number.isSafeInteger(offset) || offset < 0) fail('cursor', '目录cursor偏移无效')
  return offset
}

function page(input: {
  catalog: TextOpenWorldRuntimeContextCatalogV1
  resources: TextOpenWorldRuntimeContextResourceV1[]
  cursor?: string
  limit: number
}): ResourcePageV1 {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1_000) fail('limit', '目录limit必须为1..1000')
  const offset = cursorOffset(input.cursor, input.catalog.scopeFingerprint)
  const items = input.resources.slice(offset, offset + input.limit).map(item => item.descriptor)
  const nextOffset = offset + items.length
  return {
    version: 1,
    items,
    nextCursor: nextOffset < input.resources.length ? `${input.catalog.scopeFingerprint}:${nextOffset}` : null,
    scopeFingerprint: input.catalog.scopeFingerprint,
  }
}

function filterKinds(resources: readonly TextOpenWorldRuntimeContextResourceV1[], kinds?: readonly ContextResourceKind[]) {
  const allowed = kinds?.length ? new Set(kinds) : null
  return resources.filter(item => !allowed || allowed.has(item.descriptor.kind))
}

function matchesQuery(resource: TextOpenWorldRuntimeContextResourceV1, input: ResourceSearchInputV1): boolean {
  const queryTerms = input.query.toLocaleLowerCase('zh-CN').split(/[\s,，。；;、]+/).filter(Boolean)
  const haystack = `${resource.descriptor.resourceKey}\n${resource.descriptor.title}\n${resource.descriptor.shortSummary}`.toLocaleLowerCase('zh-CN')
  const queryMatches = queryTerms.length === 0 || queryTerms.some(term => haystack.includes(term))
  const requestedKeys = new Set([...(input.entityKeys ?? []), ...(input.storyArcKeys ?? [])])
  const entityMatches = requestedKeys.size === 0 || resource.descriptor.relations.some(relation => requestedKeys.has(relation.targetResourceKey))
  if (!queryMatches || !entityMatches) return false
  if (!input.timeRange) return true
  const range = resource.descriptor.timeRange
  if (!range) return false
  if (input.timeRange.start != null && range.end != null && String(range.end) < String(input.timeRange.start)) return false
  if (input.timeRange.end != null && range.start != null && String(range.start) > String(input.timeRange.end)) return false
  return true
}

function capped(content: string, maxTokens: number, depth: ResourceReadInputV1['depth']): string {
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > 100_000) fail('read-budget', 'maxTokens必须为1..100000')
  if (estimateTokens(content) <= maxTokens) return content
  if (depth === 'full') fail('read-budget', 'full资源超出显式预算，拒绝静默截断')
  const marker = '\n…（按显式Context预算截断；Retrieval Trace将保留该读取深度）'
  let low = 0; let high = content.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (estimateTokens(`${content.slice(0, middle)}${marker}`) <= maxTokens) low = middle
    else high = middle - 1
  }
  return `${content.slice(0, low)}${marker}`
}

async function listMetadata(input: ResourceListInputV1): Promise<ResourcePageV1> {
  const catalog = await loadCatalog(input.scope)
  return page({
    catalog,
    resources: filterKinds(catalog.resources, input.kinds),
    cursor: input.cursor,
    limit: input.limit,
  })
}

async function searchMetadata(input: ResourceSearchInputV1): Promise<ResourcePageV1> {
  const catalog = await loadCatalog(input.scope)
  const resources = filterKinds(catalog.resources, input.kinds).filter(resource => matchesQuery(resource, input))
  return page({ catalog, resources, cursor: input.cursor, limit: input.limit })
}

async function read(input: ResourceReadInputV1): Promise<ContextResourceReadV1> {
  const catalog = await loadCatalog(input.scope)
  const resource = catalog.resources.find(item => item.descriptor.resourceKey === input.resourceKey)
    ?? fail('not-found', `资源不存在或已不再可见:${input.resourceKey}`)
  const source = input.depth === 'index'
    ? `${resource.descriptor.title}\n${resource.descriptor.shortSummary}`
    : input.depth === 'summary'
      ? resource.descriptor.shortSummary
      : input.depth === 'focused'
        ? resource.focusedContent
        : resource.fullContent
  const content = capped(source, input.maxTokens, input.depth)
  return {
    version: 1,
    descriptor: resource.descriptor,
    depth: input.depth,
    content,
    contentHash: await sha256Text(content),
    tokenCount: estimateTokens(content),
    sourceRefs: resource.descriptor.sourceRefs,
  }
}

async function readOriginal(_input: OriginalEvidenceReadInputV1): Promise<OriginalEvidenceReadV1> {
  return fail('original-forbidden', '运行时派生投影不提供original读取；精确状态与事件字段由SourceRef和source-snapshot留证')
}

export async function loadTextOpenWorldRuntimeContextCatalogV1(
  scope: FrozenResourceScopeV1,
): Promise<TextOpenWorldRuntimeContextCatalogV1> {
  return loadCatalog(scope)
}

export const TEXT_OPEN_WORLD_RUNTIME_CONTEXT_PROVIDER_V1: ContextResourceProviderV1 = {
  version: 'context-resource-provider-v1',
  providerId: TEXT_OPEN_WORLD_RUNTIME_CONTEXT_PROVIDER_ID_V1,
  providerVersion: TEXT_OPEN_WORLD_RUNTIME_CONTEXT_PROVIDER_VERSION_V1,
  normalizationVersion: TEXT_OPEN_WORLD_RUNTIME_CONTEXT_NORMALIZATION_VERSION_V1,
  kinds: TEXT_OPEN_WORLD_RUNTIME_CONTEXT_RESOURCE_KINDS_V1,
  listMetadata,
  searchMetadata,
  read,
  readOriginal,
  fingerprint: async scope => (await loadCatalog(scope)).scopeFingerprint,
}

export function textOpenWorldRuntimeContextEntityAnchorV1(key: string): string {
  return entityAnchor(key)
}
