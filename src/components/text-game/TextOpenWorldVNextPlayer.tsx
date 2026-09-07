import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Backpack, Bell, GitBranch, Save, Swords, UserRound } from 'lucide-react'
import { createTextOpenWorldInventoryCatalogV1 } from '../../lib/open-world/inventory'
import { deriveTextOpenWorldLifeProjectionV1 } from '../../lib/open-world/life-cycle'
import { parseTextOpenWorldModulesV1 } from '../../lib/open-world/modules'
import { projectTextOpenWorldPlayerHudV1 } from '../../lib/open-world/player-hud'
import {
  projectTextOpenWorldPlayerNotificationsV1,
  type TextOpenWorldPlayerNotificationCategoryV1,
} from '../../lib/open-world/player-notifications'
import { projectTextOpenWorldScenesV1 } from '../../lib/open-world/scene-projection'
import { deriveTextOpenWorldContextsV1 } from '../../lib/open-world/session-projection'
import { createTextOpenWorldSkillCatalogV1 } from '../../lib/open-world/skills'
import type { TextOpenWorldCommandSourceV1 } from '../../lib/types'
import {
  selectTextOpenWorldVNextActions,
  useTextOpenWorldPlayerStore,
} from '../../stores/text-open-world-player'
import TextOpenWorldActorsPanel from './TextOpenWorldActorsPanel'
import TextOpenWorldEquipmentPanel from './TextOpenWorldEquipmentPanel'
import TextOpenWorldGameShell from './TextOpenWorldGameShell'
import TextOpenWorldMapPanel from './TextOpenWorldMapPanel'
import TextOpenWorldQuestLogPanel from './TextOpenWorldQuestLogPanel'
import TextOpenWorldRelationshipsPanel from './TextOpenWorldRelationshipsPanel'
import TextOpenWorldScenePanel from './TextOpenWorldScenePanel'

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
  const [checkpointName, setCheckpointName] = useState('')
  const [pendingConfirmation, setPendingConfirmation] = useState<{
    actionKey: string
    targetKey: string | null
    label: string
    description: string
    sessionId: number
    baseSequence: number
    source: TextOpenWorldCommandSourceV1
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
  const projection = store.runtimeState.textOpenWorld
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
  const dismissConfirmation = useCallback(() => setPendingConfirmation(null), [])
  const focusQuestLocation = useCallback((locationKey: string) => {
    questMapRequestCounter.current += 1
    setQuestMapFocus({ sessionKey, locationKey, requestId: questMapRequestCounter.current })
  }, [sessionKey])

  useEffect(() => {
    setPendingConfirmation(null)
  }, [projectionSequence, sessionKey])

  useEffect(() => {
    setQuestMapFocus(null)
  }, [sessionKey])

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
  const life = deriveTextOpenWorldLifeProjectionV1({
    runtimePackage,
    state,
    checkpoints: store.checkpoints,
  })
  const respawnAction = availableActions.find(action => action.action.category === 'respawn')
  const location = modules.world.locations.find(item => item.key === state.map.currentLocationKey)
  const region = modules.world.regions.find(item => item.key === location?.regionKey)
  const inventory = createTextOpenWorldInventoryCatalogV1(runtimePackage).project(state.inventory)
  const derived = deriveTextOpenWorldContextsV1(projection)
  const { playerStats, progression } = derived
  const skillCatalog = createTextOpenWorldSkillCatalogV1(runtimePackage)
  const learnedSkills = skillCatalog.project({
    learnedSkillKeys: state.player.learnedSkillKeys,
    skillResource: state.player.skillResource,
    conditionResults: Object.fromEntries(
      Object.entries(derived.action.conditionResults).map(([key, result]) => [key, result.satisfied]),
    ),
  }).filter(item => item.learned)
  const activeStatuses = skillCatalog.projectStatuses(state.player.statusKeys).filter(item => item.active)

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
  ) => {
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
        baseSequence: store.runtimeState.lastSequence,
        source,
      })
      return
    }
    void run(() => source === 'system-action'
      ? store.executeVNextAction(action.action.key, targetKey)
      : store.executeVNextAction(action.action.key, targetKey, { source }))
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

  const sceneView = <div className="space-y-3">
    <TextOpenWorldScenePanel
      sessionKey={sessionKey}
      eventSequence={projection.lastEventSequence}
      projection={sceneProjection}
      availableActions={availableActions}
      feedback={store.lastFeedback}
      busy={store.busy}
      combatActive={state.combat?.status === 'active'}
      fallback={{
        regionTitle: region?.title ?? '未知区域',
        locationTitle: location?.title ?? state.map.currentLocationKey,
        description: location?.description || location?.earlyArrivalDescription || '这里的场景信息仍在展开。',
        playerName: modules.actors.player.identity.name,
      }}
      onExecute={(actionKey, targetKey, source) => {
        const action = availableActions.find(item => item.action.key === actionKey)
        if (action) executeProjectedAction(action, targetKey, source)
      }}
    />
    {life.phase === 'defeated' && <section
      className="rounded border border-danger/40 bg-danger/5 p-4"
      data-testid="text-open-world-defeat-recovery"
    >
      <strong className="flex items-center gap-2"><Swords className="h-4 w-4" />本次战斗失败</strong>
      <p className="mt-1 text-xs text-text-muted">
        战前重试会保留这条失败时间线，并从战斗开始前建立新分支；复活会保留已经发生的消耗与事件，在已解锁安全点恢复。两者都不会使主线失败。
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={store.busy || life.combatRetryCheckpointIds.length === 0}
          onClick={() => void run(() => store.retryDefeatedCombat())}
          className="rounded border border-border bg-bg-surface px-3 py-2 text-xs disabled:opacity-40"
        >
          战前重试（新分支）
        </button>
        <button
          type="button"
          disabled={store.busy || !respawnAction}
          onClick={() => respawnAction && void run(() => store.executeVNextAction(respawnAction.action.key))}
          className="rounded border border-border bg-bg-surface px-3 py-2 text-xs disabled:opacity-40"
        >
          复活点恢复（保留进度）
        </button>
      </div>
      {!life.combatRetryCheckpointIds.length && <small className="mt-2 block text-warning">
        没有通过校验的战前自动检查点，仍可读档或复活。
      </small>}
    </section>}
    {store.runtimeState.narrative?.availableChoiceKeys?.includes('ending.world') && <section
      className="rounded border border-accent/30 bg-accent/5 p-5"
    >
      <h2 className="text-lg font-semibold">世界主线已经完成</h2>
      <button
        type="button"
        disabled={store.busy}
        onClick={() => void run(() => store.choose('ending.world'))}
        className="mt-3 rounded bg-accent px-3 py-2 text-xs text-white"
      >
        进入正式结局
      </button>
    </section>}
  </div>

  const questsView = selectedSessionId == null
    ? <p className="text-xs text-text-muted">任务 Session 尚未就绪。</p>
    : <TextOpenWorldQuestLogPanel
        sessionId={selectedSessionId}
        projection={projection}
        events={store.events}
        actions={projectedActions}
        busy={store.busy}
        onExecute={(action, instanceKey) => executeProjectedAction(action, instanceKey)}
        onFocusLocation={focusQuestLocation}
      />

  const characterView = <div className="space-y-3">
    <section className="grid gap-3 sm:grid-cols-2">
      <article className="rounded border border-border bg-bg-surface p-3">
        <small className="text-text-muted">等级与经验</small>
        <strong className="mt-1 block">Lv.{state.player.level} · {state.player.experience} EXP</strong>
        <small className="text-text-muted">
          {progression.atMaximumLevel
            ? '已达20级上限'
            : `本级 ${progression.experienceIntoLevel}/${progression.experienceForNextLevel}`}
        </small>
      </article>
      <article className="rounded border border-border bg-bg-surface p-3">
        <small className="text-text-muted">生命 / 技能资源</small>
        <strong className="mt-1 block">
          {state.player.health}/{playerStats.maximumHealth} · {state.player.skillResource}/{playerStats.maximumSkillResource}
        </strong>
        <small className="text-text-muted">
          {life.phase === 'healthy' ? '状态良好' : life.phase === 'wounded' ? '负伤' : '战败'}
        </small>
      </article>
      <article className="rounded border border-border bg-bg-surface p-3">
        <small className="text-text-muted">三项属性</small>
        <strong className="mt-1 block">
          力 {state.player.attributes.power} · 体 {state.player.attributes.vitality} · 敏 {state.player.attributes.agility}
        </strong>
      </article>
      <article className="rounded border border-border bg-bg-surface p-3">
        <small className="text-text-muted">攻击 / 防御 / 暴击 / 先手</small>
        <strong className="mt-1 block">
          {playerStats.attack} · {playerStats.defense} · {Math.round(playerStats.criticalChance * 10_000) / 100}% · {playerStats.initiative}
        </strong>
      </article>
    </section>
    <article className="rounded border border-border bg-bg-surface p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <UserRound className="h-4 w-4 text-accent" />{modules.actors.player.identity.name}
      </div>
      <p className="text-xs text-text-muted">{modules.actors.player.identity.background || '未设置背景'}</p>
      <p className="mt-2 text-xs"><strong>近期目标：</strong>{modules.actors.player.identity.shortGoal || '未设置'}</p>
      <p className="mt-1 text-xs"><strong>长期目标：</strong>{modules.actors.player.identity.longGoal || '未设置'}</p>
      <details className="mt-3 text-[10px]">
        <summary className="cursor-pointer text-accent">查看数值来源</summary>
        {Object.values(playerStats.breakdown).map(stat => <div key={stat.semanticKey} className="mt-2">
          <strong>{stat.semanticKey} = {stat.value}</strong>
          <p className="text-text-muted">
            {stat.components.map(component => `${component.sourceKey}:${component.value}`).join(' + ')}
          </p>
        </div>)}
      </details>
    </article>
    <section className="grid gap-3 md:grid-cols-2" data-testid="text-open-world-skills-statuses">
      <article className="rounded border border-border bg-bg-surface p-3">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Swords className="h-4 w-4 text-accent" />已学技能
        </div>
        <div className="space-y-2">
          {learnedSkills.map(({ skill, available, unavailableReasons }) => <div
            key={skill.key}
            className="rounded bg-bg-base p-2 text-xs"
          >
            <span className="flex flex-wrap items-center justify-between gap-2">
              <strong>{skill.title}</strong>
              <small className={available ? 'text-accent' : 'text-text-muted'}>
                {available ? '当前可用' : unavailableReasons.join(' / ')}
              </small>
            </span>
            <p className="mt-1 text-text-muted">{skill.description}</p>
            <small className="mt-1 block text-text-muted">
              {skill.activation === 'active' ? '主动' : '被动'} · {skill.target} · 消耗 {skill.resourceCost}
              {' · '}冷却 {skill.cooldownTurns} 回合
            </small>
          </div>)}
          {!learnedSkills.length && <p className="text-xs text-text-muted">尚未学会技能。</p>}
        </div>
      </article>
      <article className="rounded border border-border bg-bg-surface p-3">
        <div className="mb-2 text-sm font-semibold">当前状态</div>
        <div className="space-y-2">
          {activeStatuses.map(({ status }) => <div key={status.key} className="rounded bg-bg-base p-2 text-xs">
            <strong>{status.title}</strong>
            <small className="ml-2 text-text-muted">{status.polarity}</small>
            <p className="mt-1 text-text-muted">{status.description}</p>
          </div>)}
          {!activeStatuses.length && <p className="text-xs text-text-muted">当前没有持续状态。</p>}
        </div>
      </article>
    </section>
  </div>

  const moreView = <div className="space-y-3">
    <TextOpenWorldEquipmentPanel
      runtimePackage={runtimePackage}
      state={state}
      actions={availableActions}
      busy={store.busy}
      onExecute={(actionKey, itemKey) => {
        void run(() => store.executeVNextAction(actionKey, itemKey))
      }}
    />
    <article className="rounded border border-border bg-bg-surface p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <Backpack className="h-4 w-4 text-accent" />背包
      </div>
      {inventory.map(({ item, key, quantity }) => <div key={key} className="flex justify-between text-xs">
        <span>{item?.title ?? key}</span><strong>×{quantity}</strong>
      </div>)}
      {!inventory.length && <p className="text-xs text-text-muted">背包为空。</p>}
    </article>
    <TextOpenWorldRelationshipsPanel runtimePackage={runtimePackage} state={state} />
    <article className="rounded border border-border bg-bg-surface p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <Save className="h-4 w-4 text-accent" />存档与分支
      </div>
      <div className="flex gap-2">
        <input
          value={checkpointName}
          onChange={event => setCheckpointName(event.target.value)}
          placeholder="检查点名称"
          className="min-w-0 flex-1 rounded border border-border bg-bg-base px-2 py-1 text-xs"
        />
        <button
          type="button"
          disabled={!checkpointName.trim() || store.busy}
          onClick={() => void run(async () => {
            await store.saveCheckpoint(checkpointName)
            setCheckpointName('')
          })}
          className="rounded border border-border px-2 text-xs"
        >
          保存
        </button>
      </div>
      <div className="mt-2 max-h-36 space-y-1 overflow-y-auto">
        {store.checkpoints.map(checkpoint => <button
          key={checkpoint.id}
          type="button"
          disabled={store.busy}
          onClick={() => void run(() => store.forkCheckpoint(checkpoint.id!))}
          className="block w-full rounded bg-bg-base px-2 py-1 text-left text-[9px]"
        >
          {checkpoint.name} · #{checkpoint.throughSequence}<GitBranch className="ml-1 inline h-3 w-3" />
        </button>)}
      </div>
    </article>
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
      <button
        type="button"
        disabled={store.busy}
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
              expectedBaseSequence: request.baseSequence,
            },
          ))
        }}
      >
        确认执行
      </button>
      <button type="button" disabled={store.busy} onClick={dismissConfirmation}>取消</button>
    </div>
  </section>

  return <div data-testid="text-open-world-vnext-runtime">
    <div
      className="open-world-game-live-announcement"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="text-open-world-important-change-announcement"
    >{liveAnnouncement?.sessionId === selectedSessionId
        ? <span key={liveAnnouncement.notificationId}>{liveAnnouncement.text}</span>
        : null}</div>
    <TextOpenWorldGameShell
      sessionKey={sessionKey}
      viewRequest={questMapFocus?.sessionKey === sessionKey ? {
        sessionKey,
        requestId: questMapFocus.requestId,
        view: 'map',
      } : null}
      gameTitle={runtimePackage.metadata.title}
      locationTitle={`${region?.title ?? '未知区域'} · ${location?.title ?? state.map.currentLocationKey}`}
      sourceLabel={sourceLabel}
      views={{
        scene: sceneView,
        map: <TextOpenWorldMapPanel
          projection={projection}
          busy={store.busy}
          focusedLocationKey={questMapFocus?.sessionKey === sessionKey ? questMapFocus.locationKey : null}
          focusedLocationRequestId={questMapFocus?.sessionKey === sessionKey ? questMapFocus.requestId : null}
          onTravel={(actionKey, destinationLocationKey) => {
            void run(() => store.executeVNextAction(actionKey, destinationLocationKey))
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
          <strong>战斗</strong>：{state.combat.status}
        </span>}
        <span data-testid="text-open-world-clock-weather">
          <strong>世界时间</strong>第 {hud.clockWeather.day} 天 · {hud.clockWeather.timePeriodLabel}
          {' · '}{hud.clockWeather.weatherLabel} · {hud.clockWeather.weatherDescription}
        </span>
        <span><strong>时间线</strong>事件 #{projection.lastEventSequence}</span>
        <span data-testid="text-open-world-runtime-package-hash">
          <strong>运行包</strong>{runtimeSourceEvidence}
        </span>
        <span><strong>保存状态</strong>{store.busy ? '正在结算' : store.error ? '需要处理' : '已自动保存'}</span>
      </>}
      navigationSupplement={trackedQuestContent}
      overlay={confirmationOverlay}
      onDismissOverlay={dismissConfirmation}
      error={store.error}
      busy={store.busy}
      onExit={() => void store.select(null)}
    />
  </div>
}
