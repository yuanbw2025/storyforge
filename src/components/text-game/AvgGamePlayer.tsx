import { selectAvgSceneMediaWindowV1 } from '../../lib/avg/scene-media-window'
import { loadAvgReaderPreferencesV1, saveAvgReaderPreferencesV1 } from '../../lib/avg/reader-preferences'
import { NativeVoice } from '../avg/NativeVoice'
import { ReadingHistory } from '../avg/ReadingHistory'
import { useCueClock } from '../avg/useCueClock'
import { avgVoiceReadyV1 } from '../../lib/avg/reading-runtime'
import { InventoryPanel } from '../avg/InventoryPanel'
import { projectAvgInventoryV1 } from '../../lib/avg/inventory-runtime'
import { avgExecutableModule, avgRuntimeStage } from '../../lib/avg/executable-module'
import StageAudio from '../avg/StageAudio'
import { avgCueTimeline } from '../../lib/avg/cue-timeline'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, BookOpen, BriefcaseBusiness, ChevronRight, Eye, EyeOff, FastForward, Gauge, GitBranch, History, ImageOff, Maximize2, Play, Plus, RotateCcw, Save, Settings2, SkipForward, Trash2, Volume2, VolumeX, X } from 'lucide-react'
import type { FrozenNarrativeChoice, Project, WorkspaceScope, ProductMediaResolverV1 } from '../../lib/types'
import { useAvgGamePlayerStore } from '../../stores/avg-game-player'
import { applyAvgCue } from '../../lib/avg/runtime'
import { currentPlayerReleases } from '../../lib/text-game/player-library'
import { verifyProductMediaRuntimeUrlsV1 } from '../../lib/product-production/media-runtime-verifier'
import { recordProductMediaRuntimeMeasurementV1 } from '../../lib/product-production/quality-receipts'
import { useDialog } from '../shared/Dialog'
import './player-roadshow.css'

type PlayerPanel = 'history' | 'saves' | 'inventory' | null

export async function loadAvgPlayerInitialSelectionV1(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  initialSessionId?: number | null
  load: (scope: WorkspaceScope, worldGroupId: number | null, openLibrary?: boolean) => Promise<void>
  select: (sessionId: number | null) => Promise<void>
  cancelled?: () => boolean
}): Promise<void> {
  // Always load the library without auto-selecting an arbitrary existing
  // session. Direct Build Preview then performs exactly one explicit select.
  // This prevents the first resolver from being disposed halfway through a
  // multi-asset preload by a second, same-session select.
  await input.load(input.scope, input.worldGroupId, true)
  if (input.initialSessionId != null && !input.cancelled?.()) {
    await input.select(input.initialSessionId)
  }
}

function splitAttributedText(text: string): { speaker: string; text: string } | null {
  const match = text.match(/^【([^】]+)】\s*([\s\S]*)$/)
  return match ? { speaker: match[1].trim(), text: match[2].trimStart() } : null
}

function currentBrowserEnvironment() {
  const userAgent = navigator.userAgent || 'unknown-browser'
  const browserName = /Edg\//.test(userAgent) ? 'edge'
    : /Chrome\//.test(userAgent) ? 'chromium'
      : /Firefox\//.test(userAgent) ? 'firefox'
        : /Safari\//.test(userAgent) ? 'safari' : 'browser'
  return {
    browserName,
    browserVersion: userAgent,
    platform: navigator.platform || 'desktop',
    viewport: {
      width: Math.max(1, window.innerWidth),
      height: Math.max(1, window.innerHeight),
    },
  }
}

export default function AvgGamePlayer(props: { project: Project; scope: WorkspaceScope; worldGroupId: number | null; initialSessionId?: number | null; initialPanel?: PlayerPanel; onReturnToWorkbench?:()=>void }) {
  const store = useAvgGamePlayerStore()
  const dialog = useDialog()
  const [prefs, setPrefs] = useState(loadAvgReaderPreferencesV1)
  useEffect(() => saveAvgReaderPreferencesV1(prefs), [prefs])
  const [panel, setPanel] = useState<PlayerPanel>(props.initialPanel??null)
  const [foreground, setForeground] = useState(() => !document.hidden)
  useEffect(() => { const update = () => setForeground(!document.hidden); document.addEventListener('visibilitychange', update); return () => document.removeEventListener('visibilitychange', update) }, [])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [uiHidden, setUiHidden] = useState(false)
  const [mediaView,setMediaView]=useState<{resolver:ProductMediaResolverV1|null;sessionId:number|null;urls:Record<string,string>;failures:Array<{assetKey:string;reason:string}>;loading:boolean}>({resolver:null,sessionId:null,urls:{},failures:[],loading:false})
  const currentMedia=mediaView.resolver===store.selectedMediaResolver&&mediaView.sessionId===store.selectedSessionId?mediaView:null
  const mediaUrls=currentMedia?.urls??{},mediaFailures=currentMedia?.failures??[]
  const mediaLoading=currentMedia?.loading??!!store.selectedSessionId
  const [mediaRetry,setMediaRetry]=useState(0)
  const [historyRequest,setHistoryRequest]=useState<{sessionId:number;assetKey:string;attempt:number}|null>(null)
  useEffect(()=>{if(panel!=='history'||historyRequest?.sessionId!==store.selectedSessionId)setHistoryRequest(null)},[panel,store.selectedSessionId]) // eslint-disable-line react-hooks/exhaustive-deps
  const [visibleCharacters, setVisibleCharacters] = useState(0)
  const [sceneTitleVisible, setSceneTitleVisible] = useState(false)
  const [notice, setNotice] = useState('')
  const [catalogReleaseId, setCatalogReleaseId] = useState<number | null>(null)
  const mediaVerificationKeys = useRef(new Set<string>())

  useEffect(() => {
    let cancelled = false
    setCatalogReleaseId(null)
    void loadAvgPlayerInitialSelectionV1({
      scope: props.scope, worldGroupId: props.worldGroupId, initialSessionId: props.initialSessionId,
      load: store.load, select: store.select, cancelled: () => cancelled,
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [props.scope.projectId, props.scope.worldId, props.scope.workId, props.worldGroupId, props.initialSessionId]) // eslint-disable-line react-hooks/exhaustive-deps
  const catalog = useMemo(() => currentPlayerReleases(store.releases), [store.releases])
  const catalogRelease = catalog.find(item => item.release.id === catalogReleaseId) ?? null
  const nativeReading = store.runtimeState.avgReading
  const pausedTransport = !!nativeReading && (!!panel || settingsOpen || !foreground || store.loading || store.selectedSourceSessionId !== store.selectedSessionId)
  const voiceReady = avgVoiceReadyV1(store.runtimeState)
  const inventory = projectAvgInventoryV1(store.runtimeState)
  const narrative = store.runtimeState.narrative
  const presentation = store.runtimeState.presentation
  const node = narrative?.nodes.find(item => item.key === narrative.currentNodeKey)
  const beats = useMemo(() => (narrative?.beats ?? []).filter(beat => beat.nodeKey === narrative?.currentNodeKey).sort((a, b) => a.order - b.order), [narrative])
  const reachedBeatKey = presentation?.currentNodeKey === narrative?.currentNodeKey ? presentation?.currentBeatKey : null
  const reachedIndex = reachedBeatKey ? beats.findIndex(beat => beat.beatKey === reachedBeatKey) : -1
  const currentBeat = beats[reachedIndex + 1] ?? null
  const hasCurrentBeat = currentBeat !== null
  const choices = [...new Set(narrative?.visibleChoiceKeys ?? [])].map(key => narrative?.choices?.find(item => item.choiceKey === key)).filter((item): item is FrozenNarrativeChoice => !!item)
  const stage = presentation?.stage
  const currentCues = presentation?.cues.filter(cue => cue.beatKey === currentBeat?.beatKey) ?? []
  const beatIdentity = `${store.selectedSessionId}:${narrative?.lastEnteredNodeSequence}:${currentBeat?.beatKey ?? ''}`
  const [afterIdentity,setAfterIdentity] = useState<string|null>(null)
  const finishingBeat = afterIdentity === beatIdentity
  const timelineKey = `${beatIdentity}:${finishingBeat}`
  const timeline = avgCueTimeline(currentCues, finishingBeat)
  const elapsed = useCueClock(timelineKey, [...timeline.entries.map(e => e.at), timeline.duration], pausedTransport)
  const cueWaitComplete = elapsed >= timeline.duration
  const finishGuard = useRef('')
  useEffect(()=>{
    if (pausedTransport || !voiceReady || !finishingBeat || !cueWaitComplete || !currentBeat || store.busy || finishGuard.current===beatIdentity) return
    finishGuard.current=beatIdentity
    void store.reachBeat(currentBeat.beatKey).catch(()=>{finishGuard.current='';setAfterIdentity(null)})
  },[pausedTransport,voiceReady,finishingBeat,cueWaitComplete,beatIdentity,currentBeat,store.busy]) // eslint-disable-line react-hooks/exhaustive-deps
  const visualStage = useMemo(() => {
    if (!stage || !presentation || !currentBeat) return stage
    const initial = finishingBeat ? avgCueTimeline(currentCues,false).entries.map(entry=>entry.cue) : []
    const visible = [...initial,...timeline.entries.filter(entry=>entry.at<=elapsed).map(entry=>entry.cue)]
    return visible.reduce((next,cue)=>applyAvgCue(next,cue,presentation.assets,presentation.snapshots),stage)
  }, [stage,presentation,currentBeat,finishingBeat,elapsed]) // eslint-disable-line react-hooks/exhaustive-deps
  const activeCueEntries = [...(finishingBeat ? avgCueTimeline(currentCues,false).entries : []),...timeline.entries.filter(e => e.at <= elapsed)]
  const cueDuration = Math.max(240, ...currentCues.map(cue => cue.durationMs))
  const attributedText = currentBeat ? splitAttributedText(currentBeat.text) : null
  const dialogueText = attributedText?.text ?? currentBeat?.text ?? ''
  const speakerLabel = currentBeat?.kind === 'dialogue'
    ? store.speakerNames[currentBeat.speakerKey ?? ''] ?? attributedText?.speaker ?? '未知角色'
    : attributedText?.speaker ?? null
  const activeSpeakerKey = currentBeat?.kind === 'dialogue'
    ? currentBeat.speakerKey
    : attributedText ? Object.entries(store.speakerNames).find(([, name]) => name === attributedText.speaker)?.[0] ?? null : null
  const windowKeys=store.selectedManifest?selectAvgSceneMediaWindowV1({runtimePackage:store.selectedManifest,
    sceneKey:narrative?.currentNodeKey??null,currentLineKey:currentBeat?.beatKey??null,stage:visualStage??null,
    images:prefs.images,audio:!prefs.muted,inventoryEntries:panel==='inventory'?inventory.entries:[],
    historyAssetKey:panel==='history'&&historyRequest?.sessionId===store.selectedSessionId?historyRequest.assetKey:null}):null
  const mediaCacheKey = `${store.selectedSessionId??'title'}:${(presentation?.assets??[]).map(asset=>`${asset.assetKey}@${asset.version}:${asset.contentHash}`).join('|')}:${JSON.stringify(windowKeys)}:${mediaRetry}:${panel==='history'?historyRequest?.attempt??0:0}`
  useEffect(()=>{
    let cancelled=false
    const manifest=store.selectedManifest,resolver=store.selectedMediaResolver,sessionId=store.selectedSessionId
    const session=store.sessions.find(row=>row.id===sessionId)??null
    const isCurrent=()=>{const current=useAvgGamePlayerStore.getState();return !cancelled&&current.selectedSessionId===sessionId&&current.selectedSourceSessionId===sessionId&&current.selectedMediaResolver===resolver}
    if(!manifest||!resolver||store.selectedSourceSessionId!==sessionId){setMediaView({resolver:null,sessionId:null,urls:{},failures:[],loading:false});return}
    const keys=windowKeys??(avgRuntimeStage(manifest)?.assets??[]).map(asset=>asset.assetKey)
    setMediaView(previous=>({resolver,sessionId,urls:previous.resolver===resolver&&previous.sessionId===sessionId?previous.urls:{},failures:[],loading:keys.length>0}))
    void store.preloadMedia(undefined,windowKeys??undefined).then(result=>{
      if(!isCurrent())return
      setMediaView({resolver,sessionId,urls:result.urls,failures:result.failures,loading:false})
      void store.recordMediaFailures(result.failures).catch(()=>undefined)
      // Scene windows cannot sign a whole-package media quality gate. The
      // explicit full Build/Release qualification is a separate operation.
      if(windowKeys!==null)return
      if (session?.productBuildId == null || avgRuntimeStage(manifest)!.assets.length === 0) return
      const verificationKey = `${session.productBuildId}:${avgRuntimeStage(manifest)!.assets
        .map(asset => `${asset.assetKey}:${asset.contentHash}`).sort().join('|')}`
      if (mediaVerificationKeys.current.has(verificationKey)) return
      mediaVerificationKeys.current.add(verificationKey)
      void verifyProductMediaRuntimeUrlsV1({
        assets: avgRuntimeStage(manifest)!.assets.map(asset => ({
          assetKey: asset.assetKey, contentHash: asset.contentHash, mimeType: asset.mimeType,
          width: asset.width, height: asset.height, durationMs: asset.durationMs,
        })),
        urls: result.urls,
        environment: currentBrowserEnvironment(),
      }).then(measurement => recordProductMediaRuntimeMeasurementV1({
        scope: props.scope, productBuildId: session.productBuildId!, measurement,
      })).then(verified => {
        if (!verified.evidence.passed) mediaVerificationKeys.current.delete(verificationKey)
      }).catch(() => {
        // The existing media failure UI remains the user-facing surface. A failed
        // or interrupted measurement may be retried when this Preview is reopened.
        mediaVerificationKeys.current.delete(verificationKey)
      })
    }).catch(cause=>{
      if(isCurrent())setMediaView({resolver,sessionId,urls:{},failures:keys.map(assetKey=>({assetKey,reason:cause instanceof Error?cause.message:String(cause)})),loading:false})
    })
    return()=>{cancelled=true}
  },[mediaCacheKey,store.selectedMediaResolver,store.selectedSourceSessionId,props.scope.projectId,props.scope.worldId,props.scope.workId]) // eslint-disable-line react-hooks/exhaustive-deps

  const background = prefs.images && visualStage?.backgroundAssetKey ? visualStage.backgroundAssetKey : null
  const textComplete = !currentBeat || visibleCharacters >= dialogueText.length
  const visibleText = dialogueText.slice(0, visibleCharacters)
  const historyBeats = (narrative?.beats ?? []).filter(beat => presentation?.readBeatKeys.includes(beat.beatKey))
  const run = async (fn: () => Promise<unknown>) => { try { await fn() } catch { /* store exposes error */ } }

  useEffect(() => {
    if (!hasCurrentBeat) { setVisibleCharacters(0); return }
    if (prefs.reducedMotion) { setVisibleCharacters(dialogueText.length); return }
    setVisibleCharacters(0)
    const interval = window.setInterval(() => setVisibleCharacters(value => {
      if (value >= dialogueText.length) { window.clearInterval(interval); return value }
      return Math.min(dialogueText.length, value + 1)
    }), Math.max(12, Math.round(1000 / prefs.textSpeed)))
    return () => window.clearInterval(interval)
  }, [hasCurrentBeat, beatIdentity, dialogueText, prefs.textSpeed, prefs.reducedMotion])

  useEffect(() => {
    if (!node?.key) return
    setSceneTitleVisible(true)
    const timer = window.setTimeout(() => setSceneTitleVisible(false), prefs.reducedMotion ? 900 : 1800)
    return () => window.clearTimeout(timer)
  }, [node?.key, prefs.reducedMotion])

  const advance = (force = false) => {
    if (!currentBeat || store.busy || finishingBeat || pausedTransport) return
    if (!force && !textComplete) { setVisibleCharacters(dialogueText.length); return }
    if (!cueWaitComplete) return
    if (!voiceReady && nativeReading) {
      const c = nativeReading.current
      if (nativeReading.plan.manualVoice === 'interrupt' && c?.lineKey === currentBeat.beatKey) {
        void store.voiceCommand({ type: 'observe', lineKey: currentBeat.beatKey, visit: narrative!.visitedNodeKeys.length-1, generation: c.generation, outcome: 'interrupted', reason: '用户手动推进/已读快进', playedMs: Math.max(0, Math.round(((document.querySelector('audio[data-channel="voice"]') as HTMLAudioElement | null)?.currentTime ?? 0)*1000)) }).then(() => setAfterIdentity(beatIdentity)).catch(() => undefined)
      }
      return
    }
    setAfterIdentity(beatIdentity)
  }
  useEffect(() => {
    if (pausedTransport || !voiceReady || panel || !prefs.auto || !currentBeat || store.busy || !textComplete || finishingBeat || !cueWaitComplete) return
    const timer = window.setTimeout(() => advance(true), 650)
    return () => window.clearTimeout(timer)
  }, [pausedTransport, voiceReady, panel, prefs.auto, prefs.autoDelayMs, beatIdentity, store.busy, textComplete, finishingBeat, cueWaitComplete]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (pausedTransport || panel || !prefs.fast || !currentBeat || store.busy || finishingBeat || !cueWaitComplete) return
    if (!presentation?.readBeatKeys.includes(currentBeat.beatKey)) { setPrefs(value => ({ ...value, fast: false })); return }
    const timer = window.setTimeout(() => advance(true), 80)
    return () => window.clearTimeout(timer)
  }, [pausedTransport, voiceReady, panel, prefs.fast, beatIdentity, presentation?.readBeatKeys, store.busy, finishingBeat, cueWaitComplete]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!store.selectedSessionId || store.busy || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      if (event.key === 'Escape') {
        if (panel) setPanel(null)
        else if (uiHidden) setUiHidden(false)
        return
      }
      // Enter/Space on a control belongs to that control, including the
      // settings menu. Global reading shortcuts must not eat its native click.
      if (settingsOpen || event.target instanceof Element && event.target.closest('button, summary, select, a, [role="button"], [contenteditable]')) return
      if ((event.key === ' ' || event.key === 'Enter') && currentBeat && !panel) { event.preventDefault(); advance() }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [store.selectedSessionId, store.busy, beatIdentity, textComplete, panel, settingsOpen, uiHidden, voiceReady, nativeReading?.current?.generation]) // eslint-disable-line react-hooks/exhaustive-deps

  const fullscreen = () => {
    if (document.fullscreenElement) { void document.exitFullscreen(); return }
    const target = document.querySelector('[data-testid="avg-player"]')
    if (target instanceof HTMLElement && target.requestFullscreen) void target.requestFullscreen()
  }
  const quickSave = async () => {
    try {
      await store.saveCheckpoint(`快速存档 · ${node?.title ?? ''}`)
      setNotice('已快速存档')
      window.setTimeout(() => setNotice(''), 1500)
    } catch { /* store exposes error */ }
  }
  const leaveToTitle = () => {
    setPanel(null)
    setUiHidden(false)
    setPrefs(value => ({ ...value, auto: false, fast: false }))
    if (document.fullscreenElement) void document.exitFullscreen()
    void store.select(null)
  }
  const returnToWorkbench = () => {
    setPrefs(value=>({...value,auto:false,fast:false}))
    if(document.fullscreenElement)void document.exitFullscreen()
    props.onReturnToWorkbench?.()
  }

  if (!store.selectedSessionId) return <div className="avg-player avg-title-screen" data-testid="avg-player">
    <div className="avg-title-atmosphere" aria-hidden="true" />
    <main className="avg-title-content">
      {props.onReturnToWorkbench&&<button type="button" className="textgame-catalog-back" onClick={returnToWorkbench}><ArrowLeft/>返回制作台</button>}
      <span className="avg-title-kicker">STORYFORGE VISUAL NOVEL</span>
      <h2>{catalogRelease ? '作品详情' : 'AVG 游戏库'}</h2>
      <p>{catalogRelease ? '确认故事、美术与演出规模，然后从标题页正式开演。' : '先选择作品，再进入独立标题页开始或继续；舞台、立绘和对白不会提前挤进游戏目录。'}</p>
      {store.error && <div role="alert" className="avg-alert">{store.error}</div>}
      {catalogRelease ? <section className="textgame-title-page avg-game-title-page" aria-label="AVG 游戏详情">
        <button type="button" className="textgame-catalog-back" onClick={() => setCatalogReleaseId(null)}><ArrowLeft />返回全部游戏</button>
        <div className="textgame-title-art" aria-hidden="true"><BookOpen /><span>VISUAL<br />NOVEL</span></div>
        <div className="textgame-title-copy">
          <small>AVG / 视觉小说 · 当前可玩版本</small>
          <h3>{catalogRelease.manifest?.definition.title ?? catalogRelease.release.label}</h3>
          <p>{catalogRelease.manifest?.definition.description || '一部等待开演的视觉小说。'}</p>
          {catalogRelease.manifest && <div className="textgame-title-stats"><span>{catalogRelease.manifest.narrative.nodes.length} 个场景</span><span>{catalogRelease.manifest.narrative.beats.length} 段对白</span><span>{avgRuntimeStage(catalogRelease.manifest)!.assets.length} 项美术</span><span>{avgRuntimeStage(catalogRelease.manifest)!.cues.length} 个演出指令</span></div>}
          {catalogRelease.error ? <small>{catalogRelease.error}</small> : <div className="textgame-title-actions"><button type="button" className="textgame-start" disabled={!catalogRelease.manifest || store.busy} onClick={() => void run(() => store.start(catalogRelease.release.id!))}><Plus />开始新游戏</button>{store.sessions.find(session => session.productReleaseId === catalogRelease.release.id) && <button type="button" onClick={() => void store.select(store.sessions.find(session => session.productReleaseId === catalogRelease.release.id)!.id!)}><Save />继续上次进度</button>}</div>}
        </div>
      </section> : <>
        <div className="textgame-catalog-heading"><span>全部游戏</span><small>{catalog.length} 部可游玩作品</small></div>
        <section className="textgame-catalog-list" aria-label="AVG 游戏列表">
          {catalog.map(item => <article key={item.release.id}><button type="button" aria-label={`查看游戏：${item.manifest?.definition.title ?? item.release.label}`} onClick={() => setCatalogReleaseId(item.release.id!)}><span className="textgame-catalog-icon"><BookOpen /></span><span className="textgame-catalog-copy"><small>AVG / 视觉小说</small><strong>{item.manifest?.definition.title ?? item.release.label}</strong><p>{item.manifest?.definition.description || '一部等待开演的视觉小说。'}</p>{item.manifest && <i>{item.manifest.narrative.nodes.length} 场景 · {item.manifest.narrative.beats.length} 对白 · {avgRuntimeStage(item.manifest)!.assets.length} 美术 · {avgRuntimeStage(item.manifest)!.cues.length} 演出</i>}</span><span className="textgame-catalog-open">查看详情<ChevronRight /></span></button></article>)}
          {!catalog.length && <div className="avg-title-empty"><BookOpen /><span>还没有可游玩的 AVG</span></div>}
        </section>
        {store.sessions.length > 0 && <section className="avg-title-sessions" aria-label="已有存档"><h3>继续游戏</h3>{store.sessions.map(session => <button onClick={() => void store.select(session.id!)} key={session.id}><span>{session.title}</span><small>继续时间线</small></button>)}</section>}
      </>}
    </main>
  </div>

  return <div className={`avg-player avg-playing ${prefs.reducedMotion ? 'avg-reduced-motion' : ''} ${uiHidden ? 'avg-ui-hidden' : ''}`} data-testid="avg-player">
    <section className="avg-main">
      <header className="avg-toolbar">
        <div className="avg-game-title"><small>VISUAL NOVEL</small><strong>{store.selectedManifest?.definition.title ?? 'AVG / Galgame'}</strong></div>
        <nav aria-label="游玩控制">
          {props.onReturnToWorkbench&&<button title="返回制作台" aria-label="返回制作台" onClick={returnToWorkbench}><ArrowLeft/><span>制作台</span></button>}
          <button className="avg-exit-game" title="退出游戏" aria-label="退出游戏" onClick={leaveToTitle}><ArrowLeft /><span>退出游戏</span></button>
          {inventory.enabled && <button title="物品与证据" aria-label="物品与证据" onClick={() => setPanel(panel === 'inventory' ? null : 'inventory')}><BriefcaseBusiness /><span>物件</span></button>}
          <button title="历史" aria-label="历史" onClick={() => setPanel(panel === 'history' ? null : 'history')}><History /><span>历史</span></button>
          <button title="存读档" aria-label="存读档" onClick={() => setPanel(panel === 'saves' ? null : 'saves')}><Save /><span>存读档</span></button>
          <button title="快速存档" aria-label="快速存档" disabled={store.busy} onClick={() => void quickSave()}><Save /><span>快速存档</span></button>
          <button title="自动播放" aria-label="自动播放" aria-pressed={prefs.auto} onClick={() => setPrefs(value => ({ ...value, auto: !value.auto, fast: false }))}><Play /><span>自动</span></button>
          <button title="快进已读" aria-label="快进已读" aria-pressed={prefs.fast} disabled={!currentBeat || !presentation?.readBeatKeys.includes(currentBeat.beatKey)} onClick={() => setPrefs(value => ({ ...value, fast: !value.fast, auto: false }))}><FastForward /><span>快进</span></button>
          <button title="全屏" aria-label="全屏" onClick={fullscreen}><Maximize2 /><span>全屏</span></button>
          <details className="avg-settings" onToggle={event => setSettingsOpen(event.currentTarget.open)}>
            <summary aria-label="设置" title="设置"><Settings2 /><span>设置</span></summary>
            <div>
              <button onClick={() => setPrefs(value => ({ ...value, images: !value.images }))}>{prefs.images ? <Eye /> : <EyeOff />}图片</button>
              <button onClick={() => setPrefs(value => ({ ...value, muted: !value.muted }))}>{prefs.muted ? <VolumeX /> : <Volume2 />}声音</button>
              <label className="avg-volume">音量<input aria-label="音量" type="range" min="0" max="1" step="0.05" value={prefs.volume} onChange={event => setPrefs(value => ({ ...value, volume: Number(event.target.value) }))} /></label>
              {(['bgmVolume','ambienceVolume','sfxVolume','voiceVolume'] as const).map((key,index) => <label className="avg-volume" key={key}>{['音乐','环境','音效','配音'][index]}<input type="range" min="0" max="1" step="0.05" aria-label={`${['音乐','环境','音效','配音'][index]}音量`} value={prefs[key]} onChange={event => setPrefs(value => ({ ...value, [key]: Number(event.target.value) }))} /></label>)}
              <label className="avg-volume">阅读余量<input type="range" min="0" max="5000" step="100" aria-label="自动阅读余量" value={prefs.autoDelayMs ?? nativeReading?.plan.autoDelayMs ?? 650} onChange={event => setPrefs(value => ({ ...value, autoDelayMs: Number(event.target.value) }))} /></label>
              <button onClick={() => setPrefs(value => ({ ...value, reducedMotion: !value.reducedMotion }))}><Gauge />减少动态</button>
              <button onClick={() => setPrefs(value => ({ ...value, textSpeed: value.textSpeed === 35 ? 80 : 35 }))}>文字速度 {prefs.textSpeed === 35 ? '标准' : '快速'}</button>
              <button onClick={() => setUiHidden(true)}><EyeOff />隐藏界面</button>
              <button onClick={leaveToTitle}><RotateCcw />返回标题</button>
            </div>
          </details>
        </nav>
      </header>
      {store.error && <div role="alert" className="avg-alert">{store.error}</div>}
      <div className="avg-stage" aria-busy={mediaLoading} style={{aspectRatio:(store.selectedManifest && (avgExecutableModule(store.selectedManifest)?.aspectRatio ?? store.selectedManifest.definition.initialVariables.avgAspectRatio)) === "4:3" ? "4 / 3" : "16 / 9"}} data-tone={visualStage?.tone ?? 'normal'} data-transition={visualStage?.lastTransition ?? 'none'} onClick={event => {
        if (event.target instanceof HTMLElement && event.target.closest('button, input, summary, details')) return
        if (currentBeat && !panel) advance()
      }} aria-label={background ? `背景 ${presentation?.assets.find(asset=>asset.assetKey===background)?.name??'场景'}` : '纯文字降级舞台'}>
        <div className={`avg-stage-scene avg-effect-${visualStage?.lastTransition ?? 'none'}`} style={{ transform: `translate(${(visualStage?.camera.x ?? 0) * -2}%, ${(visualStage?.camera.y ?? 0) * -2}%) scale(${visualStage?.camera.scale ?? 1})`, transitionDuration: `${cueDuration}ms` }}>
          {background && <div key={background} className="avg-background" data-asset-key={background}>{mediaUrls[background] ? <img src={mediaUrls[background]} alt={presentation?.assets.find(asset => asset.assetKey === background)?.altText || background} /> : <span>{mediaLoading?'正在读取背景…':'背景暂不可用'}</span>}</div>}
          {prefs.images && visualStage?.cgAssetKey && <div key={visualStage.cgAssetKey} className="avg-cg" data-asset-key={visualStage.cgAssetKey}>{mediaUrls[visualStage.cgAssetKey] ? <img src={mediaUrls[visualStage.cgAssetKey]} alt={presentation?.assets.find(asset => asset.assetKey === visualStage.cgAssetKey)?.altText || visualStage.cgAssetKey} /> : <span>{mediaLoading?'正在读取插图…':'插图暂不可用'}</span>}</div>}
          {prefs.images && visualStage?.actors.map((actor) => {
            const speaking = !!activeSpeakerKey && actor.actorKey === activeSpeakerKey
            const displaySlot = actor.slot
            return <div key={`${actor.actorKey}:${actor.assetKey}`} className={`avg-actor avg-slot-${displaySlot} ${activeSpeakerKey ? speaking ? 'is-speaking' : 'is-listening' : ''}`} style={{ opacity: actor.opacity, transform: `translate(calc(-50% + ${actor.x * 20}px),${actor.y * 20}px) scale(${actor.scale})`, transitionDuration: `${cueDuration}ms` }} aria-label={`角色 ${actor.actorKey}`}>{mediaUrls[actor.assetKey] ? <img src={mediaUrls[actor.assetKey]} alt={presentation?.assets.find(asset => asset.assetKey === actor.assetKey)?.altText || actor.actorKey} /> : <span>{mediaLoading?'正在读取角色图像…':'角色图像暂不可用'}</span>}</div>
          })}
          {prefs.images && visualStage?.overlayAssetKey && <div className="avg-overlay" data-asset-key={visualStage.overlayAssetKey}>{mediaUrls[visualStage.overlayAssetKey] ? <img src={mediaUrls[visualStage.overlayAssetKey]} alt={presentation?.assets.find(asset => asset.assetKey === visualStage.overlayAssetKey)?.altText || visualStage.overlayAssetKey} /> : <span>{mediaLoading?'正在读取叠加图像…':'叠加图像暂不可用'}</span>}</div>}
        </div>
        {visualStage?.mask && <div className="avg-mask" data-mask={visualStage.mask} />}
        {visualStage?.lastTransition === 'flash' && <div key={`flash:${currentBeat?.beatKey}`} className="avg-flash" />}
        {sceneTitleVisible && node?.title && <div key={`scene:${node.key}`} className="avg-scene-title" aria-label={`场景 ${node.title}`}><span>SCENE</span><strong>{node.title}</strong></div>}
        {!prefs.muted && visualStage?.activeAudio.filter(audio => !nativeReading || audio.channel !== 'voice' && (audio.channel !== 'sfx' || activeCueEntries.some(e => e.cue.type === 'play-audio' && e.cue.assetKey === audio.assetKey))).map(audio => mediaUrls[audio.assetKey] ? <StageAudio key={`${audio.channel}:${audio.assetKey}:${nativeReading && audio.channel === 'sfx' ? `${beatIdentity}:${activeCueEntries.filter(e => e.cue.type === 'play-audio' && e.cue.assetKey === audio.assetKey).slice(-1)[0]?.cue.cueKey ?? ''}` : ''}`} src={mediaUrls[audio.assetKey]} loop={audio.loop} channel={audio.channel} paused={pausedTransport} volume={audio.volume * prefs.volume * prefs[`${audio.channel}Volume`]} /> : null)}
        {nativeReading && currentBeat && nativeReading.plan.voices.some(v => v.lineKey === currentBeat.beatKey) && <NativeVoice key={beatIdentity} lineKey={currentBeat.beatKey} visit={narrative!.visitedNodeKeys.length-1} plan={nativeReading.plan} current={nativeReading.current} src={mediaUrls[nativeReading.plan.voices.find(v => v.lineKey === currentBeat.beatKey)!.assetKey]} missing={mediaFailures.some(f => f.assetKey === nativeReading.plan.voices.find(v => v.lineKey === currentBeat.beatKey)!.assetKey)} paused={pausedTransport} muted={prefs.muted} volume={prefs.volume * prefs.voiceVolume} />}

        {(prefs.muted || prefs.reducedMotion) && <div className="avg-stage-status"><span>{prefs.muted ? '静音' : ''}</span><span>{prefs.reducedMotion ? '减少动态' : ''}</span></div>}
        <section key={`dialogue:${currentBeat?.beatKey ?? narrative?.currentNodeKey}`} className={`avg-dialogue ${speakerLabel ? 'is-dialogue' : 'is-narration'} ${!currentBeat ? 'is-choice' : ''}`} aria-live="polite">
          {currentBeat ? <>
            {speakerLabel && <strong className="avg-speaker">{speakerLabel}</strong>}
            <p>{visibleText}<span className={`avg-text-cursor ${textComplete ? 'is-complete' : ''}`} aria-hidden="true" /></p>
            <button className="avg-continue" aria-label="继续" disabled={store.busy || finishingBeat || !cueWaitComplete} onClick={() => advance(!nativeReading)}><SkipForward /><span className="avg-visually-hidden">继续</span></button>
          </> : narrative?.completed ? <div className="avg-ending"><small>ENDING</small><h2>{node?.title}</h2><p>故事已完结。</p></div> : <div className="avg-choices"><small>选择你的行动</small>{choices.map(choice => <button key={choice.choiceKey} disabled={store.busy || !narrative?.availableChoiceKeys?.includes(choice.choiceKey)} onClick={() => void run(() => store.choose(choice.choiceKey))}>{choice.text}</button>)}</div>}
        </section>
        {notice && <div className="avg-notice" role="status">{notice}</div>}
      </div>

      {panel && <div className="avg-panel-backdrop" onMouseDown={() => setPanel(null)}>
        <section className="avg-panel" role="dialog" aria-modal="true" aria-label={panel === 'inventory' ? '物品与证据' : panel === 'history' ? '历史回看' : '存读档'} onMouseDown={event => event.stopPropagation()}>
          <header><div><small>{panel === 'inventory' ? 'INVENTORY & EVIDENCE' : panel === 'history' ? 'DIALOGUE LOG' : 'SAVE & LOAD'}</small><h2>{panel === 'inventory' ? '物品与证据' : panel === 'history' ? '历史回看' : '存档与时间线'}</h2></div><button aria-label="关闭" onClick={() => setPanel(null)}><X /></button></header>
          {panel === 'inventory' ? <InventoryPanel entries={inventory.entries} mediaUrls={prefs.images ? mediaUrls : {}} busy={store.busy} onAction={async action => { await store.actOnItem(action.key, action.target); const plan = store.runtimeState.avgRules?.systemPlan; return (plan?.version === 2 ? plan.inventory.actions.find(a => a.key === action.key)?.feedback : '') || '操作完成' }} /> : panel === 'history' && nativeReading ? <ReadingHistory key={store.selectedSessionId} entries={nativeReading.history} urls={mediaUrls} volume={prefs.muted ? 0 : prefs.volume * prefs.voiceVolume} paused={!foreground}
            failedAssetKeys={mediaFailures.map(failure=>failure.assetKey)} onReplayRequested={assetKey=>setHistoryRequest(previous=>assetKey&&store.selectedSessionId?{sessionId:store.selectedSessionId,assetKey,attempt:(previous?.attempt??0)+1}:null)}/> : panel === 'history' ? <div className="avg-history">{historyBeats.map(beat => { const attributed = splitAttributedText(beat.text); return <article key={beat.beatKey}><strong>{beat.kind === 'dialogue' ? store.speakerNames[beat.speakerKey ?? ''] ?? attributed?.speaker ?? '未知角色' : attributed?.speaker ?? '旁白'}</strong><p>{attributed?.text ?? beat.text}</p></article> })}{historyBeats.length === 0 && <p>还没有可以回看的对白。</p>}</div> : <div className="avg-saves">
            <div className="avg-save-actions"><button disabled={store.busy} onClick={() => void quickSave()}><Save />保存当前进度</button></div>
            <h3>时间线检查点</h3>
            {store.checkpoints.map(checkpoint => <article key={checkpoint.id}><div><strong>{checkpoint.name}</strong><small>事件 #{checkpoint.throughSequence}</small></div><button disabled={store.busy} onClick={() => void run(async () => { await store.forkCheckpoint(checkpoint.id!); setPanel(null) })}><GitBranch />从这里开始新分支</button></article>)}
            {store.checkpoints.length === 0 && <p>尚无检查点；剧情选择仍会自动保存。</p>}
            <h3>其他存档</h3>
            {store.sessions.filter(session => session.id !== store.selectedSessionId).map(session => <article key={session.id}><div><strong>{session.title}</strong><small>独立时间线</small></div><button onClick={() => { void store.select(session.id!); setPanel(null) }}>读取</button></article>)}
            {store.sessions.filter(session => session.id !== store.selectedSessionId).length === 0 && <p>还没有其他存档。</p>}
            <button className="danger" onClick={() => void run(async () => { const confirmed = await dialog.confirm({ title: '删除当前 AVG 存档？', message: '该时间线的事件、检查点和实例级运行都会删除；其它存档及不可变发布保持不变。', confirmText: '删除存档', tone: 'danger' }); if (confirmed) { await store.remove(store.selectedSessionId!); setPanel(null) } })}><Trash2 />删除当前存档</button>
          </div>}
        </section>
      </div>}
      {!prefs.images && <div className="avg-degraded"><ImageOff />图片关闭：纯文字剧情与选择保持可玩。</div>}
      {mediaFailures.length > 0 && <div className="avg-degraded" role="status"><ImageOff />{mediaFailures.length} 项媒资缺失，已使用文字/静默降级。<button type="button" onClick={()=>setMediaRetry(value=>value+1)}>重试资源</button></div>}
      {uiHidden && <button className="avg-ui-restore" onClick={() => setUiHidden(false)} aria-label="显示界面"><Eye />显示界面</button>}
    </section>
  </div>
}
