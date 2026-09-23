import { StrictMode, act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import TextOpenWorldVNextPlayer from '../../src/components/text-game/TextOpenWorldVNextPlayer'
import { createTextOpenWorldDirectorCatalogV1 } from '../../src/lib/open-world/director'
import { createTextOpenWorldEffectCatalogV1 } from '../../src/lib/open-world/effect-dsl'
import { createTextOpenWorldDirectorQuestInstanceV1 } from '../../src/lib/open-world/quests'
import {
  applyTextOpenWorldSessionEventV1,
  createInitialTextOpenWorldSessionProjectionV1,
  deriveTextOpenWorldContextsV1,
} from '../../src/lib/open-world/session-projection'
import type {
  ProductRuntimeEvent,
  TextOpenWorldRandomEvidenceV1,
  TextOpenWorldRuntimePackageV1,
  TextOpenWorldSessionProjectionV1,
} from '../../src/lib/types'
import { EMPTY_PRODUCT_RUNTIME_STATE } from '../../src/lib/types'
import { useTextOpenWorldPlayerStore } from '../../src/stores/text-open-world-player'
import { createTextOpenWorldProductRuntimePackageFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextP9Fixture } from '../helpers/text-open-world-vnext-fixture'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)

interface DirectorBatchFixture {
  events: ProductRuntimeEvent[]
  finalProjection: TextOpenWorldSessionProjectionV1
}

async function randomEventDirectorBatch(
  runtimePackage: TextOpenWorldRuntimePackageV1,
  sessionId: number,
): Promise<DirectorBatchFixture> {
  const initial = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
  const commandId = `command.notification.ui.${sessionId}`
  const command: ProductRuntimeEvent = {
    projectId: 1,
    worldGroupId: null,
    sessionId,
    sequence: 1,
    type: 'text-open-world.command.committed',
    actorKey: 'system',
    targetKey: null,
    commandId,
    baseSequence: 0,
    baseStateHash: HASH_A,
    createdAt: 1,
    payloadJson: JSON.stringify({
      schema: 'storyforge.text-open-world.command-event',
      version: 1,
      envelope: {
        schema: 'storyforge.text-open-world.command',
        version: 1,
        commandId,
        sessionId,
        actorKey: 'system',
        actionKey: 'action.settle-director',
        payload: { directorTrigger: 'talk' },
        baseSequence: 0,
        baseStateHash: HASH_A,
        source: 'system-action',
        requestedAt: 1,
      },
      requestFingerprint: HASH_B,
      resultingSequence: 1,
      resultingStateHash: HASH_C,
    }),
  }
  let projection = applyTextOpenWorldSessionEventV1(initial, command)
  const contexts = deriveTextOpenWorldContextsV1(projection)
  const conditionResults = Object.fromEntries(Object.entries(contexts.action.conditionResults)
    .map(([key, result]) => [key, result.satisfied]))
  const director = createTextOpenWorldDirectorCatalogV1(runtimePackage)
  const requests = director.randomRequestsFor({
    state: projection.state,
    trigger: 'talk',
    conditionResults,
  })
  const evidence: TextOpenWorldRandomEvidenceV1[] = requests.map((request, drawIndex) => ({
    ...request,
    algorithm: 'sha256-range-v1',
    seedHash: HASH_A,
    inputHash: HASH_B,
    drawIndex,
    // The P9 fixture deterministically maps the first value 2 to its random
    // event and the second value 1 to its only presentation variant.
    value: drawIndex === 0 ? 2 : 1,
  }))
  const authorization = director.resolve({
    state: projection.state,
    trigger: 'talk',
    conditionResults,
    evidence,
  })
  expect(authorization.selection.outcomeKind).toBe('random-event')
  const randomEvents = evidence.map((item, index): ProductRuntimeEvent => ({
    projectId: 1,
    worldGroupId: null,
    sessionId,
    sequence: index + 2,
    type: 'text-open-world.random.resolved',
    actorKey: 'system',
    targetKey: null,
    commandId: null,
    baseSequence: null,
    baseStateHash: null,
    createdAt: index + 2,
    payloadJson: JSON.stringify({
      schema: 'storyforge.text-open-world.random-resolved-event',
      version: 1,
      commandId,
      commandSequence: 1,
      ruleset: initial.ruleset,
      evidence: item,
    }),
  }))
  randomEvents.forEach(event => { projection = applyTextOpenWorldSessionEventV1(projection, event) })
  const catalog = createTextOpenWorldEffectCatalogV1(runtimePackage)
  const plan = await catalog.plan({
    effectKeys: ['effect.settle-director', ...authorization.selection.effectKeys],
    claimKey: `claim.notification.ui.${sessionId}`,
    state: projection.state,
    authorization,
  })
  const { receipt } = await catalog.apply({ plan, state: projection.state })
  const terminal: ProductRuntimeEvent = {
    projectId: 1,
    worldGroupId: null,
    sessionId,
    sequence: randomEvents.length + 2,
    type: 'text-open-world.effects.applied',
    actorKey: 'system',
    targetKey: null,
    commandId: null,
    baseSequence: null,
    baseStateHash: null,
    createdAt: randomEvents.length + 2,
    payloadJson: JSON.stringify({
      schema: 'storyforge.text-open-world.effects-applied-event',
      version: 1,
      commandId,
      commandSequence: 1,
      ruleset: initial.ruleset,
      randomEventSequences: randomEvents.map(event => event.sequence),
      outcome: 'success',
      reason: null,
      degradation: null,
      plan,
      receipt,
      outcomeFingerprint: HASH_C,
    }),
  }
  return {
    events: [command, ...randomEvents, terminal],
    finalProjection: applyTextOpenWorldSessionEventV1(projection, terminal),
  }
}

function putSession(input: {
  sessionId: number
  runtimePackage: TextOpenWorldRuntimePackageV1
  projection: TextOpenWorldSessionProjectionV1
  events: ProductRuntimeEvent[]
}): void {
  useTextOpenWorldPlayerStore.setState({
    sessions: [],
    releases: [],
    selectedSessionId: input.sessionId,
    selectedSession: null,
    selectedSessionSource: 'build-preview',
    selectedManifest: createTextOpenWorldProductRuntimePackageFixtureV1(input.runtimePackage),
    runtimeState: {
      ...structuredClone(EMPTY_PRODUCT_RUNTIME_STATE),
      textOpenWorld: structuredClone(input.projection),
    },
    checkpoints: [],
    events: structuredClone(input.events),
    generatedCandidate: null,
    loading: false,
    busy: false,
    lastFeedback: null,
    error: '',
  })
}

describe('Text Open World G4-04 · HUD与通知UI边界', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    useTextOpenWorldPlayerStore.setState({
      sessions: [],
      releases: [],
      selectedSessionId: null,
      selectedSession: null,
      selectedSessionSource: null,
      events: [],
      checkpoints: [],
      runtimeState: structuredClone(EMPTY_PRODUCT_RUNTIME_STATE),
      selectedManifest: null,
      generatedCandidate: null,
      loading: false,
      busy: false,
      lastFeedback: null,
      error: '',
    })
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it('explicit primary为空时只把pin显示为钉选，不回退成主任务', async () => {
    const runtimePackage = createTextOpenWorldVNextP9Fixture()
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    const ordinary = createTextOpenWorldDirectorQuestInstanceV1(runtimePackage, {
      definitionKey: 'quest.template.supplies',
      sourceInstanceKey: 'hud.ui.1',
      worldMinute: 480,
    })
    ordinary.status = 'active'
    ordinary.acceptedAtWorldMinute = 480
    ordinary.currentStageKey = 'quest-stage.template.supplies'
    ordinary.objectiveStatusByKey['objective.template.supplies'] = 'active'
    projection.state.quests.instancesByKey[ordinary.instanceKey] = ordinary
    projection.state.quests.tracking.primaryInstanceKey = null
    projection.state.quests.tracking.pinnedInstanceKeys = [ordinary.instanceKey]
    projection.state.director.generatedQuestInstanceCount = 1
    projection.state.director.revealedQuestInstanceKeys = [ordinary.instanceKey]
    projection.state.director.activeQuestInstanceKeys = [ordinary.instanceKey]
    projection.director = structuredClone(projection.state.director)
    putSession({ sessionId: 61, runtimePackage, projection, events: [] })

    await act(async () => {
      root.render(createElement(StrictMode, null, createElement(TextOpenWorldVNextPlayer)))
    })

    const current = host.querySelector('[aria-label="当前任务"]')
    expect(current?.textContent).toContain('当前没有主追踪任务')
    expect(current?.querySelector('[aria-label="钉选任务"]')?.textContent).toContain('短缺物资')
    expect(current?.textContent).not.toContain('主追踪短缺物资')
  })

  it('初载历史只进入近期变化，不作为新通知播报', async () => {
    const runtimePackage = createTextOpenWorldVNextP9Fixture()
    const batch = await randomEventDirectorBatch(runtimePackage, 62)
    putSession({
      sessionId: 62,
      runtimePackage,
      projection: batch.finalProjection,
      events: batch.events,
    })

    await act(async () => {
      root.render(createElement(StrictMode, null, createElement(TextOpenWorldVNextPlayer)))
    })

    const history = host.querySelector('[data-testid="text-open-world-important-changes"]')
    expect(history?.textContent).toContain('随机事件已发生：渠边传闻')
    expect(history?.querySelector('[data-random-event-status="resolved"]')).toBeTruthy()
    expect(host.querySelectorAll('[data-testid="text-open-world-important-change-announcement"]')).toHaveLength(1)
    expect(host.querySelector('[data-testid="text-open-world-important-change-announcement"]')?.textContent).toBe('')
  })

  it('临时未覆盖Projection head时不推进cursor，补齐后同Session只播一次，切Session不串旧播报', async () => {
    const runtimePackage = createTextOpenWorldVNextP9Fixture()
    const initial = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    const batch = await randomEventDirectorBatch(runtimePackage, 63)
    putSession({ sessionId: 63, runtimePackage, projection: initial, events: [] })

    await act(async () => {
      root.render(createElement(StrictMode, null, createElement(TextOpenWorldVNextPlayer)))
    })
    const live = host.querySelector('[data-testid="text-open-world-important-change-announcement"]')!
    expect(live.textContent).toBe('')

    // Another reader may briefly observe the verified Projection head before
    // its independently read event prefix. This must fail closed without
    // destroying the whole player or consuming the announcement cursor.
    await act(async () => {
      useTextOpenWorldPlayerStore.setState({
        runtimeState: {
          ...structuredClone(EMPTY_PRODUCT_RUNTIME_STATE),
          textOpenWorld: structuredClone(batch.finalProjection),
        },
        events: structuredClone(batch.events.slice(0, -1)),
      })
    })
    expect(host.querySelector('[data-testid="text-open-world-vnext-runtime"]')).toBeTruthy()
    expect(live.textContent).toBe('')

    await act(async () => {
      useTextOpenWorldPlayerStore.setState({ events: structuredClone(batch.events) })
    })
    const announcedLive = host.querySelector('[data-testid="text-open-world-important-change-announcement"]')!
    // Keep the live-region container mounted; only its keyed content should
    // change. Replacing the region itself is not reliably announced by AT.
    expect(announcedLive).toBe(live)
    expect(announcedLive.textContent).toContain('随机事件已发生：渠边传闻')

    const liveMutations: MutationRecord[] = []
    const observer = new MutationObserver(records => liveMutations.push(...records))
    observer.observe(announcedLive, { childList: true, characterData: true, subtree: true })
    await act(async () => { useTextOpenWorldPlayerStore.setState({ busy: true }) })
    observer.disconnect()
    expect(announcedLive.textContent).toContain('随机事件已发生：渠边传闻')
    expect(liveMutations).toEqual([])

    await act(async () => {
      putSession({
        sessionId: 64,
        runtimePackage,
        projection: createInitialTextOpenWorldSessionProjectionV1(runtimePackage),
        events: [],
      })
    })
    expect(host.querySelector('[data-testid="text-open-world-important-change-announcement"]')?.textContent).toBe('')
  }, 30_000)
})
