import { db } from '../../src/lib/db/schema'
import {
  createTextOpenWorldDirectorQuestInstanceV1,
  createTextOpenWorldQuestInstanceKeyV1,
} from '../../src/lib/open-world/quests'
import { parseTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import { hashStateJson, parseProductRuntimeState } from '../../src/lib/product/runtime-core'
import type {
  ProductRuntimeState,
  TextOpenWorldRuntimePackageV1,
  TextOpenWorldSessionProjectionV1,
} from '../../src/lib/types'
import { createGovernedTextOpenWorldSessionFixtureV1 } from './text-open-world-product-session'
import { createTextOpenWorldVNextFixture } from './text-open-world-vnext-fixture'

export const TEXT_OPEN_WORLD_LARGE_STATE_COUNTS_V1 = {
  locations: 96,
  inventoryItems: 180,
  questInstances: 120,
  replayEvents: 160,
} as const

/**
 * Builds a deliberately large, but still schema-valid, frozen package. This is
 * test evidence for the real parsers/projectors and is not a second runtime.
 */
export function createLargeTextOpenWorldRuntimePackageV1(): TextOpenWorldRuntimePackageV1 {
  const runtimePackage = createTextOpenWorldVNextFixture()
  const world = runtimePackage.modules.world.payload as any
  const items = runtimePackage.modules.items.payload as any
  const actors = runtimePackage.modules.actors.payload as any
  const actions = runtimePackage.modules.actions.payload as any
  const director = runtimePackage.modules.director.payload as any
  const presentation = runtimePackage.modules.presentation.payload as any

  const region = world.regions.find((candidate: any) => candidate.key === 'region.salt-port')
  const sourceLocation = world.locations.find((candidate: any) => candidate.key === 'location.salt-port')
  const sourceItem = items.items.find((candidate: any) => candidate.key === 'item.salt-crystal')
  if (!region || !sourceLocation || !sourceItem) throw new Error('大状态夹具缺少基础目录')

  for (let index = world.locations.length; index < TEXT_OPEN_WORLD_LARGE_STATE_COUNTS_V1.locations; index += 1) {
    const key = `location.performance-${String(index + 1).padStart(3, '0')}`
    world.locations.push({
      ...structuredClone(sourceLocation),
      key,
      title: `规模地点 ${String(index + 1).padStart(3, '0')}`,
      description: `用于验证大型程序地图的地点 ${index + 1}。`,
      purpose: '验证大地图、移动端列表和键盘语义。',
      tags: ['规模验收'],
      initialKnowledge: 'heard',
      sourceRefs: [`world-release:location:performance-${index + 1}`],
    })
    region.locationKeys.push(key)
    world.edges.push({
      key: `edge.performance-${String(index + 1).padStart(3, '0')}`,
      fromLocationKey: 'location.salt-port',
      toLocationKey: key,
      bidirectional: true,
      travelMinutes: 15 + index,
      conditionKeys: [],
      description: `盐港通往规模地点 ${index + 1} 的验收道路。`,
      riskProfile: 'ordinary',
      sourceRefs: [`world-release:route:performance-${index + 1}`],
    })
    const token = String(index + 1).padStart(3, '0')
    const minutes = 15 + index
    actions.effects.push(
      { key: `effect.travel-performance-${token}-start`, operation: 'start-travel', payload: { edgeKey: `edge.performance-${token}`, destinationLocationKey: key } },
      { key: `effect.travel-performance-${token}-time`, operation: 'advance-time', payload: { minutes } },
      { key: `effect.travel-performance-${token}-enter`, operation: 'enter-location', payload: { locationKey: key } },
      { key: `effect.travel-performance-${token}-return-start`, operation: 'start-travel', payload: { edgeKey: `edge.performance-${token}`, destinationLocationKey: 'location.salt-port' } },
      { key: `effect.travel-performance-${token}-return-time`, operation: 'advance-time', payload: { minutes } },
      { key: `effect.travel-performance-${token}-return-enter`, operation: 'enter-location', payload: { locationKey: 'location.salt-port' } },
    )
    actions.actions.push(
      {
        key: `action.travel-performance-${token}`, category: 'travel', label: `前往规模地点 ${token}`,
        description: `沿验收道路前往规模地点 ${index + 1}。`, actorScope: 'player', targetScope: 'location',
        locationKeys: ['location.salt-port'], requirementConditionKeys: [], costEffectKeys: [],
        successEffectKeys: [`effect.travel-performance-${token}-start`, `effect.travel-performance-${token}-time`, `effect.travel-performance-${token}-enter`],
        failureEffectKeys: [], timeCostMinutes: minutes, confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
      },
      {
        key: `action.travel-performance-${token}-return`, category: 'travel', label: '返回盐港广场',
        description: `从规模地点 ${index + 1} 返回盐港。`, actorScope: 'player', targetScope: 'location',
        locationKeys: [key], requirementConditionKeys: [], costEffectKeys: [],
        successEffectKeys: [`effect.travel-performance-${token}-return-start`, `effect.travel-performance-${token}-return-time`, `effect.travel-performance-${token}-return-enter`],
        failureEffectKeys: [], timeCostMinutes: minutes, confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
      },
    )
    const column = index % 12
    const row = Math.floor(index / 12)
    presentation.mapLayout.locationNodes.push({
      locationKey: key,
      x: 55 + column * 80,
      y: 55 + row * 82,
    })
  }

  for (let index = items.items.length; index < TEXT_OPEN_WORLD_LARGE_STATE_COUNTS_V1.inventoryItems; index += 1) {
    const key = `item.performance-${String(index + 1).padStart(3, '0')}`
    items.items.push({
      ...structuredClone(sourceItem),
      key,
      title: `规模材料 ${String(index + 1).padStart(3, '0')}`,
      description: `用于验证大型背包投影和渲染的材料 ${index + 1}。`,
      tags: ['材料', '规模验收'],
      maximumStack: 999,
      baseValue: index + 1,
      sourceRefs: [`world-release:item:performance-${index + 1}`],
    })
    actors.player.build.startingItemKeys.push(key)
  }

  director.rules.globalMaximumRevealed = TEXT_OPEN_WORLD_LARGE_STATE_COUNTS_V1.questInstances
  director.rules.globalMaximumActive = TEXT_OPEN_WORLD_LARGE_STATE_COUNTS_V1.questInstances
  director.rules.maximumQuestInstances = TEXT_OPEN_WORLD_LARGE_STATE_COUNTS_V1.questInstances
  const saltPortDeck = director.decks.find((candidate: any) => candidate.regionKey === 'region.salt-port')
  saltPortDeck.maximumRevealed = TEXT_OPEN_WORLD_LARGE_STATE_COUNTS_V1.questInstances
  saltPortDeck.maximumActive = TEXT_OPEN_WORLD_LARGE_STATE_COUNTS_V1.questInstances
  return runtimePackage
}

export function addLargeQuestLedgerV1(
  projectionValue: TextOpenWorldSessionProjectionV1 | unknown,
): TextOpenWorldSessionProjectionV1 {
  const projection = parseTextOpenWorldSessionProjectionV1(projectionValue)
  const created: string[] = []
  const exemplar = createTextOpenWorldDirectorQuestInstanceV1(projection.runtimePackage, {
    definitionKey: 'quest.template.supplies',
    sourceInstanceKey: 'performance-001',
    worldMinute: projection.state.time.worldMinute,
  })
  for (let index = 0; index < TEXT_OPEN_WORLD_LARGE_STATE_COUNTS_V1.questInstances; index += 1) {
    const sourceInstanceKey = `performance-${String(index + 1).padStart(3, '0')}`
    const instance = {
      ...structuredClone(exemplar),
      instanceKey: createTextOpenWorldQuestInstanceKeyV1({
        definitionKey: exemplar.definitionKey,
        sourceKind: 'director',
        sourceInstanceKey,
      }),
      sourceInstanceKey,
    }
    projection.state.quests.instancesByKey[instance.instanceKey] = instance
    created.push(instance.instanceKey)
  }
  projection.state.director.generatedQuestInstanceCount = created.length
  projection.state.director.revealedQuestInstanceKeys = [...created]
  projection.director = structuredClone(projection.state.director)
  return parseTextOpenWorldSessionProjectionV1(projection)
}

export async function createLargeTextOpenWorldSessionFixtureV1(input?: {
  name?: string
  title?: string
  seed?: string
}) {
  const created = await createGovernedTextOpenWorldSessionFixtureV1({
    name: input?.name ?? '文字开放世界大状态验收',
    textOpenWorldVNext: createLargeTextOpenWorldRuntimePackageV1(),
    runtimeShape: 'vnext-only',
    title: input?.title ?? '盐脊大状态验收存档',
    seed: input?.seed ?? 'text-open-world-large-state-v1',
  })
  const current = parseProductRuntimeState(created.session.initialStateJson)
  if (!current.textOpenWorld) throw new Error('大状态Session缺少vNext投影')
  const next: ProductRuntimeState = {
    ...current,
    textOpenWorld: addLargeQuestLedgerV1(current.textOpenWorld),
  }
  const stateJson = JSON.stringify(next)
  await db.transaction(
    'rw',
    db.productRuntimeEvents,
    db.productRuntimeCheckpoints,
    async () => {
      await db.productRuntimeEvents.where('sessionId').equals(created.session.id!).delete()
      await db.productRuntimeCheckpoints.where('sessionId').equals(created.session.id!).delete()
    },
  )
  await db.productRuntimeSessions.update(created.session.id!, {
    initialStateJson: stateJson,
    runtimeHeadSequence: 0,
    runtimeHeadStateJson: stateJson,
    runtimeHeadStateHash: await hashStateJson(stateJson),
    updatedAt: created.session.updatedAt + 1,
  })
  const session = await db.productRuntimeSessions.get(created.session.id!)
  if (!session) throw new Error('大状态Session写入失败')
  return { ...created, session, projection: next.textOpenWorld }
}
