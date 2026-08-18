import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, BookOpen, ChevronRight, Eye, EyeOff, FastForward, Gauge, GitBranch, History, ImageOff, Maximize2, Play, Plus, RotateCcw, Save, Settings2, SkipForward, Trash2, Volume2, VolumeX, X } from 'lucide-react'
import type { FrozenNarrativeChoice, Project, WorkspaceScope } from '../../lib/types'
import { useAvgGamePlayerStore } from '../../stores/avg-game-player'
import { preloadAvgReleaseMedia } from '../../lib/avg/media'
import { applyAvgCue } from '../../lib/avg/runtime'
import { currentPlayerReleases } from '../../lib/text-game/player-library'
import { useDialog } from '../shared/Dialog'
import './player-roadshow.css'

interface Preferences { muted: boolean; reducedMotion: boolean; images: boolean; auto: boolean; fast: boolean; textSpeed: number; volume: number }
type PlayerPanel = 'history' | 'saves' | null
const DEFAULTS: Preferences = { muted: false, reducedMotion: false, images: true, auto: false, fast: false, textSpeed: 35, volume: .8 }
const CUE_PHASES = ['before', 'during', 'after']

function splitAttributedText(text: string): { speaker: string; text: string } | null {
  const match = text.match(/^【([^】]+)】\s*([\s\S]*)$/)
  return match ? { speaker: match[1].trim(), text: match[2].trimStart() } : null
}

export default function AvgGamePlayer(props: { project: Project; scope: WorkspaceScope; worldGroupId: number | null }) {
  const store = useAvgGamePlayerStore()
  const dialog = useDialog()
  const [prefs, setPrefs] = useState<Preferences>(() => ({ ...DEFAULTS, reducedMotion: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches }))
  const [panel, setPanel] = useState<PlayerPanel>(null)
  const [uiHidden, setUiHidden] = useState(false)
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({})
  const [mediaFailures, setMediaFailures] = useState<Array<{ assetKey: string; reason: string }>>([])
  const [visibleCharacters, setVisibleCharacters] = useState(0)
  const [sceneTitleVisible, setSceneTitleVisible] = useState(false)
  const [notice, setNotice] = useState('')
  const [catalogReleaseId, setCatalogReleaseId] = useState<number | null>(null)

  useEffect(() => { setCatalogReleaseId(null); void store.load(props.scope, props.worldGroupId, true) }, [props.scope.projectId, props.scope.worldId, props.scope.workId, props.worldGroupId]) // eslint-disable-line react-hooks/exhaustive-deps
  const catalog = useMemo(() => currentPlayerReleases(store.releases), [store.releases])
  const catalogRelease = catalog.find(item => item.release.id === catalogReleaseId) ?? null
  const mediaCacheKey = `${store.selectedSessionId ?? 'title'}:${store.selectedManifest?.presentation.assets.map(asset => `${asset.assetKey}@${asset.version}:${asset.contentHash}`).join('|') ?? ''}`
  useEffect(() => {
    let cancelled = false
    if (!store.selectedManifest) { setMediaUrls({}); setMediaFailures([]); return }
    void preloadAvgReleaseMedia({ scope: props.scope, assets: store.selectedManifest.presentation.assets }).then(result => {
      if (!cancelled) {
        setMediaUrls(result.urls)
        setMediaFailures(result.failures)
        void store.recordMediaFailures(result.failures).catch(() => undefined)
      }
    })
    return () => { cancelled = true }
  }, [mediaCacheKey, props.scope.projectId, props.scope.worldId, props.scope.workId]) // eslint-disable-line react-hooks/exhaustive-deps

  const narrative = store.runtimeState.narrative
  const presentation = store.runtimeState.presentation
  const node = narrative?.nodes.find(item => item.key === narrative.currentNodeKey)
  const beats = useMemo(() => (narrative?.beats ?? []).filter(beat => beat.nodeKey === narrative?.currentNodeKey).sort((a, b) => a.order - b.order), [narrative])
  const reachedBeatKey = presentation?.currentNodeKey === narrative?.currentNodeKey ? presentation?.currentBeatKey : null
  const reachedIndex = reachedBeatKey ? beats.findIndex(beat => beat.beatKey === reachedBeatKey) : -1
  const currentBeat = beats[reachedIndex + 1] ?? null
  const choices = [...new Set(narrative?.visibleChoiceKeys ?? [])].map(key => narrative?.choices?.find(item => item.choiceKey === key)).filter((item): item is FrozenNarrativeChoice => !!item)
  const stage = presentation?.stage
  const visualStage = useMemo(() => {
    if (!stage || !presentation || !currentBeat) return stage
    return presentation.cues.filter(cue => cue.beatKey === currentBeat.beatKey)
      .sort((a, b) => CUE_PHASES.indexOf(a.phase) - CUE_PHASES.indexOf(b.phase) || a.order - b.order || a.cueKey.localeCompare(b.cueKey))
      .reduce((next, cue) => applyAvgCue(next, cue, presentation.assets, presentation.snapshots), stage)
  }, [stage, presentation, currentBeat])
  const currentCues = presentation?.cues.filter(cue => cue.beatKey === currentBeat?.beatKey) ?? []
  const cueDuration = Math.max(240, ...currentCues.map(cue => cue.durationMs))
  const attributedText = currentBeat ? splitAttributedText(currentBeat.text) : null
  const dialogueText = attributedText?.text ?? currentBeat?.text ?? ''
  const speakerLabel = currentBeat?.kind === 'dialogue'
    ? store.speakerNames[currentBeat.speakerKey ?? ''] ?? '未知角色'
    : attributedText?.speaker ?? null
  const activeSpeakerKey = currentBeat?.kind === 'dialogue'
    ? currentBeat.speakerKey
    : attributedText ? Object.entries(store.speakerNames).find(([, name]) => name === attributedText.speaker)?.[0] ?? null : null
  const background = prefs.images && visualStage?.backgroundAssetKey ? visualStage.backgroundAssetKey : null
  const textComplete = !currentBeat || visibleCharacters >= dialogueText.length
  const visibleText = dialogueText.slice(0, visibleCharacters)
  const historyBeats = (narrative?.beats ?? []).filter(beat => presentation?.readBeatKeys.includes(beat.beatKey))
  const run = async (fn: () => Promise<unknown>) => { try { await fn() } catch { /* store exposes error */ } }

  useEffect(() => {
    if (!currentBeat) { setVisibleCharacters(0); return }
    if (prefs.reducedMotion) { setVisibleCharacters(dialogueText.length); return }
    setVisibleCharacters(0)
    const interval = window.setInterval(() => setVisibleCharacters(value => {
      if (value >= dialogueText.length) { window.clearInterval(interval); return value }
      return Math.min(dialogueText.length, value + 1)
    }), Math.max(12, Math.round(1000 / prefs.textSpeed)))
    return () => window.clearInterval(interval)
  }, [currentBeat, dialogueText, prefs.textSpeed, prefs.reducedMotion])

  useEffect(() => {
    if (!node?.key) return
    setSceneTitleVisible(true)
    const timer = window.setTimeout(() => setSceneTitleVisible(false), prefs.reducedMotion ? 900 : 1800)
    return () => window.clearTimeout(timer)
  }, [node?.key, prefs.reducedMotion])

  const advance = (force = false) => {
    if (!currentBeat || store.busy) return
    if (!force && !textComplete) { setVisibleCharacters(dialogueText.length); return }
    void run(() => store.reachBeat(currentBeat.beatKey))
  }
  useEffect(() => {
    if (!prefs.auto || !currentBeat || store.busy || !textComplete) return
    const timer = window.setTimeout(() => advance(true), 650)
    return () => window.clearTimeout(timer)
  }, [prefs.auto, currentBeat?.beatKey, store.busy, textComplete]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!prefs.fast || !currentBeat || store.busy) return
    if (!presentation?.readBeatKeys.includes(currentBeat.beatKey)) { setPrefs(value => ({ ...value, fast: false })); return }
    const timer = window.setTimeout(() => advance(true), 80)
    return () => window.clearTimeout(timer)
  }, [prefs.fast, currentBeat?.beatKey, presentation?.readBeatKeys, store.busy]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!store.selectedSessionId || store.busy || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      if (event.key === 'Escape') {
        if (panel) setPanel(null)
        else if (uiHidden) setUiHidden(false)
        return
      }
      if ((event.key === ' ' || event.key === 'Enter') && currentBeat && !panel) { event.preventDefault(); advance() }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [store.selectedSessionId, store.busy, currentBeat?.beatKey, textComplete, panel, uiHidden]) // eslint-disable-line react-hooks/exhaustive-deps

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

  if (!store.selectedSessionId) return <div className="avg-player avg-title-screen" data-testid="avg-player">
    <div className="avg-title-atmosphere" aria-hidden="true" />
    <main className="avg-title-content">
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
          {catalogRelease.manifest && <div className="textgame-title-stats"><span>{catalogRelease.manifest.narrative.nodes.length} 个场景</span><span>{catalogRelease.manifest.narrative.beats.length} 段对白</span><span>{catalogRelease.manifest.presentation.assets.length} 项美术</span><span>{catalogRelease.manifest.presentation.cues.length} 个演出指令</span></div>}
          {catalogRelease.error ? <small>{catalogRelease.error}</small> : <div className="textgame-title-actions"><button type="button" className="textgame-start" disabled={!catalogRelease.manifest || store.busy} onClick={() => void run(() => store.start(catalogRelease.release.id!))}><Plus />开始新游戏</button>{store.sessions.find(session => session.gameReleaseId === catalogRelease.release.id) && <button type="button" onClick={() => void store.select(store.sessions.find(session => session.gameReleaseId === catalogRelease.release.id)!.id!)}><Save />继续上次进度</button>}</div>}
        </div>
      </section> : <>
        <div className="textgame-catalog-heading"><span>全部游戏</span><small>{catalog.length} 部可游玩作品</small></div>
        <section className="textgame-catalog-list" aria-label="AVG 游戏列表">
          {catalog.map(item => <article key={item.release.id}><button type="button" aria-label={`查看游戏：${item.manifest?.definition.title ?? item.release.label}`} onClick={() => setCatalogReleaseId(item.release.id!)}><span className="textgame-catalog-icon"><BookOpen /></span><span className="textgame-catalog-copy"><small>AVG / 视觉小说</small><strong>{item.manifest?.definition.title ?? item.release.label}</strong><p>{item.manifest?.definition.description || '一部等待开演的视觉小说。'}</p>{item.manifest && <i>{item.manifest.narrative.nodes.length} 场景 · {item.manifest.narrative.beats.length} 对白 · {item.manifest.presentation.assets.length} 美术 · {item.manifest.presentation.cues.length} 演出</i>}</span><span className="textgame-catalog-open">查看详情<ChevronRight /></span></button></article>)}
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
          <button className="avg-exit-game" title="退出游戏" aria-label="退出游戏" onClick={leaveToTitle}><ArrowLeft /><span>退出游戏</span></button>
          <button title="历史" aria-label="历史" onClick={() => setPanel(panel === 'history' ? null : 'history')}><History /><span>历史</span></button>
          <button title="存读档" aria-label="存读档" onClick={() => setPanel(panel === 'saves' ? null : 'saves')}><Save /><span>存读档</span></button>
          <button title="快速存档" aria-label="快速存档" disabled={store.busy} onClick={() => void quickSave()}><Save /><span>快速存档</span></button>
          <button title="自动播放" aria-label="自动播放" aria-pressed={prefs.auto} onClick={() => setPrefs(value => ({ ...value, auto: !value.auto, fast: false }))}><Play /><span>自动</span></button>
          <button title="快进已读" aria-label="快进已读" aria-pressed={prefs.fast} disabled={!currentBeat || !presentation?.readBeatKeys.includes(currentBeat.beatKey)} onClick={() => setPrefs(value => ({ ...value, fast: !value.fast, auto: false }))}><FastForward /><span>快进</span></button>
          <button title="全屏" aria-label="全屏" onClick={fullscreen}><Maximize2 /><span>全屏</span></button>
          <details className="avg-settings">
            <summary aria-label="设置" title="设置"><Settings2 /><span>设置</span></summary>
            <div>
              <button onClick={() => setPrefs(value => ({ ...value, images: !value.images }))}>{prefs.images ? <Eye /> : <EyeOff />}图片</button>
              <button onClick={() => setPrefs(value => ({ ...value, muted: !value.muted }))}>{prefs.muted ? <VolumeX /> : <Volume2 />}声音</button>
              <label className="avg-volume">音量<input aria-label="音量" type="range" min="0" max="1" step="0.05" value={prefs.volume} onChange={event => setPrefs(value => ({ ...value, volume: Number(event.target.value) }))} /></label>
              <button onClick={() => setPrefs(value => ({ ...value, reducedMotion: !value.reducedMotion }))}><Gauge />减少动态</button>
              <button onClick={() => setPrefs(value => ({ ...value, textSpeed: value.textSpeed === 35 ? 80 : 35 }))}>文字速度 {prefs.textSpeed === 35 ? '标准' : '快速'}</button>
              <button onClick={() => setUiHidden(true)}><EyeOff />隐藏界面</button>
              <button onClick={leaveToTitle}><RotateCcw />返回标题</button>
            </div>
          </details>
        </nav>
      </header>
      {store.error && <div role="alert" className="avg-alert">{store.error}</div>}
      <div className="avg-stage" data-tone={visualStage?.tone ?? 'normal'} data-transition={visualStage?.lastTransition ?? 'none'} onClick={event => {
        if (event.target instanceof HTMLElement && event.target.closest('button, input, summary, details')) return
        if (currentBeat && !panel) advance()
      }} aria-label={background ? `背景 ${background}` : '纯文字降级舞台'}>
        <div className={`avg-stage-scene avg-effect-${visualStage?.lastTransition ?? 'none'}`} style={{ transform: `translate(${(visualStage?.camera.x ?? 0) * -2}%, ${(visualStage?.camera.y ?? 0) * -2}%) scale(${visualStage?.camera.scale ?? 1})`, transitionDuration: `${cueDuration}ms` }}>
          {background && <div key={background} className="avg-background" data-asset-key={background}>{mediaUrls[background] ? <img src={mediaUrls[background]} alt={presentation?.assets.find(asset => asset.assetKey === background)?.altText || background} /> : <span>{background}</span>}</div>}
          {prefs.images && visualStage?.cgAssetKey && <div key={visualStage.cgAssetKey} className="avg-cg" data-asset-key={visualStage.cgAssetKey}>{mediaUrls[visualStage.cgAssetKey] ? <img src={mediaUrls[visualStage.cgAssetKey]} alt={presentation?.assets.find(asset => asset.assetKey === visualStage.cgAssetKey)?.altText || visualStage.cgAssetKey} /> : visualStage.cgAssetKey}</div>}
          {prefs.images && visualStage?.actors.map((actor, index) => {
            const speaking = !!activeSpeakerKey && actor.actorKey === activeSpeakerKey
            const displaySlot = visualStage.actors.length === 2 ? index === 0 ? 'left' : 'right' : actor.slot
            return <div key={`${actor.actorKey}:${actor.assetKey}`} className={`avg-actor avg-slot-${displaySlot} ${activeSpeakerKey ? speaking ? 'is-speaking' : 'is-listening' : ''}`} style={{ opacity: actor.opacity, transform: `translate(calc(-50% + ${actor.x * 20}px),${actor.y * 20}px) scale(${actor.scale})`, transitionDuration: `${cueDuration}ms` }} aria-label={`角色 ${actor.actorKey}`}>{mediaUrls[actor.assetKey] ? <img src={mediaUrls[actor.assetKey]} alt={presentation?.assets.find(asset => asset.assetKey === actor.assetKey)?.altText || actor.actorKey} /> : actor.assetKey}</div>
          })}
          {prefs.images && visualStage?.overlayAssetKey && <div className="avg-overlay" data-asset-key={visualStage.overlayAssetKey}>{mediaUrls[visualStage.overlayAssetKey] ? <img src={mediaUrls[visualStage.overlayAssetKey]} alt={presentation?.assets.find(asset => asset.assetKey === visualStage.overlayAssetKey)?.altText || visualStage.overlayAssetKey} /> : visualStage.overlayAssetKey}</div>}
        </div>
        {visualStage?.mask && <div className="avg-mask" data-mask={visualStage.mask} />}
        {visualStage?.lastTransition === 'flash' && <div key={`flash:${currentBeat?.beatKey}`} className="avg-flash" />}
        {sceneTitleVisible && node?.title && <div key={`scene:${node.key}`} className="avg-scene-title" aria-label={`场景 ${node.title}`}><span>SCENE</span><strong>{node.title}</strong></div>}
        {!prefs.muted && visualStage?.activeAudio.map(audio => mediaUrls[audio.assetKey] ? <audio key={`${audio.channel}:${audio.assetKey}`} src={mediaUrls[audio.assetKey]} autoPlay loop={audio.loop} data-channel={audio.channel} onLoadedMetadata={event => { event.currentTarget.volume = Math.min(1, audio.volume * prefs.volume) }} /> : null)}
        {(prefs.muted || prefs.reducedMotion) && <div className="avg-stage-status"><span>{prefs.muted ? '静音' : ''}</span><span>{prefs.reducedMotion ? '减少动态' : ''}</span></div>}
        <section key={`dialogue:${currentBeat?.beatKey ?? narrative?.currentNodeKey}`} className={`avg-dialogue ${speakerLabel ? 'is-dialogue' : 'is-narration'} ${!currentBeat ? 'is-choice' : ''}`} aria-live="polite">
          {currentBeat ? <>
            {speakerLabel && <strong className="avg-speaker">{speakerLabel}</strong>}
            <p>{visibleText}<span className={`avg-text-cursor ${textComplete ? 'is-complete' : ''}`} aria-hidden="true" /></p>
            <button className="avg-continue" aria-label="继续" disabled={store.busy} onClick={() => advance(true)}><SkipForward /><span className="avg-visually-hidden">继续</span></button>
          </> : narrative?.completed ? <div className="avg-ending"><small>ENDING</small><h2>{node?.title}</h2><p>故事已完结。</p></div> : <div className="avg-choices"><small>选择你的行动</small>{choices.map(choice => <button key={choice.choiceKey} disabled={store.busy || !narrative?.availableChoiceKeys?.includes(choice.choiceKey)} onClick={() => void run(() => store.choose(choice.choiceKey))}>{choice.text}</button>)}</div>}
        </section>
        {notice && <div className="avg-notice" role="status">{notice}</div>}
      </div>

      {panel && <div className="avg-panel-backdrop" onMouseDown={() => setPanel(null)}>
        <section className="avg-panel" role="dialog" aria-modal="true" aria-label={panel === 'history' ? '历史回看' : '存读档'} onMouseDown={event => event.stopPropagation()}>
          <header><div><small>{panel === 'history' ? 'DIALOGUE LOG' : 'SAVE & LOAD'}</small><h2>{panel === 'history' ? '历史回看' : '存档与时间线'}</h2></div><button aria-label="关闭" onClick={() => setPanel(null)}><X /></button></header>
          {panel === 'history' ? <div className="avg-history">{historyBeats.map(beat => { const attributed = splitAttributedText(beat.text); return <article key={beat.beatKey}><strong>{beat.kind === 'dialogue' ? store.speakerNames[beat.speakerKey ?? ''] ?? '未知角色' : attributed?.speaker ?? '旁白'}</strong><p>{attributed?.text ?? beat.text}</p></article> })}{historyBeats.length === 0 && <p>还没有可以回看的对白。</p>}</div> : <div className="avg-saves">
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
      {mediaFailures.length > 0 && <div className="avg-degraded" role="status"><ImageOff />{mediaFailures.length} 项媒资缺失，已使用文字/静默降级。</div>}
      {uiHidden && <button className="avg-ui-restore" onClick={() => setUiHidden(false)} aria-label="显示界面"><Eye />显示界面</button>}
    </section>
  </div>
}
