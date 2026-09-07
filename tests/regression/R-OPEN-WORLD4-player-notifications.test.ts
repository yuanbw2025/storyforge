import { describe, expect, it } from 'vitest'
import { createTextOpenWorldDirectorCatalogV1 } from '../../src/lib/open-world/director'
import { createTextOpenWorldEffectCatalogV1 } from '../../src/lib/open-world/effect-dsl'
import { projectTextOpenWorldPlayerNotificationsV1 } from '../../src/lib/open-world/player-notifications'
import {
  applyTextOpenWorldSessionEventV1,
  createInitialTextOpenWorldSessionProjectionV1,
  deriveTextOpenWorldContextsV1,
} from '../../src/lib/open-world/session-projection'
import type {
  ProductRuntimeEvent,
  TextOpenWorldDirectorSettlementAuthorizationV1,
  TextOpenWorldRandomEvidenceV1,
  TextOpenWorldRuntimePackageV1,
  TextOpenWorldSessionProjectionV1,
} from '../../src/lib/types'
import {
  createTextOpenWorldVNextFixture,
  createTextOpenWorldVNextP9Fixture,
} from '../helpers/text-open-world-vnext-fixture'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)

interface DirectorBatchFixture {
  events: ProductRuntimeEvent[]
  beforeTerminal: TextOpenWorldSessionProjectionV1
  finalProjection: TextOpenWorldSessionProjectionV1
  authorization: TextOpenWorldDirectorSettlementAuthorizationV1
}

async function directorBatch(
  runtimePackage: TextOpenWorldRuntimePackageV1,
  sessionId: number,
  selection: 'random-event' | 'blank',
): Promise<DirectorBatchFixture> {
  const initial = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
  const commandId = `command.notification.${sessionId}`
  const command: ProductRuntimeEvent = {
    projectId: 1, worldGroupId: null, sessionId, sequence: 1,
    type: 'text-open-world.command.committed', actorKey: 'system', targetKey: null,
    commandId, baseSequence: 0, baseStateHash: HASH_A, createdAt: 1,
    payloadJson: JSON.stringify({
      schema: 'storyforge.text-open-world.command-event', version: 1,
      envelope: {
        schema: 'storyforge.text-open-world.command', version: 1, commandId, sessionId,
        actorKey: 'system', actionKey: 'action.settle-director', payload: { directorTrigger: 'talk' },
        baseSequence: 0, baseStateHash: HASH_A, source: 'system-action', requestedAt: 1,
      },
      requestFingerprint: HASH_B, resultingSequence: 1, resultingStateHash: HASH_C,
    }),
  }
  let projection = applyTextOpenWorldSessionEventV1(initial, command)
  const contexts = deriveTextOpenWorldContextsV1(projection)
  const conditionResults = Object.fromEntries(Object.entries(contexts.action.conditionResults)
    .map(([key, result]) => [key, result.satisfied]))
  const director = createTextOpenWorldDirectorCatalogV1(runtimePackage)
  const requests = director.randomRequestsFor({ state: projection.state, trigger: 'talk', conditionResults })
  const evidence: TextOpenWorldRandomEvidenceV1[] = requests.map((request, drawIndex) => ({
    ...request,
    algorithm: 'sha256-range-v1', seedHash: HASH_A, inputHash: HASH_B, drawIndex,
    value: drawIndex === 0 ? selection === 'blank' ? 1 : 2 : 1,
  }))
  const authorization = director.resolve({ state: projection.state, trigger: 'talk', conditionResults, evidence })
  expect(authorization.selection.outcomeKind).toBe(selection)
  const randomEvents = evidence.map((item, index): ProductRuntimeEvent => ({
    projectId: 1, worldGroupId: null, sessionId, sequence: index + 2,
    type: 'text-open-world.random.resolved', actorKey: 'system', targetKey: null,
    commandId: null, baseSequence: null, baseStateHash: null, createdAt: index + 2,
    payloadJson: JSON.stringify({
      schema: 'storyforge.text-open-world.random-resolved-event', version: 1,
      commandId, commandSequence: 1, ruleset: initial.ruleset, evidence: item,
    }),
  }))
  randomEvents.forEach(event => { projection = applyTextOpenWorldSessionEventV1(projection, event) })
  const beforeTerminal = structuredClone(projection)
  const effectKeys = ['effect.settle-director', ...authorization.selection.effectKeys]
  const catalog = createTextOpenWorldEffectCatalogV1(runtimePackage)
  const plan = await catalog.plan({ effectKeys, claimKey: `claim.notification.${sessionId}`, state: projection.state, authorization })
  const { receipt } = await catalog.apply({ plan, state: projection.state })
  const terminal: ProductRuntimeEvent = {
    projectId: 1, worldGroupId: null, sessionId, sequence: randomEvents.length + 2,
    type: 'text-open-world.effects.applied', actorKey: 'system', targetKey: null,
    commandId: null, baseSequence: null, baseStateHash: null, createdAt: randomEvents.length + 2,
    payloadJson: JSON.stringify({
      schema: 'storyforge.text-open-world.effects-applied-event', version: 1,
      commandId, commandSequence: 1, ruleset: initial.ruleset,
      randomEventSequences: randomEvents.map(event => event.sequence), outcome: 'success', reason: null, degradation: null,
      plan, receipt, outcomeFingerprint: HASH_C,
    }),
  }
  const finalProjection = applyTextOpenWorldSessionEventV1(projection, terminal)
  return { events: [command, ...randomEvents, terminal], beforeTerminal, finalProjection, authorization }
}

describe('Text Open World vNext · canonical player notifications', () => {
  it('只用完整Director终态证据链生成已结算随机事件通知', async () => {
    const fixture = await directorBatch(createTextOpenWorldVNextP9Fixture(), 41, 'random-event')
    expect(projectTextOpenWorldPlayerNotificationsV1({
      sessionId: 41, projection: fixture.finalProjection, events: fixture.events,
    })).toEqual([{
      id: 'text-open-world-notification:41:4', sessionId: 41, effectsEventSequence: 4,
      origin: 'system',
      category: 'random-event', priority: 'important', headline: '随机事件已发生：渠边传闻',
      details: ['传闻没有被当成事实，只作为可调查方向保留。'], worldMinute: 480,
      randomEventStatus: 'resolved',
    }])
  })

  it('Director历史、seen镜像和PRNG证据都不能单独冒充当前随机事件', () => {
    const projection = createInitialTextOpenWorldSessionProjectionV1(createTextOpenWorldVNextP9Fixture())
    projection.state.director.drawCount = 1
    projection.state.director.lastDrawWorldMinuteByRegionKey['region.salt-port'] = 480
    projection.state.director.lastResolvedWorldMinuteBySourceKey['event.channel-rumor'] = 480
    projection.state.director.history.push({
      drawNumber: 1, worldMinute: 480, regionKey: 'region.salt-port', trigger: 'talk', outcomeKind: 'random-event',
      sourceKey: 'event.channel-rumor', questInstanceKey: null, variantTextKey: null,
      fingerprint: 'fingerprint.channel-rumor', intensity: 1,
    })
    projection.state.knowledge.seenRandomEventKeys.push('event.channel-rumor')
    projection.state.knowledge.history.push({
      kind: 'random-event-seen', targetKey: 'event.channel-rumor', sourceKey: 'event.channel-rumor',
      regionKey: 'region.salt-port', worldMinute: 480,
    })
    projection.director = structuredClone(projection.state.director)
    expect(projectTextOpenWorldPlayerNotificationsV1({ sessionId: 42, projection, events: [] })).toEqual([])
  })

  it('Projection head之前没有Effect终态时不读取更晚事件，普通Director结果不伪装成随机事件', async () => {
    const random = await directorBatch(createTextOpenWorldVNextP9Fixture(), 43, 'random-event')
    const futureGarbage = structuredClone(random.events)
    futureGarbage[futureGarbage.length - 1] = {
      ...futureGarbage[futureGarbage.length - 1],
      sessionId: 999,
      sequence: 999,
      payloadJson: '{broken',
    }
    expect(projectTextOpenWorldPlayerNotificationsV1({
      sessionId: 43, projection: random.beforeTerminal, events: futureGarbage,
    })).toEqual([])

    const blank = await directorBatch(createTextOpenWorldVNextP9Fixture(), 44, 'blank')
    expect(projectTextOpenWorldPlayerNotificationsV1({
      sessionId: 44, projection: blank.finalProjection, events: blank.events,
    }).some(notification => notification.category === 'random-event')).toBe(false)
  })

  it('旧Narrative包缺少冻结表现时安全降级，不由Director结果猜测文案', async () => {
    const fixture = await directorBatch(createTextOpenWorldVNextFixture(), 45, 'random-event')
    expect(projectTextOpenWorldPlayerNotificationsV1({
      sessionId: 45, projection: fixture.finalProjection, events: fixture.events,
    })).toEqual([])
  })

  it('拒绝跨Session、重复和不连续事件流', async () => {
    const fixture = await directorBatch(createTextOpenWorldVNextP9Fixture(), 46, 'random-event')
    const crossSession = structuredClone(fixture.events)
    crossSession[1].sessionId = 47
    expect(() => projectTextOpenWorldPlayerNotificationsV1({
      sessionId: 46, projection: fixture.finalProjection, events: crossSession,
    })).toThrow('混入其他Session')

    const duplicate = structuredClone(fixture.events)
    duplicate[1].sequence = 1
    expect(() => projectTextOpenWorldPlayerNotificationsV1({
      sessionId: 46, projection: fixture.finalProjection, events: duplicate,
    })).toThrow('事件序号不连续')

    expect(() => projectTextOpenWorldPlayerNotificationsV1({
      sessionId: 46, projection: fixture.finalProjection, events: fixture.events.slice(1),
    })).toThrow('事件流未覆盖投影头')
  })
})
