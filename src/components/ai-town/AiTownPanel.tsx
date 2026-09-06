import { useEffect, useMemo, useState } from 'react'
import {
  CalendarDays,
  Check,
  Clock3,
  Coffee,
  Coins,
  FastForward,
  GitBranch,
  Hammer,
  HeartHandshake,
  Home,
  Loader2,
  MapPin,
  MessageCircle,
  PackageOpen,
  Plus,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react'
import { resolveRequestConfig } from '../../lib/ai/client'
import { isAIConfigReady } from '../../lib/ai/config-readiness'
import type { FrozenRuntimeMediaAssetV2, ProductMediaResolverV1, Project, WorkspaceScope } from '../../lib/types'
import type { AiTownPlayerActionKindV1 } from '../../lib/ai-town/runtime-api'
import { aiTownMajorChangeEligibilityV1, availableAiTownEventSeedsV1 } from '../../lib/ai-town/runtime'
import { productRuntimeSourceForSessionV1, resolveProductRuntimeSource } from '../../lib/product-production/preview-source'
import { useAIConfigStore } from '../../stores/ai-config'
import { useAiTownPlayerStore } from '../../stores/ai-town-player'

const SLOT_LABELS = {
  morning: '早上',
  'late-morning': '上午',
  noon: '中午',
  afternoon: '下午',
  evening: '晚上',
  midnight: '午夜',
} as const

const WEATHER_LABELS = { clear: '晴朗', cloudy: '多云', rain: '有雨' } as const

const ACTIONS: Array<{ kind: AiTownPlayerActionKindV1; label: string; icon: typeof Coffee }> = [
  { kind: 'talk', label: '陪伴交谈', icon: MessageCircle },
  { kind: 'help', label: '帮忙', icon: HeartHandshake },
  { kind: 'work', label: '共同建设', icon: Hammer },
  { kind: 'gift', label: '送礼', icon: PackageOpen },
  { kind: 'cook', label: '做饭', icon: Coffee },
  { kind: 'care', label: '照料', icon: HeartHandshake },
  { kind: 'observe', label: '观察生活', icon: Users },
]

export default function AiTownPanel(props: {
  project: Project
  worldGroupId: number | null
  workspaceScope?: WorkspaceScope
  initialSessionId?: number | null
}) {
  const store = useAiTownPlayerStore()
  const { config } = useAIConfigStore()
  const [selectedResidentKey, setSelectedResidentKey] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [actionNote, setActionNote] = useState('')
  const [checkpointName, setCheckpointName] = useState('')
  const [branchName, setBranchName] = useState('')
  const [localError, setLocalError] = useState('')
  const [mediaAssets, setMediaAssets] = useState<FrozenRuntimeMediaAssetV2[]>([])
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({})
  const [mediaFailures, setMediaFailures] = useState<Array<{ assetKey: string; reason: string }>>([])

  useEffect(() => {
    if (props.workspaceScope) void store.load(props.workspaceScope, props.worldGroupId).then(async () => {
      if (props.initialSessionId != null) await store.select(props.initialSessionId)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.workspaceScope?.projectId, props.workspaceScope?.worldId, props.workspaceScope?.workId, props.worldGroupId, props.initialSessionId])

  const selectedSession = store.sessions.find(session => session.id === store.selectedSessionId) ?? null
  const town = store.runtimeState.town
  const interaction = store.runtimeState.interaction
  const currentResidents = useMemo(() => town ? Object.values(town.residents)
    .filter(resident => resident.residencyStatus === 'resident' && resident.locationKey === town.player.locationKey) : [], [town])
  const selectedResident = selectedResidentKey && town ? town.content.residents.find(resident => resident.residentKey === selectedResidentKey) ?? null : null
  const selectedResidentState = selectedResident && town ? town.residents[selectedResident.residentKey] : null
  const selectedParticipant = selectedResident ? interaction?.profiles.find(profile => (
    profile.characterKey === selectedResident.sourceCharacterResourceKey
  )) ?? null : null
  const messages = interaction?.messages.filter(item => item.supersededBySequence == null
    && (!selectedParticipant || item.audienceKeys == null || item.audienceKeys.includes(selectedParticipant.participantKey))) ?? []
  const eventAvailability = useMemo(() => town ? availableAiTownEventSeedsV1(town.content, town) : [], [town])
  const majorChangeEligibility = useMemo(() => town ? aiTownMajorChangeEligibilityV1(town) : null, [town])
  const resolvedAi = resolveRequestConfig(config, { category: 'runtime.character.interaction-reply' })
  const resolvedDirectorAi = resolveRequestConfig(config, { category: 'runtime.prose.ai-town-director' })
  const aiReady = isAIConfigReady(resolvedAi.config)
  const directorReady = isAIConfigReady(resolvedDirectorAi.config)
  const error = localError || store.error
  const mediaProjectId = props.workspaceScope?.projectId
  const mediaWorldId = props.workspaceScope?.worldId
  const mediaWorkId = props.workspaceScope?.workId
  const mediaSessionId = selectedSession?.id

  useEffect(() => {
    let cancelled = false
    let resolver: ProductMediaResolverV1 | null = null
    setMediaAssets([]); setMediaUrls({}); setMediaFailures([])
    if (mediaProjectId == null || mediaWorldId == null || mediaWorkId == null || mediaSessionId == null) return () => undefined
    const session = useAiTownPlayerStore.getState().sessions.find(item => item.id === mediaSessionId)
    if (!session) return () => undefined
    void (async () => {
      const resolved = await resolveProductRuntimeSource({
        scope: { projectId: mediaProjectId, worldId: mediaWorldId, workId: mediaWorkId },
        source: await productRuntimeSourceForSessionV1(session),
      })
      resolver = resolved.mediaResolver
      const assets = [...(resolved.runtimePackage.presentation?.assets ?? [])]
        .sort((left, right) => left.assetKey.localeCompare(right.assetKey))
      const catalog = await resolver.preload({
        assetKeys: assets.map(asset => asset.assetKey),
        maximumBytes: Math.min(128 * 1024 * 1024, assets.reduce((sum, asset) => sum + asset.byteSize, 0)),
      })
      if (cancelled) { resolver.dispose(); return }
      setMediaAssets(assets); setMediaUrls(catalog.urls); setMediaFailures(catalog.failures)
    })().catch(reason => {
      if (!cancelled) setMediaFailures([{ assetKey: 'town.presentation', reason: reason instanceof Error ? reason.message : String(reason) }])
    })
    return () => { cancelled = true; resolver?.dispose() }
  }, [mediaProjectId, mediaSessionId, mediaWorkId, mediaWorldId])

  const locationMedia = useMemo(() => mediaAssets.filter(asset => asset.kind === 'background' || asset.kind === 'cg'), [mediaAssets])
  const residentArtwork = (residentKey: string, kind: 'character-pose' | 'character-expression') => {
    if (!town) return null
    const index = town.content.residents.findIndex(resident => resident.residentKey === residentKey)
    const resident = town.content.residents[index]
    return mediaAssets.find(asset => asset.kind === kind && asset.characterTag === resident?.sourceCharacterResourceKey)
      ?? mediaAssets.find(asset => asset.kind === kind && asset.sceneTag.includes(`town-resident-${String(index + 1).padStart(3, '0')}`))
      ?? mediaAssets.filter(asset => asset.kind === kind)[index] ?? null
  }
  const residentPortrait = (residentKey: string) => residentArtwork(residentKey, 'character-pose')
  const selectedResidentArtwork = selectedResident
    ? (selectedResidentState?.mood !== 'calm' ? residentArtwork(selectedResident.residentKey, 'character-expression') : null)
      ?? residentPortrait(selectedResident.residentKey)
    : null
  const ambientAsset = mediaAssets.find(asset => asset.kind === 'ambience' || asset.kind === 'bgm') ?? null

  useEffect(() => {
    if (selectedResidentKey && !currentResidents.some(resident => resident.residentKey === selectedResidentKey)) setSelectedResidentKey(null)
  }, [currentResidents, selectedResidentKey])

  const run = async (operation: () => Promise<void>) => {
    setLocalError('')
    try { await operation() }
    catch (reason) { setLocalError(reason instanceof Error ? reason.message : String(reason)) }
  }

  if (!props.workspaceScope) return <div className="product-runtime-empty"><ShieldCheck className="h-8 w-8" /><h2>工作区归属未就绪</h2><p>先建立 World/Work 并发布一个后日谈 AI 小镇。</p></div>

  return <div className="flex min-h-[46rem] flex-col bg-bg-base xl:flex-row" data-testid="ai-town-player">
    <aside className="w-full shrink-0 border-b border-border bg-bg-surface p-4 xl:w-72 xl:border-b-0 xl:border-r">
      <div className="mb-3 flex items-center gap-2"><Home className="h-4 w-4 text-accent" /><strong className="text-sm">后日谈发布</strong></div>
      <p className="mb-4 text-xs leading-5 text-text-muted">每个小镇只从不可变 ProductRelease 启动；原作世界在运行期只读。</p>
      <div className="space-y-2">{store.releases.map(item => <article key={item.release.id} className="rounded border border-border bg-bg-base p-3">
        <strong className="block text-sm">{item.manifest?.definition.title ?? item.release.label}</strong>
        <span className="mt-1 block text-[10px] text-text-muted">v{item.release.version} · {item.manifest?.town.residents.length ?? 0} 位居民 · {item.manifest?.town.map.locations.length ?? 0} 个地点</span>
        {item.error && <p className="mt-2 text-[10px] text-danger">{item.error}</p>}
        <button disabled={!item.manifest || !!item.error || store.busy} onClick={() => void run(async () => { await store.start(item.release.id!) })} className="mt-3 flex w-full items-center justify-center gap-1 rounded bg-accent px-2 py-1.5 text-xs text-white disabled:opacity-40"><Plus className="h-3 w-3" />建立小镇存档</button>
      </article>)}</div>
      {!store.releases.length && !store.loading && <div className="rounded border border-dashed border-border p-4 text-center text-xs text-text-muted">尚无 AI 小镇发布。切换到“正式制作”，从冻结世界版本生产。</div>}
      <div className="mb-2 mt-6 text-xs font-semibold">小镇存档</div>
      <div className="space-y-1">{store.sessions.map(session => <div key={session.id} className={`flex rounded ${session.id === selectedSession?.id ? 'bg-accent/10' : ''}`}><button className="min-w-0 flex-1 px-2 py-2 text-left text-xs" onClick={() => void store.select(session.id!)}><strong className="block truncate">{session.title}</strong><span className="text-[9px] text-text-muted">{session.id === selectedSession?.id ? `事件 ${store.runtimeState.lastSequence}` : '可继续'}</span></button><button aria-label="删除小镇存档" onClick={() => void run(async () => { await store.remove(session.id!) })} className="px-2 text-text-muted hover:text-danger"><Trash2 className="h-3 w-3" /></button></div>)}</div>
    </aside>

    <main className="min-w-0 flex-1 p-4 sm:p-6">
      {error && <div className="mb-4 rounded border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}
      {mediaFailures.length > 0 && <div className="mb-4 rounded border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">部分发布媒资未能加载，小镇已降级为可完整游玩的文字界面：{mediaFailures.map(item => `${item.assetKey}(${item.reason})`).join('、')}</div>}
      {!selectedSession && <div className="product-runtime-empty"><Home className="h-8 w-8" /><h2>选择一个发布开始后日谈</h2><p>小镇拥有独立时间、地点、居民日程、关系、知识、共同项目和可回滚演化。</p></div>}
      {selectedSession && town && <div className="mx-auto max-w-7xl space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-3"><div><span className="text-[10px] text-accent">AFTERSTORY TOWN · PRODUCT RELEASE</span><h1 className="mt-1 text-xl font-semibold">{town.content.title}</h1><p className="mt-1 text-xs text-text-muted">第 {town.day} 日 · {SLOT_LABELS[town.slot]} · {WEATHER_LABELS[town.weatherKey]} · {town.content.premise}</p>{ambientAsset && mediaUrls[ambientAsset.assetKey] && <audio className="mt-2 h-7 max-w-xs" controls loop preload="metadata" src={mediaUrls[ambientAsset.assetKey]} aria-label={ambientAsset.altText || '小镇环境音'} />}</div><div className="flex flex-wrap gap-2 text-[10px]"><span className="rounded border border-border px-2 py-1"><Clock3 className="mr-1 inline h-3 w-3" />行动 {town.actionsRemaining}</span><span className="rounded border border-border px-2 py-1">精力 {town.player.energy}/{town.player.maximumEnergy}</span><span className="rounded border border-border px-2 py-1"><Coins className="mr-1 inline h-3 w-3" />{town.player.money}</span></div></header>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(20rem,.8fr)]">
          <article className="rounded-lg border border-border bg-bg-surface p-4"><div className="mb-3 flex items-center justify-between"><h2 className="flex items-center gap-2 text-sm font-semibold"><MapPin className="h-4 w-4 text-accent" />可点击语义地图</h2><span className="text-[10px] text-text-muted">点击地点移动 · 不使用连续像素寻路</span></div><div className="relative min-h-[25rem] overflow-hidden rounded-lg border border-border bg-gradient-to-br from-emerald-950/30 via-bg-base to-amber-950/20" data-testid="ai-town-map">
            <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">{town.content.map.routes.map(route => { const from = town.content.map.locations.find(item => item.key === route.fromLocationKey)!; const to = town.content.map.locations.find(item => item.key === route.toLocationKey)!; return <line key={route.key} x1={`${from.x}%`} y1={`${from.y}%`} x2={`${to.x}%`} y2={`${to.y}%`} stroke="currentColor" strokeOpacity=".18" strokeWidth="3" strokeDasharray="7 7" /> })}</svg>
            {town.content.map.locations.map((location, locationIndex) => { const here = town.player.locationKey === location.key; const residents = Object.values(town.residents).filter(resident => resident.residencyStatus === 'resident' && resident.locationKey === location.key); const artwork = locationMedia[locationIndex] ?? null; return <button key={location.key} disabled={here || store.busy} style={{ left: `${location.x}%`, top: `${location.y}%` }} onClick={() => void run(async () => { await store.move(location.key) })} className={`absolute w-36 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-lg border p-3 text-left shadow-lg transition disabled:cursor-default ${here ? 'border-accent bg-accent/15' : 'border-border bg-bg-surface/95 hover:border-accent/60'}`}>{artwork && mediaUrls[artwork.assetKey] && <img src={mediaUrls[artwork.assetKey]} alt="" className="absolute inset-0 h-full w-full object-cover opacity-20" />}<span className="relative block truncate text-xs font-semibold">{location.title}</span><span className="relative mt-1 block text-[9px] text-text-muted">{residents.length ? `${residents.length} 位居民在这里` : '此刻很安静'}</span><span className="relative mt-2 flex -space-x-1">{residents.slice(0, 6).map(resident => { const definition = town.content.residents.find(item => item.residentKey === resident.residentKey)!; const portrait = residentPortrait(resident.residentKey); return portrait && mediaUrls[portrait.assetKey] ? <img key={resident.residentKey} title={definition.name} src={mediaUrls[portrait.assetKey]} alt={definition.name} className="h-5 w-5 rounded-full border border-bg-surface object-cover" /> : <i key={resident.residentKey} title={definition.name} className="flex h-5 w-5 items-center justify-center rounded-full border border-bg-surface bg-accent/30 text-[8px] not-italic">{definition.name.slice(0, 1)}</i> })}</span></button> })}
          </div></article>

          <div className="space-y-4"><article className="rounded-lg border border-border bg-bg-surface p-4"><h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Users className="h-4 w-4 text-accent" />当前地点的生活</h2><div className="space-y-2">{currentResidents.map(resident => { const definition = town.content.residents.find(item => item.residentKey === resident.residentKey)!; const portrait = (resident.mood !== 'calm' ? residentArtwork(resident.residentKey, 'character-expression') : null) ?? residentPortrait(resident.residentKey); return <button key={resident.residentKey} onClick={() => setSelectedResidentKey(resident.residentKey)} className={`flex w-full items-center gap-3 rounded border p-3 text-left ${selectedResidentKey === resident.residentKey ? 'border-accent bg-accent/10' : 'border-border bg-bg-base'}`}>{portrait && mediaUrls[portrait.assetKey] ? <img src={mediaUrls[portrait.assetKey]} alt={portrait.altText || definition.name} className="h-10 w-10 shrink-0 rounded-full object-cover" /> : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm">{definition.name.slice(0, 1)}</span>}<span className="min-w-0 flex-1"><span className="flex items-center justify-between"><strong className="text-xs">{definition.name}</strong><span className="text-[9px] text-text-muted">{resident.mood}</span></span><span className="mt-1 block truncate text-[10px] text-text-muted">{resident.activity}</span></span></button>})}{!currentResidents.length && <p className="text-xs text-text-muted">这里暂时没有居民；他们仍按自己的日程生活。</p>}</div></article>
            <article className="rounded-lg border border-border bg-bg-surface p-4"><h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Hammer className="h-4 w-4 text-accent" />{town.sharedProject.title}</h2><div className="h-2 overflow-hidden rounded bg-bg-base"><span className="block h-full bg-accent" style={{ width: `${Math.round(town.sharedProject.progress / town.sharedProject.targetProgress * 100)}%` }} /></div><p className="mt-2 text-[10px] text-text-muted">{town.sharedProject.progress}/{town.sharedProject.targetProgress} · {town.sharedProject.completed ? '里程碑已解锁，居民已经围绕成果调整新的生活目标。' : '共同建设完成后会改变居民的生活目标与后续事件语境。'}</p><div className="mt-3 flex flex-wrap gap-2">{Object.entries(town.player.resources).map(([key, value]) => <span key={key} className="rounded bg-bg-base px-2 py-1 text-[10px]">{town.content.economy.resources.find(item => item.key === key)?.title ?? key} {value}</span>)}</div></article>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-bg-surface p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-accent" />参与当下</h2><div className="flex flex-wrap gap-2"><button disabled={store.busy || !directorReady || (!eventAvailability.some(item => item.available) && !majorChangeEligibility?.eligible)} title={!directorReady ? '请先配置可用 AI' : eventAvailability.some(item => item.available) || majorChangeEligibility?.eligible ? '导演只能选择当前可触发事件，重大变化仍需你确认' : '当前没有合法的导演候选，请等待或移动到其他地点'} onClick={() => void run(async () => { await store.direct(resolvedDirectorAi.config) })} className="flex items-center gap-1 rounded border border-accent/40 bg-accent/5 px-3 py-1.5 text-xs text-accent disabled:opacity-40">{store.directorRunId != null ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}{store.directorRunId != null ? '小镇正在推演…' : '让小镇自行发展'}</button><button disabled={store.busy} onClick={() => void run(store.wait)} className="flex items-center gap-1 rounded border border-border px-3 py-1.5 text-xs"><FastForward className="h-3 w-3" />等待一个时段</button></div></div><input value={actionNote} onChange={event => setActionNote(event.target.value)} placeholder="可选：补充你这次行动的方式（不会替角色决定反应）" className="mb-3 w-full rounded border border-border bg-bg-base px-3 py-2 text-xs" /><div className="flex flex-wrap gap-2">{ACTIONS.map(({ kind, label, icon: Icon }) => <button key={kind} disabled={store.busy || town.actionsRemaining < 1 || (['talk', 'help', 'gift'].includes(kind) && !selectedResidentState)} onClick={() => void run(async () => { await store.act(kind, selectedResidentKey, actionNote); setActionNote('') })} className="flex items-center gap-1 rounded border border-border px-3 py-2 text-xs hover:border-accent disabled:opacity-35"><Icon className="h-3.5 w-3.5" />{label}</button>)}</div>
          <div className="mt-3 flex flex-wrap gap-2">{eventAvailability.map(item => <button key={item.seed.key} disabled={store.busy || !item.available} title={item.reason ?? item.seed.summary} onClick={() => void run(async () => { await store.trigger(item.seed.key) })} className="rounded border border-accent/30 bg-accent/5 px-3 py-1.5 text-xs text-accent disabled:border-border disabled:bg-bg-base disabled:text-text-muted disabled:opacity-50">观察事件：{item.seed.title}{item.reason ? ` · ${item.reason}` : ''}</button>)}</div>
        </section>

        {selectedResident && <section className="rounded-lg border border-border bg-bg-surface"><div className="flex items-center gap-3 border-b border-border px-4 py-3">{selectedResidentArtwork && mediaUrls[selectedResidentArtwork.assetKey] && <img src={mediaUrls[selectedResidentArtwork.assetKey]} alt={selectedResidentArtwork.altText || selectedResident.name} className="h-12 w-12 shrink-0 rounded-full object-cover" />}<div><h2 className="text-sm font-semibold">和 {selectedResident.name} 说话</h2><p className="mt-1 text-[10px] text-text-muted">{selectedResident.summary} · {selectedResidentState?.activity}</p></div></div><div className="max-h-72 space-y-2 overflow-y-auto p-4">{messages.map(item => <div key={item.eventSequence} className={`flex ${item.role === 'player' ? 'justify-end' : 'justify-start'}`}><article className={`max-w-[85%] rounded-lg px-3 py-2 text-xs ${item.role === 'player' ? 'bg-accent/15' : 'bg-bg-base'}`}><span className="mb-1 block text-[9px] text-text-muted">{item.role === 'player' ? '你' : interaction?.profiles.find(profile => profile.participantKey === item.speakerKey)?.name ?? item.speakerKey} · #{item.eventSequence}</span><p className="whitespace-pre-wrap">{item.text}</p></article></div>)}{store.generatingRunId != null && <p className="flex items-center gap-2 text-xs text-text-muted"><Loader2 className="h-3 w-3 animate-spin" />正式 Harness 正在生成角色候选…</p>}</div><div className="border-t border-border p-3"><textarea rows={2} value={message} onChange={event => setMessage(event.target.value)} placeholder={`对${selectedResident.name}说……`} className="w-full rounded border border-border bg-bg-base px-3 py-2 text-sm" /><div className="mt-2 flex items-center justify-between gap-2"><span className="text-[10px] text-text-muted">{aiReady ? '读取该角色可见的小镇状态，经 Harness 生成并采用回复；同一居民每日关系收益有上限' : 'AI 未就绪时只保存玩家消息，不伪造回复；同一居民每日关系收益有上限'}</span><button disabled={!message.trim() || store.busy} onClick={() => void run(async () => { const value = message.trim(); setMessage(''); await store.sendMessage(value, selectedResident.residentKey, aiReady ? resolvedAi.config : undefined) })} className="flex items-center gap-1 rounded bg-accent px-3 py-1.5 text-xs text-white disabled:opacity-40"><Send className="h-3 w-3" />{aiReady ? '发送并生成' : '仅保存'}</button></div></div></section>}

        <section className="grid gap-4 lg:grid-cols-3"><article className="rounded border border-border bg-bg-surface p-4"><h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><CalendarDays className="h-4 w-4 text-accent" />每日回顾</h2><div className="space-y-2">{town.dailyDigests.slice(-5).reverse().map(digest => <details key={`${digest.day}:${digest.throughSequence}`} className="rounded bg-bg-base p-2 text-xs"><summary>第 {digest.day} 日</summary><ul className="mt-2 list-disc space-y-1 pl-4 text-text-muted">{digest.publicSummary.map((line, index) => <li key={index}>{line}</li>)}</ul></details>)}{!town.dailyDigests.length && <p className="text-xs text-text-muted">完成第一日后出现只含公开事实的回顾。</p>}</div>{town.content.offline.enabled ? <div className="mt-3 flex gap-2"><button disabled={store.busy} onClick={() => void run(async () => { await store.offline(1) })} className="rounded border border-border px-2 py-1 text-[10px]">离线推进 1 日</button>{town.content.offline.maximumDays > 1 && <button disabled={store.busy} onClick={() => void run(async () => { await store.offline(town.content.offline.maximumDays) })} className="rounded border border-border px-2 py-1 text-[10px]">离线推进 {town.content.offline.maximumDays} 日</button>}</div> : <p className="mt-3 text-[10px] text-text-muted">本小镇未启用离线演化。</p>}</article>
          <article className="rounded border border-border bg-bg-surface p-4"><h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><HeartHandshake className="h-4 w-4 text-accent" />可观察关系</h2><div className="space-y-2">{Object.values(town.relationships).filter(edge => edge.toResidentKey === 'player').map(edge => { const resident = town.content.residents.find(item => item.residentKey === edge.fromResidentKey); return <div key={edge.key} className="rounded bg-bg-base p-2 text-xs"><strong>{resident?.name ?? edge.fromResidentKey}</strong><p className="mt-1 text-[10px] text-text-muted">信任 {edge.trust >= 60 ? '上升' : edge.trust < 35 ? '谨慎' : '尚在建立'} · 亲近 {edge.intimacy >= 50 ? '熟悉' : '初识'} · 戒备 {edge.wariness >= 50 ? '明显' : '平稳'}</p>{edge.evidenceSequences.length > 0 && <span className="text-[9px] text-text-muted">证据 #{edge.evidenceSequences.slice(-3).join('、#')}</span>}</div>})}</div></article>
          <article className="rounded border border-border bg-bg-surface p-4"><h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Save className="h-4 w-4 text-accent" />检查点与分支</h2><div className="flex gap-2"><input value={checkpointName} onChange={event => setCheckpointName(event.target.value)} placeholder="检查点名称" className="min-w-0 flex-1 rounded border border-border bg-bg-base px-2 py-1 text-xs" /><button disabled={!checkpointName.trim()} onClick={() => void run(async () => { await store.saveCheckpoint(checkpointName); setCheckpointName('') })} className="rounded border border-border px-2 text-[10px]"><Save className="h-3 w-3" /></button></div><div className="mt-2 space-y-1">{store.checkpoints.slice(0, 4).map(item => <button key={item.id} onClick={() => void run(async () => { await store.forkCheckpoint(item.id!) })} className="block w-full rounded bg-bg-base px-2 py-1 text-left text-[10px] text-text-muted">{item.name} · #{item.throughSequence}</button>)}</div><div className="mt-3 flex gap-2"><input value={branchName} onChange={event => setBranchName(event.target.value)} placeholder="分支名称" className="min-w-0 flex-1 rounded border border-border bg-bg-base px-2 py-1 text-xs" /><button disabled={!branchName.trim()} onClick={() => void run(async () => { await store.forkCurrent(branchName); setBranchName('') })} className="rounded border border-border px-2 text-[10px]"><GitBranch className="h-3 w-3" /></button></div></article>
        </section>

        {town.pendingMajorChanges.some(candidate => candidate.status === 'pending') && <section className="rounded border border-warning/40 bg-warning/5 p-4"><h2 className="text-sm font-semibold">重大变化待确认</h2><p className="mt-1 text-xs text-text-muted">离线运行和 AI 只能提出候选，不能自动执行。</p>{town.pendingMajorChanges.filter(candidate => candidate.status === 'pending').map(candidate => <article key={candidate.candidateKey} className="mt-3 rounded bg-bg-base p-3"><strong className="text-xs">{candidate.title}</strong><p className="my-2 text-xs text-text-muted">{candidate.summary}</p><div className="flex gap-2"><button onClick={() => void run(async () => { await store.resolveMajor(candidate.candidateKey, 'accepted') })} className="flex items-center gap-1 text-xs text-accent"><Check className="h-3 w-3" />确认</button><button onClick={() => void run(async () => { await store.resolveMajor(candidate.candidateKey, 'rejected') })} className="text-xs text-text-muted">拒绝</button></div></article>)}</section>}
      </div>}
    </main>
  </div>
}
