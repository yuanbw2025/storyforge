import { useCallback, useEffect, useMemo, useState } from 'react'
import { Backpack, GitBranch, Globe2, History, MapPinned, Save, Swords, UserRound } from 'lucide-react'
import { createTextOpenWorldInventoryCatalogV1 } from '../../lib/open-world/inventory'
import { deriveTextOpenWorldLifeProjectionV1 } from '../../lib/open-world/life-cycle'
import { parseTextOpenWorldModulesV1 } from '../../lib/open-world/modules'
import {
  projectTextOpenWorldQuestDeadlineV1,
  projectTextOpenWorldQuestHistoryV1,
} from '../../lib/open-world/quest-history'
import { deriveTextOpenWorldContextsV1 } from '../../lib/open-world/session-projection'
import { createTextOpenWorldSkillCatalogV1 } from '../../lib/open-world/skills'
import { projectTextOpenWorldClockWeatherV1 } from '../../lib/open-world/weather'
import { projectTextOpenWorldQuestInstancesV1 } from '../../lib/open-world/quests'
import {
  selectTextOpenWorldVNextActions,
  useTextOpenWorldPlayerStore,
} from '../../stores/text-open-world-player'
import TextOpenWorldActorsPanel from './TextOpenWorldActorsPanel'
import TextOpenWorldEquipmentPanel from './TextOpenWorldEquipmentPanel'
import TextOpenWorldGameShell from './TextOpenWorldGameShell'
import TextOpenWorldMapPanel from './TextOpenWorldMapPanel'
import TextOpenWorldRelationshipsPanel from './TextOpenWorldRelationshipsPanel'

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

const OBJECTIVE_STATUS_LABELS = {
  inactive: '未开始',
  active: '进行中',
  completed: '已完成',
  failed: '未完成',
} as const

export default function TextOpenWorldVNextPlayer() {
  const store = useTextOpenWorldPlayerStore()
  const [checkpointName, setCheckpointName] = useState('')
  const [pendingConfirmation, setPendingConfirmation] = useState<{
    actionKey: string
    targetKey: string | null
    label: string
    description: string
    sessionId: number
    sessionKey: number | string
    eventSequence: number
  } | null>(null)
  const projection = store.runtimeState.textOpenWorld
  const runtimePackage = store.selectedManifest?.textOpenWorldVNext
  const availableActions = selectTextOpenWorldVNextActions(store).filter(action => action.available)
  const modules = useMemo(
    () => runtimePackage ? parseTextOpenWorldModulesV1(runtimePackage) : null,
    [runtimePackage],
  )
  const session = store.selectedSession
    ?? store.sessions.find(item => item.id === store.selectedSessionId)
    ?? null
  const sessionKey = session?.id
    ?? store.selectedSessionId
    ?? runtimePackage?.metadata.packageKey
    ?? 'no-session'
  const projectionSequence = projection?.lastEventSequence ?? null
  const dismissConfirmation = useCallback(() => setPendingConfirmation(null), [])

  useEffect(() => {
    setPendingConfirmation(null)
  }, [projectionSequence, sessionKey])

  if (!projection || !runtimePackage || !modules) return null

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
  const questActions = availableActions.filter(action => action.targetScope === 'quest')
  const actions = availableActions.filter(action => action.targetScope !== 'quest'
    && !['respawn', 'equip', 'unequip', 'travel', 'fast-travel'].includes(action.action.category))
  const location = modules.world.locations.find(item => item.key === state.map.currentLocationKey)
  const region = modules.world.regions.find(item => item.key === location?.regionKey)
  const visibleQuests = projectTextOpenWorldQuestInstancesV1(modules, state.quests)
    .filter(item => !['locked', 'available'].includes(item.instance.status))
  const trackedQuestKeys = [
    state.quests.tracking.primaryInstanceKey,
    ...state.quests.tracking.pinnedInstanceKeys,
  ].filter((key): key is string => key != null)
  const trackedQuests = trackedQuestKeys
    .map(instanceKey => visibleQuests.find(item => item.instance.instanceKey === instanceKey))
    .filter((item): item is typeof visibleQuests[number] => item != null)
  const primaryQuest = trackedQuests.find(item => (
    item.instance.instanceKey === state.quests.tracking.primaryInstanceKey
  )) ?? trackedQuests[0] ?? null
  const questHistory = projectTextOpenWorldQuestHistoryV1({ runtimePackage, events: store.events })
  const inventory = createTextOpenWorldInventoryCatalogV1(runtimePackage).project(state.inventory)
  const derived = deriveTextOpenWorldContextsV1(projection)
  const clockWeather = projectTextOpenWorldClockWeatherV1({
    runtimePackage,
    state,
    parsedModules: modules,
  })
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
    action: typeof availableActions[number],
    explicitTargetKey?: string,
  ) => {
    const targetKey = explicitTargetKey
      ?? (action.targetScope === 'none' ? null : action.validTargetKeys[0] ?? null)
    if (action.confirmationRequired) {
      const sessionId = session?.id ?? store.selectedSessionId
      if (sessionId == null) return
      setPendingConfirmation({
        actionKey: action.action.key,
        targetKey,
        label: action.action.label,
        description: action.action.description,
        sessionId,
        sessionKey,
        eventSequence: projection.lastEventSequence,
      })
      return
    }
    void run(() => store.executeVNextAction(action.action.key, targetKey))
  }

  const trackedQuestContent = <section className="open-world-game-rail-card" aria-label="当前任务">
    <small>当前任务</small>
    {primaryQuest ? <>
      <strong>{primaryQuest.definition.title}</strong>
      <span>{QUEST_STATUS_LABELS[primaryQuest.instance.status as keyof typeof QUEST_STATUS_LABELS]
        ?? primaryQuest.instance.status}</span>
    </> : <p>当前没有追踪任务</p>}
  </section>

  const feedback = store.lastFeedback && <section
    className={`rounded border p-3 text-sm ${store.lastFeedback.presentation.mayNarrateSuccess
      ? 'border-accent/30 bg-accent/5'
      : 'border-warning/30 bg-warning/5'}`}
    data-testid="text-open-world-feedback"
  >
    <strong>{store.lastFeedback.presentation.headline}</strong>
    {store.lastFeedback.presentation.details.map((detail, index) => (
      <p key={index} className="mt-1 text-xs text-text-muted">{detail}</p>
    ))}
    <small className="mt-2 block text-[9px] text-text-muted">
      正式证据 {store.lastFeedback.evidenceEventSequences.map(sequence => `#${sequence}`).join('、') || '预检'}
      {' · '}{store.lastFeedback.status}
    </small>
  </section>

  const sceneView = <div className="space-y-3">
    <article className="open-world-game-scene-card">
      <small>{region?.title ?? '未知区域'} · 当前场景</small>
      <h1>{location?.title ?? state.map.currentLocationKey}</h1>
      <p>{location?.description || location?.earlyArrivalDescription || '这里的场景信息仍在展开。'}</p>
      <span>{modules.actors.player.identity.name} · 事件 #{projection.lastEventSequence}</span>
    </article>
    {feedback}
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
    <article className="rounded border border-border bg-bg-surface p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Globe2 className="h-4 w-4 text-accent" />当前可执行行动
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {actions.map(action => <button
          key={action.action.key}
          type="button"
          disabled={store.busy}
          onClick={() => executeProjectedAction(action)}
          className="rounded border border-border bg-bg-base p-3 text-left text-xs disabled:opacity-40"
        >
          <strong>{action.action.label}</strong>
          <small className="mt-1 block text-text-muted">{action.action.description}</small>
        </button>)}
        {!actions.length && <p className="text-xs text-text-muted">当前位置没有可执行行动。</p>}
      </div>
    </article>
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

  const questsView = <div className="space-y-3">
    <section className="rounded border border-accent/30 bg-accent/5 p-3" data-testid="text-open-world-quest-hud">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <MapPinned className="h-4 w-4 text-accent" />任务追踪
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {trackedQuests.map(({ definition, instance }) => {
          const deadline = projectTextOpenWorldQuestDeadlineV1(instance, state.time.worldMinute)
          const primary = state.quests.tracking.primaryInstanceKey === instance.instanceKey
          return <article key={instance.instanceKey} className="rounded border border-border bg-bg-surface p-2 text-xs">
            <small className="text-accent">{primary ? '主追踪' : 'HUD钉选'}</small>
            <strong className="mt-1 block">{definition.title}</strong>
            <span className="text-text-muted">
              {QUEST_STATUS_LABELS[instance.status as keyof typeof QUEST_STATUS_LABELS] ?? instance.status}
              {deadline.label ? ` · ${deadline.label}` : ''}
            </span>
          </article>
        })}
        {!trackedQuests.length && <p className="text-xs text-text-muted">
          当前没有追踪任务。取消追踪不会放弃任务。
        </p>}
      </div>
    </section>
    <article className="rounded border border-border bg-bg-surface p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <MapPinned className="h-4 w-4 text-accent" />可见任务实例
      </div>
      <div className="space-y-2">
        {visibleQuests.map(({ definition, instance }) => {
          const stage = instance.currentStageKey
            ? modules.quests.stages.find(item => item.key === instance.currentStageKey)
            : null
          const objectives = stage
            ? stage.objectiveKeys
              .map(objectiveKey => modules.quests.objectives.find(item => item.key === objectiveKey))
              .filter((objective): objective is NonNullable<typeof objective> => objective != null)
            : []
          const instanceActions = questActions.filter(action => (
            action.validTargetKeys.includes(instance.instanceKey)
          ))
          const deadline = projectTextOpenWorldQuestDeadlineV1(instance, state.time.worldMinute)
          const trackingLabel = state.quests.tracking.primaryInstanceKey === instance.instanceKey
            ? '主追踪'
            : state.quests.tracking.pinnedInstanceKeys.includes(instance.instanceKey) ? 'HUD钉选' : null
          return <div
            key={instance.instanceKey}
            className="rounded bg-bg-base p-3 text-xs"
            data-quest-instance={instance.instanceKey}
          >
            <span className="flex justify-between gap-2">
              <strong>{definition.title}{trackingLabel ? ` · ${trackingLabel}` : ''}</strong>
              <code>{QUEST_STATUS_LABELS[instance.status as keyof typeof QUEST_STATUS_LABELS]
                ?? instance.status}</code>
            </span>
            <p className="mt-1 text-text-muted">{definition.description}</p>
            {stage && <div className="mt-2 rounded border border-border/70 p-2">
              <strong>当前阶段：{stage.title}</strong>
              {objectives.map(objective => <p
                key={objective.key}
                className="mt-1 flex justify-between gap-2 text-text-muted"
              >
                <span>{objective.optional ? '可选：' : ''}{objective.title}</span>
                <span>{OBJECTIVE_STATUS_LABELS[instance.objectiveStatusByKey[objective.key]]}</span>
              </p>)}
            </div>}
            {instance.status === 'completed' && definition.rewardContractKey && <small
              className={`mt-2 block ${instance.rewardClaimKey ? 'text-text-muted' : 'text-accent'}`}
            >
              {instance.rewardClaimKey ? '奖励已领取' : '奖励待领取'}
            </small>}
            {deadline.label && <small className={`mt-1 block ${deadline.expired ? 'text-danger' : 'text-warning'}`}>
              {deadline.label} · 截止世界分钟 {deadline.deadlineWorldMinute}
            </small>}
            {!!instanceActions.length && <div className="mt-2 flex flex-wrap gap-2">
              {instanceActions.map(action => <button
                key={action.action.key}
                type="button"
                disabled={store.busy}
                onClick={() => executeProjectedAction(action, instance.instanceKey)}
                className="rounded border border-accent/40 px-2 py-1 text-accent disabled:opacity-40"
              >
                {action.action.label}
              </button>)}
            </div>}
            <small className="mt-2 block break-all text-[9px] text-text-muted">
              定义 {definition.key} · 实例 {instance.instanceKey}
            </small>
          </div>
        })}
        {!visibleQuests.length && <p className="text-xs text-text-muted">尚无可见任务。</p>}
      </div>
    </article>
  </div>

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
    <article className="rounded border border-border bg-bg-surface p-4" data-testid="text-open-world-quest-history">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <History className="h-4 w-4 text-accent" />任务历史
      </div>
      <div className="max-h-40 space-y-1 overflow-y-auto">
        {questHistory.slice().reverse().map((entry, index) => <p
          key={`${entry.sequence}:${index}`}
          className="rounded bg-bg-base px-2 py-1 text-[9px]"
        >
          <strong>#{entry.sequence}</strong> {entry.summary}
        </p>)}
        {!questHistory.length && <p className="text-xs text-text-muted">尚无任务状态事件。</p>}
      </div>
    </article>
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
    {store.lastFeedback && <article className="open-world-game-context-card">
      <small>近期变化</small>
      <strong>{store.lastFeedback.presentation.headline}</strong>
      <p>{store.lastFeedback.presentation.details[0] ?? '正式事件已经写入时间线。'}</p>
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
          const selectedSessionId = liveStore.selectedSession?.id ?? liveStore.selectedSessionId
          const liveProjection = liveStore.runtimeState.textOpenWorld
          dismissConfirmation()
          if (request.sessionId !== selectedSessionId
            || request.sessionKey !== sessionKey
            || request.eventSequence !== liveProjection?.lastEventSequence) return
          void run(() => liveStore.executeVNextAction(
            request.actionKey,
            request.targetKey,
            undefined,
            true,
          ))
        }}
      >
        确认执行
      </button>
      <button type="button" disabled={store.busy} onClick={dismissConfirmation}>取消</button>
    </div>
  </section>

  return <div data-testid="text-open-world-vnext-runtime">
    <TextOpenWorldGameShell
      sessionKey={sessionKey}
      gameTitle={runtimePackage.metadata.title}
      locationTitle={`${region?.title ?? '未知区域'} · ${location?.title ?? state.map.currentLocationKey}`}
      sourceLabel={sourceLabel}
      views={{
        scene: sceneView,
        map: <TextOpenWorldMapPanel
          projection={projection}
          busy={store.busy}
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
        <span><strong>生命</strong>{state.player.health}/{playerStats.maximumHealth}</span>
        <span><strong>技能资源</strong>{state.player.skillResource}/{playerStats.maximumSkillResource}</span>
        <span><strong>地点</strong>{location?.title ?? state.map.currentLocationKey}</span>
        {state.combat && <span data-testid="text-open-world-combat-status">
          <strong>战斗</strong>：{state.combat.status}
        </span>}
        <span data-testid="text-open-world-clock-weather">
          <strong>世界时间</strong>第 {clockWeather.day} 天 · {clockWeather.timePeriodLabel}
          {' · '}{clockWeather.weatherLabel} · {clockWeather.weatherDescription}
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
