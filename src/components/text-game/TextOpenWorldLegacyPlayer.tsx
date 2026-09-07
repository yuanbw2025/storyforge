import { useMemo, useState } from 'react'
import {
  Bot,
  Check,
  Compass,
  Footprints,
  GitBranch,
  History,
  Loader2,
  MapPinned,
  Save,
  Sparkles,
  UserRound,
} from 'lucide-react'
import { isAIConfigReady } from '../../lib/ai/config-readiness'
import { resolveRequestConfig } from '../../lib/ai/client'
import { useAIConfigStore } from '../../stores/ai-config'
import {
  selectTextOpenWorldAdventureActions,
  useTextOpenWorldPlayerStore,
} from '../../stores/text-open-world-player'
import TextOpenWorldGameShell from './TextOpenWorldGameShell'

export default function TextOpenWorldLegacyPlayer() {
  const store = useTextOpenWorldPlayerStore()
  const { config } = useAIConfigStore()
  const [checkpointName, setCheckpointName] = useState('')
  const [localError, setLocalError] = useState('')
  const selected = store.selectedSession
  const world = store.runtimeState.openWorld
  const manifest = store.selectedManifest
  const openWorld = manifest?.openWorld
  const adventureActions = selectTextOpenWorldAdventureActions(store)
  const currentRegion = openWorld?.regions.find(region => region.key === world?.currentRegionKey)
  const currentProjection = world?.regionalProjections.find(region => region.regionKey === world.currentRegionKey)
  const travelEdges = useMemo(() => openWorld?.travelEdges.filter(edge => (
    edge.fromRegionKey === world?.currentRegionKey
      || (edge.bidirectional && edge.toRegionKey === world?.currentRegionKey)
  )) ?? [], [openWorld, world?.currentRegionKey])
  const revealed = world?.questInstances.filter(item => item.status === 'revealed') ?? []
  const active = world?.questInstances.filter(item => item.status === 'active') ?? []
  const resolvedAI = resolveRequestConfig(config, { category: 'runtime.prose.open-world-quest-expression' })
  const aiReady = isAIConfigReady(resolvedAI.config)
  const run = async (operation: () => Promise<unknown>) => {
    setLocalError('')
    try {
      await operation()
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error))
    }
  }
  const error = localError || store.error

  if (!selected?.id || !world || !openWorld) return null

  const selectedReleaseVersion = selected.productReleaseId == null
    ? null
    : store.releases.find(item => item.release.id === selected.productReleaseId)?.release.version ?? null
  const sourceLabel = store.selectedSessionSource === 'build-preview'
    ? `TEXT-OPEN-WORLD · BUILD PREVIEW · 非正式发布 · Build ID #${selected.productBuildId ?? '?'}`
    : `TEXT-OPEN-WORLD · PRODUCT RELEASE v${selectedReleaseVersion ?? '?'} · 已固定`
  const currentRegionTitle = currentRegion?.title ?? world.currentRegionKey
  const currentRegionDescription = currentRegion?.description || '当前地区资料尚未展开。'

  const generatedPresentation = store.generatedCandidate && <div className="mb-3 rounded border border-accent/20 bg-accent/5 p-3 text-xs">
    <strong className="flex items-center gap-1"><Bot className="h-3.5 w-3.5 text-accent" />只读表现候选</strong>
    <h3 className="mt-2 font-semibold">{store.generatedCandidate.title}</h3>
    <p className="mt-1 text-text-muted">{store.generatedCandidate.text}</p>
    {store.generatedCandidate.dialogue && <p className="mt-1">{store.generatedCandidate.dialogue}</p>}
    <small className="mt-1 block text-[9px] text-text-muted">
      证据 {store.generatedCandidate.evidenceEventSequences.map(sequence => `#${sequence}`).join('、')} · 不写入世界状态
    </small>
  </div>

  const sceneView = <div className="space-y-3">
    <article className="open-world-game-scene-card">
      <small>{currentRegionTitle} · 当前区域</small>
      <h1>{currentRegionTitle}</h1>
      <p>{currentRegionDescription}</p>
      <span>tick {world.tick}/{world.tickLimit} · 事件 #{store.runtimeState.lastSequence}</span>
    </article>
    <article className="rounded border border-border bg-bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Compass className="h-4 w-4 text-accent" />区域行动
        </div>
        <button
          type="button"
          disabled={store.busy || world.ended}
          onClick={() => void run(() => store.command({ kind: 'tick' }))}
          className="flex items-center gap-1 rounded bg-accent px-3 py-2 text-xs text-white disabled:opacity-40"
        >
          {store.busy
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : <History className="h-3 w-3" />}
          推进世界 tick
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {(['observe', 'social', 'explore', 'rest'] as const).map(trigger => <button
          key={trigger}
          type="button"
          disabled={store.busy || !!world.travel || world.ended}
          onClick={() => void run(() => store.command({ kind: 'draw', trigger }))}
          className="rounded border border-border px-3 py-2 text-xs"
        >发现 · {trigger}</button>)}
      </div>
    </article>
    <article className="rounded border border-border bg-bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <MapPinned className="h-4 w-4 text-accent" />动态任务
        </div>
        {aiReady && store.events.some(event => event.type.startsWith('world.')) && <button
          type="button"
          disabled={store.busy}
          onClick={() => void run(() => store.generatePresentation(
            'prose.open-world-scene-narration',
            '依据当前区域和最近正式事件写一段简短场景叙述',
            resolvedAI.config,
          ))}
          className="rounded border border-border px-2 py-1 text-[10px]"
        ><Sparkles className="mr-1 inline h-3 w-3" />Harness 场景</button>}
      </div>
      {generatedPresentation}
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded bg-bg-base p-3 text-xs">
          <small className="text-text-muted">可接取</small>
          <strong className="mt-1 block">{revealed.length} 项任务</strong>
        </div>
        <div className="rounded bg-bg-base p-3 text-xs">
          <small className="text-text-muted">进行中</small>
          <strong className="mt-1 block">{active.length} 项任务</strong>
        </div>
      </div>
      {!revealed.length && !active.length && <p className="mt-3 text-xs text-text-muted">当前没有已揭示或进行中的任务。</p>}
    </article>
    {store.runtimeState.narrative?.availableChoiceKeys?.includes('ending.world') && <section className="rounded border border-accent/30 bg-accent/5 p-5">
      <h2 className="text-lg font-semibold">世界主线已经完成</h2>
      <button
        type="button"
        disabled={store.busy}
        onClick={() => void run(() => store.choose('ending.world'))}
        className="mt-3 rounded bg-accent px-3 py-2 text-xs text-white"
      >进入正式结局</button>
    </section>}
  </div>

  const mapView = <div className="space-y-3">
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="地区概览">
      {openWorld.regions.map(region => {
        const projection = world.regionalProjections.find(item => item.regionKey === region.key)!
        return <article key={region.key} className={`rounded border p-3 ${region.key === world.currentRegionKey ? 'border-accent bg-accent/5' : 'border-border bg-bg-surface'}`}>
          <span className="flex justify-between text-xs">
            <strong>{region.title}</strong>
            <code className="text-[9px] text-accent">{world.attentionLevels[region.key]}</code>
          </span>
          <p className="mt-1 text-xs text-text-muted">{region.description}</p>
          <small className="mt-1 block text-[9px] text-text-muted">
            {world.regionKnowledge[region.key]} · 问题 {Object.values(projection.issuePressures).reduce((sum, value) => sum + value, 0)}
          </small>
        </article>
      })}
    </section>
    <article className="rounded border border-border bg-bg-surface p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Footprints className="h-4 w-4 text-accent" />旅行路线
      </div>
      {world.travel && <p className="mb-3 rounded bg-accent/5 p-3 text-xs text-accent">
        正在前往 {openWorld.regions.find(region => region.key === world.travel?.toRegionKey)?.title ?? world.travel.toRegionKey}，剩余 {world.travel.remainingTicks} tick
      </p>}
      <div className="grid gap-2 md:grid-cols-2">
        {travelEdges.map(edge => {
          const destination = edge.fromRegionKey === world.currentRegionKey
            ? edge.toRegionKey
            : edge.fromRegionKey
          return <button
            key={edge.key}
            type="button"
            disabled={store.busy || !!world.travel || world.ended}
            onClick={() => void run(() => store.command({ kind: 'travel', edgeKey: edge.key }))}
            className="rounded border border-border bg-bg-base p-3 text-left text-xs"
          >
            <strong className="flex items-center gap-1">
              <Footprints className="h-3 w-3" />前往 {openWorld.regions.find(item => item.key === destination)?.title}
            </strong>
            <small className="mt-1 block text-text-muted">{edge.travelTicks} tick · 风险 {edge.risk}</small>
          </button>
        })}
        {!travelEdges.length && <p className="text-xs text-text-muted">当前地区没有可用旅行路线。</p>}
      </div>
    </article>
  </div>

  const questsView = <div className="space-y-3">
    {generatedPresentation}
    <article className="rounded border border-border bg-bg-surface p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <MapPinned className="h-4 w-4 text-accent" />可接取与进行中任务
      </div>
      <div className="space-y-2">
        {revealed.map(instance => <article key={instance.instanceKey} className="rounded border border-accent/20 bg-accent/5 p-3 text-xs">
          <div className="flex justify-between gap-2"><strong>{instance.title}</strong><code>{instance.category}</code></div>
          <p className="mt-1 text-text-muted">{instance.description}</p>
          <small className="mt-1 block text-[9px] text-text-muted">渠道 {instance.channelKey} · 截止 {instance.deadlineTick ?? '无'}</small>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={store.busy}
              onClick={() => void run(() => store.command({ kind: 'quest-decision', instanceKey: instance.instanceKey, decision: 'accept' }))}
              className="rounded bg-accent px-2 py-1 text-white"
            >接受</button>
            <button
              type="button"
              disabled={store.busy}
              onClick={() => void run(() => store.command({ kind: 'quest-decision', instanceKey: instance.instanceKey, decision: 'decline' }))}
              className="rounded border border-border px-2 py-1"
            >拒绝</button>
            {aiReady && <button
              type="button"
              disabled={store.busy}
              onClick={() => void run(() => store.generatePresentation(
                'prose.open-world-quest-expression',
                `为已公开任务 ${instance.instanceKey} 写玩家可见表达`,
                resolvedAI.config,
              ))}
              className="rounded border border-border px-2 py-1"
            ><Sparkles className="mr-1 inline h-3 w-3" />Harness 表达</button>}
          </div>
        </article>)}
        {active.map(instance => {
          const action = adventureActions.find(item => item.action.key === `resolve.${instance.questKey}`)
          return <article key={instance.instanceKey} className="rounded border border-border bg-bg-base p-3 text-xs">
            <strong>{instance.title}</strong>
            <p className="mt-1 text-text-muted">进行中 · {instance.regionKey}</p>
            <button
              type="button"
              disabled={!action?.available || store.busy}
              onClick={() => void run(() => store.resolveAdventureAction(`resolve.${instance.questKey}`))}
              className="mt-2 rounded bg-accent px-2 py-1 text-white disabled:opacity-40"
            ><Check className="mr-1 inline h-3 w-3" />{action?.available ? '解决任务' : action?.reason ?? '当前区域不可处理'}</button>
          </article>
        })}
        {!revealed.length && !active.length && <p className="text-xs text-text-muted">当前没有已揭示或进行中的任务。</p>}
      </div>
    </article>
  </div>

  const characterView = <div className="space-y-3">
    <article className="rounded border border-border bg-bg-surface p-5">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <UserRound className="h-4 w-4 text-accent" />角色数据不可用
      </div>
      <p className="text-xs leading-5 text-text-muted">
        这个旧版兼容运行包没有提供统一的角色属性、等级、生命、技能、装备或背包数值合同。为避免伪造玩家状态，本页不推测任何角色数值；现有行动仍严格按照该 Release 冻结的旧规则执行。
      </p>
    </article>
  </div>

  const regionalProjection = <article className="rounded border border-border bg-bg-surface p-4">
    <strong className="text-sm">区域投影</strong>
    {currentProjection ? <div className="mt-3 space-y-2 text-xs">
      <div><small className="text-text-muted">资源</small>{Object.entries(currentProjection.resources).map(([key, value]) => <span key={key} className="ml-2">{key} {value}</span>)}</div>
      <div><small className="text-text-muted">指标</small>{Object.entries(currentProjection.metrics).map(([key, value]) => <span key={key} className="ml-2">{key} {value}</span>)}</div>
      <div><small className="text-text-muted">问题</small>{Object.entries(currentProjection.issuePressures).map(([key, value]) => <div key={key} className="mt-1 flex justify-between rounded bg-bg-base px-2 py-1"><span>{key}</span><strong>{value}</strong></div>)}</div>
    </div> : <p className="mt-2 text-xs text-text-muted">当前区域尚无投影。</p>}
  </article>

  const peopleAndOrganizations = <article className="rounded border border-border bg-bg-surface p-4">
    <strong className="text-sm">关键人物与组织</strong>
    <div className="mt-2 flex flex-wrap gap-1">
      {currentRegion?.residentParticipantKeys.map(key => <code key={key} className="rounded bg-bg-base px-2 py-1 text-[9px]">{key}</code>)}
      {currentRegion?.organizationKeys.map(key => <code key={key} className="rounded bg-accent/10 px-2 py-1 text-[9px] text-accent">{key}</code>)}
      {!currentRegion?.residentParticipantKeys.length && !currentRegion?.organizationKeys.length
        && <span className="text-xs text-text-muted">当前地区没有已登记人物或组织。</span>}
    </div>
  </article>

  const checkpointPanel = <article className="rounded border border-border bg-bg-surface p-4">
    <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
      <Save className="h-4 w-4 text-accent" />检查点与分支
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
        disabled={!checkpointName.trim()}
        onClick={() => void run(async () => {
          await store.saveCheckpoint(checkpointName)
          setCheckpointName('')
        })}
        className="rounded border border-border px-2 text-xs"
      >保存</button>
    </div>
    <div className="mt-2 max-h-32 space-y-1 overflow-y-auto">
      {store.checkpoints.map(checkpoint => <button
        key={checkpoint.id}
        type="button"
        onClick={() => void run(() => store.forkCheckpoint(checkpoint.id!))}
        className="block w-full rounded bg-bg-base px-2 py-1 text-left text-[9px]"
      >{checkpoint.name} · #{checkpoint.throughSequence} <GitBranch className="ml-1 inline h-3 w-3" /></button>)}
    </div>
  </article>

  const context = <div className="space-y-3">
    <article className="open-world-game-context-card">
      <small>当前地区</small>
      <strong>{currentRegionTitle}</strong>
      <p>{currentRegionDescription}</p>
      <span>{world.regionKnowledge[world.currentRegionKey]} · {world.attentionLevels[world.currentRegionKey]}</span>
    </article>
    {regionalProjection}
    {peopleAndOrganizations}
  </div>

  return <TextOpenWorldGameShell
    sessionKey={selected.id}
    gameTitle={manifest.definition.title}
    locationTitle={currentRegionTitle}
    sourceLabel={sourceLabel}
    views={{
      scene: sceneView,
      map: mapView,
      quests: questsView,
      character: characterView,
      more: <div className="space-y-3">{regionalProjection}{peopleAndOrganizations}{checkpointPanel}</div>,
    }}
    context={context}
    status={<>
      <span><strong>世界 tick</strong>{world.tick}/{world.tickLimit}</span>
      <span><strong>旅行</strong>{world.travel ? `前往 ${world.travel.toRegionKey} · 剩余 ${world.travel.remainingTicks}` : '当前驻留'}</span>
      <span><strong>当前区域</strong>{currentRegionTitle}</span>
      <span><strong>时间线</strong>事件 #{store.runtimeState.lastSequence}</span>
      <span><strong>保存状态</strong>{store.busy ? '正在结算' : '已自动保存'}</span>
    </>}
    navigationSupplement={<section className="open-world-game-rail-card" aria-label="旧版动态任务">
      <small>动态任务</small>
      <strong>{active.length} 进行中 · {revealed.length} 可接取</strong>
      <span>旧版兼容运行包</span>
    </section>}
    error={error}
    busy={store.busy}
    onExit={() => void store.select(null)}
  />
}
