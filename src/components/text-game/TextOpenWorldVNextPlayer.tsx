import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bell } from 'lucide-react'
import { parseTextOpenWorldModulesV1 } from '../../lib/open-world/modules'
import { projectTextOpenWorldPlayerCombatV1 } from '../../lib/open-world/player-combat'
import {
  projectTextOpenWorldPlayerCraftingEconomyReceiptV1,
  projectTextOpenWorldPlayerCraftingEconomyV1,
  type TextOpenWorldPlayerCraftingEconomyExecuteRequestV1,
} from '../../lib/open-world/player-crafting-economy'
import { projectTextOpenWorldPlayerHudV1 } from '../../lib/open-world/player-hud'
import { projectTextOpenWorldPlayerEndingV1 } from '../../lib/open-world/player-ending'
import { textOpenWorldProjectionUnavailableIssueV1 } from '../../lib/open-world/player-resilience'
import {
  projectTextOpenWorldPlayerNotificationsV1,
  type TextOpenWorldPlayerNotificationCategoryV1,
} from '../../lib/open-world/player-notifications'
import { projectTextOpenWorldPlayerWorldRecordV1 } from '../../lib/open-world/player-world-record'
import {
  generateTextOpenWorldRuntimeIntentV1,
  type TextOpenWorldRuntimeIntentAuthorizationV1,
} from '../../lib/open-world/runtime-intent'
import {
  createTextOpenWorldRuntimeDialogueFallbackV1,
  generateTextOpenWorldRuntimeDialogueV1,
  type TextOpenWorldRuntimeDialogueHistoryTurnV1,
} from '../../lib/open-world/runtime-dialogue'
import { projectTextOpenWorldScenesV1 } from '../../lib/open-world/scene-projection'
import { deriveTextOpenWorldContextsV1 } from '../../lib/open-world/session-projection'
import type { TextOpenWorldCommandSourceV1 } from '../../lib/types'
import {
  selectTextOpenWorldVNextActions,
  useTextOpenWorldPlayerStore,
} from '../../stores/text-open-world-player'
import { useAIConfigStore } from '../../stores/ai-config'
import TextOpenWorldActorsPanel from './TextOpenWorldActorsPanel'
import TextOpenWorldCharacterPanel from './TextOpenWorldCharacterPanel'
import TextOpenWorldCombatPanel, { type TextOpenWorldCombatActionRequestV1 } from './TextOpenWorldCombatPanel'
import TextOpenWorldCraftingEconomyPanel from './TextOpenWorldCraftingEconomyPanel'
import TextOpenWorldEndingPanel from './TextOpenWorldEndingPanel'
import TextOpenWorldGameShell from './TextOpenWorldGameShell'
import TextOpenWorldInventoryPanel from './TextOpenWorldInventoryPanel'
import TextOpenWorldMapPanel, { type TextOpenWorldMapTravelRequestV1 } from './TextOpenWorldMapPanel'
import TextOpenWorldQuestLogPanel from './TextOpenWorldQuestLogPanel'
import TextOpenWorldScenePanel, {
  type TextOpenWorldSceneTutorialAvailabilityV1,
} from './TextOpenWorldScenePanel'
import TextOpenWorldSaveSettingsPanel from './TextOpenWorldSaveSettingsPanel'
import TextOpenWorldWorldRecordPanel from './TextOpenWorldWorldRecordPanel'

const QUEST_STATUS_LABELS = {
  revealed: '可接取',
  accepted: '已接受',
  active: '进行中',
  suspended: '等待玩家',
  completed: '已完成',
  failed: '已失败',
  expired: '已过期',
  abandoned: '已放弃',
  withdrawn: '已撤回',
} as const

const NOTIFICATION_CATEGORY_LABELS: Record<TextOpenWorldPlayerNotificationCategoryV1, string> = {
  player: '角色', inventory: '物品', quest: '任务', world: '世界', relationship: '关系',
  combat: '战斗', achievement: '成就', 'random-event': '随机事件',
}

export default function TextOpenWorldVNextPlayer() {
  const store = useTextOpenWorldPlayerStore()
  const aiConfig = useAIConfigStore(state => state.config)
  const intentAbortController = useRef<AbortController | null>(null)
  const [dismissedCombatIdentity, setDismissedCombatIdentity] = useState<string | null>(null)
  const [pendingConfirmation, setPendingConfirmation] = useState<{
    actionKey: string
    targetKey: string | null
    label: string
    description: string
    sessionId: number
    baseSequence: number
    source: TextOpenWorldCommandSourceV1
    runtimeIntentAuthorization?: TextOpenWorldRuntimeIntentAuthorizationV1
  } | null>(null)
  const [liveAnnouncement, setLiveAnnouncement] = useState<{
    sessionId: number
    notificationId: string
    text: string
  } | null>(null)
  const notificationCursor = useRef<{ sessionId: number; throughSequence: number } | null>(null)
  const questMapRequestCounter = useRef(0)
  const [questMapFocus, setQuestMapFocus] = useState<{
    sessionKey: number | string
    locationKey: string
    requestId: number
  } | null>(null)
  const [sceneTutorialAvailability, setSceneTutorialAvailability] = useState<{
    sessionKey: number | string | null
    value: TextOpenWorldSceneTutorialAvailabilityV1
  }>({
    sessionKey: null,
    value: { systemActions: false, fixedChoices: false, naturalInput: false, actionKeys: [] },
  })
  const projection = store.runtimeState.textOpenWorld
  const storeIssue = store.issue
  const runtimePackage = store.selectedManifest?.textOpenWorldVNext
  const projectedActions = selectTextOpenWorldVNextActions(store)
  const availableActions = projectedActions.filter(action => action.available)
  const modules = useMemo(
    () => runtimePackage ? parseTextOpenWorldModulesV1(runtimePackage) : null,
    [runtimePackage],
  )
  const sceneProjection = useMemo(
    () => projection ? projectTextOpenWorldScenesV1(projection) : null,
    [projection],
  )
  const session = store.selectedSession
    ?? store.sessions.find(item => item.id === store.selectedSessionId)
    ?? null
  const selectedSessionId = session?.id ?? store.selectedSessionId
  const sessionKey = session?.id
    ?? store.selectedSessionId
    ?? runtimePackage?.metadata.packageKey
    ?? 'no-session'
  const productionKey = store.selectedManifest?.definition.productKey
    ?? `unavailable-product:${sessionKey}`
  const handleSceneTutorialAvailability = useCallback((
    value: TextOpenWorldSceneTutorialAvailabilityV1,
  ) => {
    setSceneTutorialAvailability(current => (
      current.sessionKey === sessionKey
        && current.value.systemActions === value.systemActions
        && current.value.fixedChoices === value.fixedChoices
        && current.value.naturalInput === value.naturalInput
        && current.value.actionKeys.length === value.actionKeys.length
        && current.value.actionKeys.every((key, index) => key === value.actionKeys[index])
        ? current
        : { sessionKey, value }
    ))
  }, [sessionKey])
  const projectionSequence = projection?.lastEventSequence ?? null
  // These are cheap, deterministic render projections. Recompute rather than
  // caching by object identity so an externally restored mutable snapshot can
  // never leave stale HUD facts on screen.
  const hud = projection ? projectTextOpenWorldPlayerHudV1(projection) : null
  const notificationProjection = useMemo((): {
    ready: boolean
    entries: ReturnType<typeof projectTextOpenWorldPlayerNotificationsV1>
  } => {
    if (!projection || projectionSequence == null || selectedSessionId == null) {
      return { ready: true, entries: [] }
    }
    try {
      return {
        ready: true,
        entries: projectTextOpenWorldPlayerNotificationsV1({
          sessionId: selectedSessionId,
          projection,
          events: store.events,
        }),
      }
    } catch {
      // readDetails obtains state and events independently. A concurrent commit
      // can briefly make one snapshot newer; wait for the next governed refresh
      // instead of crashing or guessing a partial notification.
      return { ready: false, entries: [] }
    }
  }, [projection, projectionSequence, selectedSessionId, store.events])
  const notificationsReady = notificationProjection.ready
  const notifications = notificationProjection.entries
  const worldRecordProjectionResult = useMemo(() => {
    if (!projection || projectionSequence == null || selectedSessionId == null) {
      return { ready: true, value: null }
    }
    try {
      return {
        ready: true,
        value: projectTextOpenWorldPlayerWorldRecordV1({
          sessionId: selectedSessionId,
          projection,
          events: store.events,
        }),
      }
    } catch {
      return { ready: false, value: null }
    }
  }, [projection, projectionSequence, selectedSessionId, store.events])
  const worldRecordProjection = worldRecordProjectionResult.value
  const combatProjectionResult = useMemo((): {
    ready: boolean
    value: ReturnType<typeof projectTextOpenWorldPlayerCombatV1>
  } => {
    if (!projection?.state.combat || projectionSequence == null) return { ready: true, value: null }
    if (selectedSessionId == null) return { ready: false, value: null }
    try {
      return {
        ready: true,
        value: projectTextOpenWorldPlayerCombatV1({
          sessionId: selectedSessionId,
          projection,
          events: store.events,
          projectedActions,
          checkpoints: store.checkpoints,
        }),
      }
    } catch {
      // Projection and Event rows are loaded independently. Until the exact
      // same-Session prefix aligns, combat remains read-only and fail-closed.
      return { ready: false, value: null }
    }
  }, [projection, projectionSequence, projectedActions, selectedSessionId, store.checkpoints, store.events])
  const combatProjection = combatProjectionResult.value
  const craftingEconomyProjectionResult = useMemo(() => {
    if (!projection || selectedSessionId == null) return { ready: true, value: null }
    try {
      return {
        ready: true,
        value: projectTextOpenWorldPlayerCraftingEconomyV1({
          sessionId: selectedSessionId,
          projection,
          runtimeEventSequence: store.runtimeState.lastSequence,
        }),
      }
    } catch {
      return { ready: false, value: null }
    }
  }, [projection, selectedSessionId, store.runtimeState.lastSequence])
  const craftingEconomyProjection = craftingEconomyProjectionResult.value
  const endingProjectionResult = useMemo(() => {
    if (!projection) return { ready: true, value: null }
    try {
      return {
        ready: true,
        value: projectTextOpenWorldPlayerEndingV1({
          projection,
          sessionStatus: session?.status ?? 'active',
        }),
      }
    } catch {
      return { ready: false, value: null }
    }
  }, [projection, session?.status])
  const endingProjection = endingProjectionResult.value
  const projectionIssue = !notificationsReady
    || !combatProjectionResult.ready
    || !worldRecordProjectionResult.ready
    || !craftingEconomyProjectionResult.ready
    || !endingProjectionResult.ready
    ? textOpenWorldProjectionUnavailableIssueV1()
    : null
  const issue = storeIssue ?? projectionIssue
  const interactionLocked = store.busy || store.loading
    || issue?.gameplayAvailability !== undefined && issue.gameplayAvailability !== 'enabled'
  const endingReached = endingProjection != null && endingProjection.phase !== 'in-progress'
  const gameplayLocked = interactionLocked || endingReached || session?.status !== 'active'
  const combatIdentity = combatProjection
    ? `${combatProjection.operationIdentity.sessionId}:${combatProjection.operationIdentity.combatInstanceKey ?? 'legacy'}`
    : null
  const dismissConfirmation = useCallback(() => setPendingConfirmation(null), [])
  const focusQuestLocation = useCallback((locationKey: string) => {
    questMapRequestCounter.current += 1
    setQuestMapFocus({ sessionKey, locationKey, requestId: questMapRequestCounter.current })
  }, [sessionKey])

  useEffect(() => {
    setPendingConfirmation(null)
    intentAbortController.current?.abort()
    intentAbortController.current = null
    return () => {
      intentAbortController.current?.abort()
      intentAbortController.current = null
    }
  }, [projectionSequence, sessionKey])

  useEffect(() => {
    setQuestMapFocus(null)
    setDismissedCombatIdentity(null)
  }, [sessionKey])

  useEffect(() => {
    if (combatProjection?.result.status === 'none') setDismissedCombatIdentity(null)
  }, [combatIdentity, combatProjection?.result.status])

  useEffect(() => {
    if (selectedSessionId == null || projectionSequence == null) {
      notificationCursor.current = null
      setLiveAnnouncement(null)
      return
    }
    if (!notificationsReady) return
    const cursor = notificationCursor.current
    if (!cursor || cursor.sessionId !== selectedSessionId) {
      // Loading or switching a Session establishes a baseline. Historical
      // changes stay visible in the log but are never replayed as fresh alerts.
      notificationCursor.current = {
        sessionId: selectedSessionId,
        throughSequence: projectionSequence,
      }
      setLiveAnnouncement(null)
      return
    }
    if (projectionSequence <= cursor.throughSequence) return
    const fresh = notifications.filter(notification => (
      notification.effectsEventSequence > cursor.throughSequence
      && notification.effectsEventSequence <= projectionSequence
      && notification.origin === 'system'
      && notification.priority !== 'normal'
    ))
    notificationCursor.current = {
      sessionId: selectedSessionId,
      throughSequence: Math.max(cursor.throughSequence, projectionSequence),
    }
    if (fresh.length) {
      setLiveAnnouncement({
        sessionId: selectedSessionId,
        notificationId: fresh.map(notification => notification.id).join('|'),
        text: fresh.map(notification => (
          `${notification.headline}${notification.details[0] ? `：${notification.details[0]}` : ''}`
        )).join('；'),
      })
    }
  }, [notifications, notificationsReady, projectionSequence, selectedSessionId])

  if (!projection || !runtimePackage || !modules || !sceneProjection || !hud) return null

  const release = session?.productReleaseId == null
    ? null
    : store.releases.find(item => item.release.id === session.productReleaseId)?.release ?? null
  const runtimeSourceEvidence = session?.runtimeSourceHash?.slice(0, 12) || '证据缺失'
  const sourceLabel = store.selectedSessionSource === 'build-preview'
    ? `TEXT-OPEN-WORLD vNEXT · BUILD PREVIEW · 非正式发布 · Build ID #${session?.productBuildId ?? '?'} · 包 ${runtimeSourceEvidence}`
    : `TEXT-OPEN-WORLD vNEXT · PRODUCT RELEASE v${release?.version ?? '?'} · 已固定 · 包 ${runtimeSourceEvidence}`
  const state = projection.state
  const location = modules.world.locations.find(item => item.key === state.map.currentLocationKey)
  const region = modules.world.regions.find(item => item.key === location?.regionKey)
  const derived = deriveTextOpenWorldContextsV1(projection)

  const run = async (operation: () => Promise<unknown>) => {
    try {
      await operation()
    } catch {
      // The governed store owns player-visible diagnostics.
    }
  }
  const executeProjectedAction = (
    action: typeof projectedActions[number],
    explicitTargetKey?: string | null,
    source: TextOpenWorldCommandSourceV1 = 'system-action',
    expectedBaseSequence?: number,
    runtimeIntentAuthorization?: TextOpenWorldRuntimeIntentAuthorizationV1,
  ) => {
    if (gameplayLocked || !action.available) return
    if (action.targetScope === 'combatant' && explicitTargetKey === undefined) return
    const targetKey = explicitTargetKey !== undefined
      ? explicitTargetKey
      : action.targetScope === 'none' ? null : action.validTargetKeys[0] ?? null
    if (action.confirmationRequired) {
      const sessionId = session?.id ?? store.selectedSessionId
      if (sessionId == null) return
      setPendingConfirmation({
        actionKey: action.action.key,
        targetKey,
        label: action.action.label,
        description: action.action.description,
        sessionId,
        baseSequence: expectedBaseSequence ?? store.runtimeState.lastSequence,
        source,
        ...(runtimeIntentAuthorization ? { runtimeIntentAuthorization } : {}),
      })
      return
    }
    void run(() => source === 'system-action' && expectedBaseSequence == null
      ? store.executeVNextAction(action.action.key, targetKey)
      : store.executeVNextAction(action.action.key, targetKey, {
          source,
          ...(runtimeIntentAuthorization ? { runtimeIntentAuthorization } : {}),
          ...(expectedBaseSequence == null ? {} : { expectedBaseSequence }),
        }))
  }

  const interpretNaturalInput = async (request: {
    utterance: string
    selectedSceneKey: string
    recentDialogue: readonly TextOpenWorldRuntimeDialogueHistoryTurnV1[]
  }) => {
    const liveStore = useTextOpenWorldPlayerStore.getState()
    const liveSessionId = liveStore.selectedSession?.id ?? liveStore.selectedSessionId
    const liveProjection = liveStore.runtimeState.textOpenWorld
    if (!liveStore.scope || liveSessionId == null || liveProjection == null
      || liveSessionId !== selectedSessionId
      || liveProjection.lastEventSequence !== projection.lastEventSequence
      || liveStore.runtimeState.lastSequence !== store.runtimeState.lastSequence) {
      throw new Error('当前场景已经变化，请重新输入。')
    }
    intentAbortController.current?.abort()
    const controller = new AbortController()
    intentAbortController.current = controller
    try {
      const intent = await generateTextOpenWorldRuntimeIntentV1({
        scope: liveStore.scope,
        productRuntimeSessionId: liveSessionId,
        selectedSceneKey: request.selectedSceneKey,
        utterance: request.utterance,
        aiConfig,
        signal: controller.signal,
      })
      if (intent.status !== 'reply-only') return intent
      const liveScenes = projectTextOpenWorldScenesV1(liveProjection)
      const selectedScene = liveScenes.status === 'ready'
        ? liveScenes.scenes.find(item => item.key === request.selectedSceneKey)
        : null
      if (!selectedScene?.actor || selectedScene.sourceKind !== 'actor-dialogue') return intent
      try {
        const dialogue = await generateTextOpenWorldRuntimeDialogueV1({
          scope: liveStore.scope,
          productRuntimeSessionId: liveSessionId,
          selectedSceneKey: request.selectedSceneKey,
          utterance: request.utterance,
          recentDialogue: request.recentDialogue,
          aiConfig,
          signal: controller.signal,
        })
        return { ...intent, dialogue }
      } catch (error) {
        if (controller.signal.aborted) throw error
        return { ...intent, dialogue: createTextOpenWorldRuntimeDialogueFallbackV1(selectedScene) }
      }
    } finally {
      if (intentAbortController.current === controller) intentAbortController.current = null
    }
  }

  const trackedQuestContent = <section className="open-world-game-rail-card" aria-label="当前任务">
    <small>当前任务</small>
    {hud.primaryQuest ? <>
      <strong>{hud.primaryQuest.title}</strong>
      <span>
        {QUEST_STATUS_LABELS[hud.primaryQuest.status]}
        {hud.primaryQuest.currentStage ? ` · ${hud.primaryQuest.currentStage.title}` : ''}
      </span>
      {hud.primaryQuest.nextRequiredObjective && <p>
        下一目标：{hud.primaryQuest.nextRequiredObjective.title}
      </p>}
      {hud.primaryQuest.deadline.label && <span className={hud.primaryQuest.deadline.expired ? 'text-danger' : 'text-warning'}>
        {hud.primaryQuest.deadline.label}
      </span>}
    </> : <p>当前没有主追踪任务</p>}
    {!!hud.pinnedQuests.length && <div className="open-world-game-pinned-quests" aria-label="钉选任务">
      <small>钉选</small>
      {hud.pinnedQuests.map(quest => <span key={quest.instanceKey}>
        {quest.title}{quest.deadline.label ? ` · ${quest.deadline.label}` : ''}
      </span>)}
    </div>}
  </section>

  const handleCombatAction = (request: TextOpenWorldCombatActionRequestV1) => {
    const liveStore = useTextOpenWorldPlayerStore.getState()
    const liveSessionId = liveStore.selectedSession?.id ?? liveStore.selectedSessionId
    const liveProjection = liveStore.runtimeState.textOpenWorld
    const liveCombat = liveProjection?.state.combat
    if (request.sessionId !== liveSessionId
      || liveProjection == null
      || !liveCombat
      || !('version' in liveCombat)
      || request.combatInstanceKey !== liveCombat.instanceKey
      || request.expectedBaseSequence !== liveStore.runtimeState.lastSequence
      || request.expectedBaseSequence !== liveProjection.lastEventSequence) return
    const liveActions = selectTextOpenWorldVNextActions(liveStore)
    const action = liveActions.find(item => item.action.key === request.actionKey)
    if (!action?.available) return
    if (action.targetScope === 'combatant' && (!request.targetKey || !action.validTargetKeys.includes(request.targetKey))) return
    if (action.targetScope === 'none' && request.targetKey != null) return
    if (action.targetScope === 'item' && (!request.targetKey || !action.validTargetKeys.includes(request.targetKey))) return
    executeProjectedAction(action, request.targetKey, 'system-action', request.expectedBaseSequence)
  }

  const handleCraftingEconomyAction = async (
    request: TextOpenWorldPlayerCraftingEconomyExecuteRequestV1,
  ) => {
    const liveStore = useTextOpenWorldPlayerStore.getState()
    const liveSessionId = liveStore.selectedSession?.id ?? liveStore.selectedSessionId
    const liveProjection = liveStore.runtimeState.textOpenWorld
    if (request.sessionId !== liveSessionId
      || liveProjection == null
      || request.expectedBaseSequence !== liveStore.runtimeState.lastSequence) {
      throw new Error('制作或交易状态已经变化，请重新选择并确认。')
    }

    const liveScreen = projectTextOpenWorldPlayerCraftingEconomyV1({
      sessionId: request.sessionId,
      projection: liveProjection,
      runtimeEventSequence: liveStore.runtimeState.lastSequence,
    })
    const executable = request.kind === 'craft'
      ? (() => {
          const recipe = liveScreen.crafting.learnedRecipes.find(candidate => (
            candidate.operationTargetKey === request.targetKey
          ))
          return recipe?.available === true
            && recipe.maximumQuantity >= request.quantity
            && recipe.action?.available === true
            && recipe.action.actionKey === request.actionKey
            && recipe.action.targetKey === request.targetKey
        })()
      : (() => {
          const vendor = liveScreen.vendors.find(candidate => (
            candidate.operationTargetKey === request.targetKey
          ))
          const item = (request.kind === 'buy' ? vendor?.buy : vendor?.sell)?.find(candidate => (
            candidate.operationItemKey === request.itemKey
          ))
          return vendor?.available === true
            && item?.available === true
            && item.maximumQuantity >= request.quantity
            && item.action?.available === true
            && item.action.actionKey === request.actionKey
            && item.action.targetKey === request.targetKey
            && item.action.itemKey === request.itemKey
        })()
    if (!executable) throw new Error('制作或交易条件已经变化，请重新选择并确认。')

    // Receipt sanitization must compare the committed change with the exact
    // pre-command state, not with the refreshed post-command projection.
    const submissionProjection = structuredClone(liveProjection)
    const feedback = await liveStore.executeVNextAction(
      request.actionKey,
      request.targetKey,
      {
        expectedBaseSequence: request.expectedBaseSequence,
        quantity: request.quantity,
        confirmed: true,
        ...(request.kind === 'craft' ? {} : { itemKey: request.itemKey }),
      },
    )
    return projectTextOpenWorldPlayerCraftingEconomyReceiptV1({
      projection: submissionProjection,
      runtimeEventSequence: request.expectedBaseSequence,
      request,
      receipt: feedback,
    })
  }

  const combatSurfaceVisible = state.combat != null
    && (!combatIdentity || dismissedCombatIdentity !== combatIdentity)
  const combatTutorialAvailable = combatSurfaceVisible
    && combatProjectionResult.ready
    && combatProjection != null
  const hasVisibleQuest = Object.values(state.quests.instancesByKey).some(instance => (
    instance.offeredAtWorldMinute != null
    && instance.status !== 'locked'
    && instance.status !== 'available'
  ))
  const hasInventoryContent = Object.values(state.inventory.stackQuantities).some(quantity => quantity > 0)
    || Object.keys(state.inventory.itemInstances).length > 0
  const currentSceneTutorialAvailability = sceneTutorialAvailability.sessionKey === sessionKey
    ? sceneTutorialAvailability.value
    : { systemActions: false, fixedChoices: false, naturalInput: false, actionKeys: [] }
  // The ScenePanel owns which of several eligible scenes is actually selected.
  // Do not let a later global feature consume this render cycle before that
  // child has reported the controls that are genuinely on screen.
  const tutorialAvailabilityReady = combatSurfaceVisible
    || sceneTutorialAvailability.sessionKey === sessionKey
  const tutorialFeatureAvailability = {
    scene: true,
    'system-actions': !combatSurfaceVisible && currentSceneTutorialAvailability.systemActions,
    'fixed-choices': !combatSurfaceVisible && currentSceneTutorialAvailability.fixedChoices,
    'natural-input': !combatSurfaceVisible && currentSceneTutorialAvailability.naturalInput,
    quests: hasVisibleQuest,
    'map-travel': availableActions.some(action => (
      action.action.category === 'travel' || action.action.category === 'fast-travel'
    )),
    combat: combatTutorialAvailable,
    'inventory-equipment': hasInventoryContent,
    crafting: (craftingEconomyProjection?.crafting.learnedRecipes.length ?? 0) > 0,
    shop: craftingEconomyProjection?.vendors.some(vendor => vendor.available) ?? false,
    character: true,
    skills: modules.progression.skills.length > 0,
    relationships: worldRecordProjection != null,
    'world-status': true,
    'formal-save': store.selectedSessionSource === 'release',
    'settings-help': true,
  } as const
  const tutorialFeatureSupport = {
    scene: true,
    'system-actions': modules.narrative.scenes.some(scene => scene.actionKeys.length > 0),
    'fixed-choices': modules.narrative.fixedChoices.length > 0,
    'natural-input': sceneProjection.status !== 'unsupported',
    quests: modules.quests.quests.length > 0,
    'map-travel': modules.actions.actions.some(action => (
      action.category === 'travel' || action.category === 'fast-travel'
    )),
    character: true,
    skills: modules.progression.skills.length > 0,
    combat: modules.combat.encounters.length > 0,
    'inventory-equipment': modules.items.items.length > 0,
    crafting: modules.crafting.recipes.length > 0,
    shop: modules.economy.vendors.length > 0,
    relationships: true,
    'world-status': true,
    'formal-save': store.selectedSessionSource === 'release',
    'settings-help': true,
  } as const
  const allAvailableTutorialActionKeys = availableActions.map(action => action.action.key)
  const sceneTutorialActionKeys = combatTutorialAvailable
    ? combatProjection.actions.filter(action => action.available).map(action => action.actionKey)
    : currentSceneTutorialAvailability.actionKeys
  const sceneView = endingProjection && endingProjection.phase !== 'in-progress'
    ? <TextOpenWorldEndingPanel projection={endingProjection} />
    : <div className="space-y-3">
    {combatSurfaceVisible ? <TextOpenWorldCombatPanel
      projection={combatProjection}
      synchronizing={!combatProjectionResult.ready}
      busy={gameplayLocked}
      onExecute={handleCombatAction}
      onRetry={() => void run(() => store.retryDefeatedCombat())}
      onDismissResult={() => {
        if (combatIdentity) setDismissedCombatIdentity(combatIdentity)
      }}
    /> : <TextOpenWorldScenePanel
      sessionKey={sessionKey}
      eventSequence={projection.lastEventSequence}
      projection={sceneProjection}
      availableActions={availableActions}
      feedback={store.lastFeedback}
      busy={gameplayLocked}
      fallback={{
        regionTitle: region?.title ?? '未知区域',
        locationTitle: location?.title ?? state.map.currentLocationKey,
        description: location?.description || location?.earlyArrivalDescription || '这里的场景信息仍在展开。',
        playerName: modules.actors.player.identity.name,
      }}
      onExecute={(actionKey, targetKey, source, options) => {
        const action = availableActions.find(item => item.action.key === actionKey)
        if (action) executeProjectedAction(
          action,
          targetKey,
          source,
          options?.expectedBaseSequence,
          options?.runtimeIntentAuthorization,
        )
      }}
      onInterpretNaturalInput={interpretNaturalInput}
      onTutorialAvailabilityChange={handleSceneTutorialAvailability}
    />}
  </div>

  const questsView = selectedSessionId == null
    ? <p className="text-xs text-text-muted">任务 Session 尚未就绪。</p>
    : <TextOpenWorldQuestLogPanel
        sessionId={selectedSessionId}
        projection={projection}
        events={store.events}
        actions={projectedActions}
        busy={gameplayLocked}
        onExecute={(action, instanceKey) => executeProjectedAction(action, instanceKey)}
        onFocusLocation={focusQuestLocation}
      />

  const characterView = <TextOpenWorldCharacterPanel projection={projection} />

  const moreView = <div className="space-y-3">
    {craftingEconomyProjection ? <TextOpenWorldCraftingEconomyPanel
      sessionKey={sessionKey}
      projection={craftingEconomyProjection}
      busy={gameplayLocked}
      onExecute={handleCraftingEconomyAction}
    /> : <article
      className="rounded border border-border bg-bg-surface p-4 text-xs text-text-muted"
      role="status"
      data-testid="text-open-world-crafting-economy-synchronizing"
    >制作与交易状态核对中，完成前不会开放操作。</article>}
    <TextOpenWorldInventoryPanel
      sessionKey={sessionKey}
      projection={projection}
      busy={gameplayLocked}
      feedback={store.lastFeedback}
      onExecute={(actionKey, itemKey) => {
        const action = projectedActions.find(item => item.action.key === actionKey)
        if (action) executeProjectedAction(action, itemKey)
      }}
    />
    {worldRecordProjection ? <TextOpenWorldWorldRecordPanel
      sessionKey={sessionKey}
      projection={worldRecordProjection}
      onFocusLocation={focusQuestLocation}
    /> : <article
      className="rounded border border-border bg-bg-surface p-4 text-xs text-text-muted"
      role="status"
      data-testid="text-open-world-world-record-synchronizing"
    >世界记录正在核对，完成前不会展示不完整或尚未揭示的内容。</article>}
    <TextOpenWorldSaveSettingsPanel
      sessionKey={sessionKey}
      productionKey={productionKey}
      formalSaveAvailable={store.selectedSessionSource === 'release'}
      audioAvailable={false}
      saves={store.saveProjection}
      versions={store.versionCompatibility}
      busy={interactionLocked}
      onCreateManualSave={name => store.saveCheckpoint(name)}
      onForkCurrent={title => store.forkCurrent(title)}
      onForkCheckpoint={(checkpointId, title) => store.forkCheckpoint(checkpointId, title)}
      onSelectBranch={sessionId => store.select(sessionId)}
      onDeleteCheckpoint={checkpointId => store.deleteCheckpoint(checkpointId)}
      onDeleteBranch={sessionId => store.remove(sessionId)}
      onRepairCheckpoint={checkpointId => store.repairCheckpoint(checkpointId)}
      onRepairRuntimeHead={sessionId => store.repairRuntimeHead(sessionId)}
      onPreviewReleaseMigration={targetProductReleaseId => (
        store.previewReleaseMigration(targetProductReleaseId)
      )}
      onMigrateRelease={(targetProductReleaseId, expectedPreviewHash) => (
        store.migrateRelease(targetProductReleaseId, expectedPreviewHash)
      )}
      onRefresh={() => store.refreshSaveCenter()}
    />
  </div>

  const context = <div className="space-y-3">
    <article className="open-world-game-context-card">
      <small>地点</small>
      <strong>{location?.title ?? state.map.currentLocationKey}</strong>
      <p>{location?.description || '地点资料尚未展开。'}</p>
      <span>{region?.title ?? '未知区域'}{region?.theme ? ` · ${region.theme}` : ''}</span>
    </article>
    <TextOpenWorldActorsPanel
      runtimePackage={runtimePackage}
      state={state}
      attitudeByActorKey={derived.condition.relations.attitudeByActorKey}
    />
    {!!notifications.length && <article
      className="open-world-game-context-card open-world-game-notifications"
      data-testid="text-open-world-important-changes"
    >
      <small><Bell aria-hidden="true" />近期变化</small>
      <ol>
        {notifications.slice(-3).reverse().map(notification => <li
          key={notification.id}
          data-notification-priority={notification.priority}
          data-random-event-status={notification.randomEventStatus ?? undefined}
        >
          <span>{NOTIFICATION_CATEGORY_LABELS[notification.category]}</span>
          <strong>{notification.headline}</strong>
          {notification.details[0] && <p>{notification.details[0]}</p>}
        </li>)}
      </ol>
    </article>}
  </div>

  const confirmationOverlay = pendingConfirmation && <section
    role="alertdialog"
    aria-modal="true"
    aria-label="确认高风险行动"
    className="open-world-game-confirmation"
  >
    <strong>确认“{pendingConfirmation.label}”</strong>
    <p>{pendingConfirmation.description} 此操作会写入正式事件记录。</p>
    <div>
      <button type="button" disabled={store.busy} onClick={dismissConfirmation}>取消</button>
      <button
        type="button"
        disabled={gameplayLocked}
        onClick={() => {
          const request = pendingConfirmation
          const liveStore = useTextOpenWorldPlayerStore.getState()
          const selectedSessionId = liveStore.selectedSessionId
          const selectedSessionRowId = liveStore.selectedSession?.id ?? selectedSessionId
          const liveProjection = liveStore.runtimeState.textOpenWorld
          dismissConfirmation()
          if (request.sessionId !== selectedSessionId
            || selectedSessionRowId !== selectedSessionId
            || liveProjection == null
            || request.baseSequence !== liveStore.runtimeState.lastSequence) return
          void run(() => liveStore.executeVNextAction(
            request.actionKey,
            request.targetKey,
            {
              confirmed: true,
              source: request.source,
              ...(request.runtimeIntentAuthorization
                ? { runtimeIntentAuthorization: request.runtimeIntentAuthorization }
                : {}),
              expectedBaseSequence: request.baseSequence,
            },
          ))
        }}
      >
        确认执行
      </button>
    </div>
  </section>

  return <div data-testid="text-open-world-vnext-runtime">
    <div
      className="open-world-game-live-announcement"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="text-open-world-important-change-announcement"
    >{store.recoveryNotice
        ? <span key={`recovery:${projection.lastEventSequence}`}>{store.recoveryNotice}</span>
        : liveAnnouncement?.sessionId === selectedSessionId
          ? <span key={liveAnnouncement.notificationId}>{liveAnnouncement.text}</span>
          : null}</div>
    <TextOpenWorldGameShell
      sessionKey={sessionKey}
      preferenceProductionKey={productionKey}
      viewRequest={questMapFocus?.sessionKey === sessionKey ? {
        sessionKey,
        requestId: questMapFocus.requestId,
        view: 'map',
      } : null}
      gameTitle={runtimePackage.metadata.title}
      locationTitle={`${region?.title ?? '未知区域'} · ${location?.title ?? state.map.currentLocationKey}`}
      sourceLabel={sourceLabel}
      tutorial={!endingReached && tutorialAvailabilityReady ? {
        productionKey,
        runtimeChannel: store.selectedSessionSource === 'build-preview' ? 'build-preview' : 'release',
        cycleKey: projection.lastEventSequence,
        featureAvailability: tutorialFeatureAvailability,
        featureSupport: tutorialFeatureSupport,
        availableActionKeys: allAvailableTutorialActionKeys,
        availableActionKeysByView: { scene: sceneTutorialActionKeys },
        authoredTutorials: modules.presentation.tutorials,
      } : undefined}
      views={{
        scene: sceneView,
        map: <TextOpenWorldMapPanel
          projection={projection}
          runtimeEventSequence={store.runtimeState.lastSequence}
          busy={gameplayLocked}
          sessionKey={sessionKey}
          focusedLocationKey={questMapFocus?.sessionKey === sessionKey ? questMapFocus.locationKey : null}
          focusedLocationRequestId={questMapFocus?.sessionKey === sessionKey ? questMapFocus.requestId : null}
          onTravel={async (request: TextOpenWorldMapTravelRequestV1) => {
            const liveStore = useTextOpenWorldPlayerStore.getState()
            const liveSessionKey = liveStore.selectedSession?.id
              ?? liveStore.selectedSessionId
              ?? liveStore.selectedManifest?.textOpenWorldVNext?.metadata.packageKey
              ?? 'no-session'
            if (request.sessionKey !== liveSessionKey) return null
            if (liveStore.runtimeState.lastSequence !== request.expectedBaseSequence) {
              throw new Error('地图状态已经变化，请重新选择地点后再出发。')
            }
            return liveStore.executeVNextAction(
              request.actionKey,
              request.destinationLocationKey,
              { expectedBaseSequence: request.expectedBaseSequence },
            )
          }}
        />,
        quests: questsView,
        character: characterView,
        more: moreView,
      }}
      context={context}
      status={<>
        <span><strong>生命</strong>{hud.player.health}/{hud.player.maximumHealth}</span>
        <span><strong>技能资源</strong>{hud.player.skillResource}/{hud.player.maximumSkillResource}</span>
        <span><strong>地点</strong>{hud.location.title}</span>
        {state.combat && <span data-testid="text-open-world-combat-status">
          <strong>战斗</strong>{combatProjection?.phase.statusLabel ?? '记录核对中'}
        </span>}
        <span data-testid="text-open-world-clock-weather">
          <strong>世界时间</strong>第 {hud.clockWeather.day} 天 · {hud.clockWeather.timePeriodLabel}
          {' · '}{hud.clockWeather.weatherLabel} · {hud.clockWeather.weatherDescription}
        </span>
        <span><strong>时间线</strong>事件 #{projection.lastEventSequence}</span>
        <span data-testid="text-open-world-journey-status">
          <strong>旅程</strong>{endingProjection?.phase === 'completed'
            ? '已完成'
            : endingProjection?.phase === 'settling' ? '正在收束' : '进行中'}
        </span>
        <span data-testid="text-open-world-runtime-package-hash">
          <strong>运行包</strong>{runtimeSourceEvidence}
        </span>
        <span><strong>保存状态</strong>{store.busy ? '正在结算' : issue ? '需要处理' : '事件已落盘'}</span>
      </>}
      navigationSupplement={trackedQuestContent}
      overlay={confirmationOverlay}
      onDismissOverlay={dismissConfirmation}
      issue={issue}
      onRecover={() => void (store.recovery
        ? store.recover()
        : store.select(store.selectedSessionId))}
      busy={store.busy}
      viewStates={{
        quests: hasVisibleQuest ? 'ready' : 'empty',
      }}
      onExit={() => void store.select(null)}
    />
  </div>
}
