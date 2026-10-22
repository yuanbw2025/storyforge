import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { readTtrpgOpenAudioDeskV1, prepareTtrpgOpenAudioUploadV1, prepareTtrpgOpenRetainedAudioV1, confirmTtrpgOpenAudioReviewV1,
  readTtrpgOpenAudioClipV1, readTtrpgOpenAudioTransitionsV1, ttrpgOpenAudioClipMatchesViewV1, type TtrpgOpenAudioDeskInputV1, type TtrpgOpenAudioDeskV1, type TtrpgOpenAudioReviewV1 } from '../../lib/ttrpg/open-audio-service'
import type { TtrpgAudioAudienceV1, TtrpgAudioChannelV1 } from '../../lib/ttrpg/open-audio-runtime'
import type { TtrpgOpenAudioRequestV1 } from '../../lib/ttrpg/open-audio-contract'
import TtrpgOpenAudioPlayer, { type TtrpgLocalAudioStopV1 } from './TtrpgOpenAudioPlayer'
import { rememberTtrpgAudioPositionV1 } from '../../lib/ttrpg/open-audio-playback'
import { createTtrpgAudioTransitionPlaybackV1 } from '../../lib/ttrpg/open-audio-transition-playback'
import TtrpgOpenVoiceStudio from './TtrpgOpenVoiceStudio'

const channels: Record<TtrpgAudioChannelV1, string> = { music: '背景音乐', ambience: '环境声', sfx: '音效', voice: '配音' }
const audiences: Record<TtrpgAudioAudienceV1, string> = { public: '公开', party: '本次全队', private: '指定角色', 'gm-only': '仅主持' }
function duration(file: File, signal: AbortSignal): Promise<number | null> {
  return new Promise(resolve => {
    const element = document.createElement('audio'), url = URL.createObjectURL(file)
    const finish = (value: number | null) => { clearTimeout(timer); element.onloadedmetadata = null; element.onerror = null; signal.removeEventListener('abort', abort); element.removeAttribute('src'); element.load(); URL.revokeObjectURL(url); resolve(value) }
    const abort = () => finish(null), timer = setTimeout(() => finish(null), 10000)
    element.onloadedmetadata = () => finish(Number.isFinite(element.duration) && element.duration > 0 ? Math.round(element.duration * 1000) : null)
    element.onerror = () => finish(null); signal.addEventListener('abort', abort, { once: true })
    element.preload = 'metadata'; element.src = url
  })
}
export default function TtrpgOpenAudioPanel(props: {
  input: TtrpgOpenAudioDeskInputV1; sequence: number; paused: boolean; busy: boolean; onChanged: () => Promise<void>
}) {
  const { projectId, worldId, workId } = props.input.scope, { sessionId, viewerKey } = props.input
  const identity = `${projectId}:${worldId}:${workId}:${sessionId}:${viewerKey}`, currentIdentity = useRef({ identity })
  // A return to the same seat is still a new visit. Earlier promises must not
  // restore its cleared review or unlock a new visit's operation.
  if (currentIdentity.current.identity !== identity) currentIdentity.current = { identity }
  const [page, setPage] = useState<{ identity: string; value: TtrpgOpenAudioDeskV1 } | null>(null), [enabled, setEnabled] = useState(false)
  const [working, setWorking] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [review, setReview] = useState<{ identity: string; value: TtrpgOpenAudioReviewV1 } | null>(null), [agreed, setAgreed] = useState(false)
  const [channel, setChannel] = useState<TtrpgAudioChannelV1>('music'), [audience, setAudience] = useState<TtrpgAudioAudienceV1>('party'), [actor, setActor] = useState('')
  const [cause, setCause] = useState(''), [file, setFile] = useState<File | null>(null), [durationMs, setDurationMs] = useState<number | null>(null)
  const [source, setSource] = useState(''), [license, setLicense] = useState(''), [voiceChecked, setVoiceChecked] = useState(false), [fadeMs, setFadeMs] = useState(0)
  const [follow, setFollow] = useState(false), [stopFadeMs, setStopFadeMs] = useState(0)
  const [urls, setUrls] = useState<Record<string, string>>({}), [clipFailures, setClipFailures] = useState<Record<string, boolean>>({}), [reload, setReload] = useState(0)
  const [retained, setRetained] = useState<Array<{ visit: typeof currentIdentity.current; track: TtrpgOpenAudioDeskV1['tracks'][number]; url: string }>>([])
  const playbackOrder = useRef<string[]>([])
  const voiceStop = useRef<()=>void>(()=>undefined)
  const registerVoiceStop = useCallback((handle:(()=>void)|null)=>{voiceStop.current=handle??(()=>undefined)},[])
  const revision = useRef(0), live = useRef(false), operationLocked = useRef(false), clips = useRef(new Map<string, { url: string; blob: Blob }>()), elements = useRef(new Map<string, TtrpgLocalAudioStopV1>()), bookmarks = useRef(new Map<string, number>()), fileRead = useRef<AbortController | null>(null)
  const lastView = useRef<{ visit: typeof currentIdentity.current; value: TtrpgOpenAudioDeskV1 } | null>(null)
  const localChoice = useRef({ visit: currentIdentity.current, enabled: false, follow: false })
  if (localChoice.current.visit !== currentIdentity.current) localChoice.current = { visit: currentIdentity.current, enabled: false, follow: false }
  const transitionRef = useRef<ReturnType<typeof createTtrpgAudioTransitionPlaybackV1> | null>(null)
  if (!transitionRef.current) transitionRef.current = createTtrpgAudioTransitionPlaybackV1()
  const transitions = transitionRef.current
  const input = useCallback(() => ({ scope: { projectId, worldId, workId }, sessionId, viewerKey }), [projectId, worldId, workId, sessionId, viewerKey])
  const visit = currentIdentity.current
  const remember = useCallback((key: string, seconds: number) => { if (currentIdentity.current === visit) rememberTtrpgAudioPositionV1(bookmarks.current, key, seconds) }, [visit])
  const releaseLocal = useCallback(() => {
    voiceStop.current()
    transitions.cancel()
    for (const stop of elements.current.values()) stop()
    for (const clip of clips.current.values()) URL.revokeObjectURL(clip.url)
    clips.current.clear()
  }, [transitions])
  const stopLocal = useCallback(() => { releaseLocal(); setRetained([]); setUrls({}) }, [releaseLocal])
  const register = useCallback((key: string, stop: TtrpgLocalAudioStopV1 | null) => {
    if (!stop) { elements.current.delete(key); return }
    elements.current.set(key, stop)
    // StrictMode's transient first mount must not start a play attempt.
    queueMicrotask(() => {
      if (!live.current || elements.current.get(key) !== stop || !localChoice.current.enabled || !localChoice.current.follow) return
      const page = lastView.current, clip = clips.current.get(key)
      if (page?.visit === currentIdentity.current && clip && stop.element.getAttribute('src') === clip.url && ttrpgOpenAudioClipMatchesViewV1(page.value, key, clip.blob)) transitions.attach(key, stop)
      else transitions.cancel()
    })
  }, [transitions])
  const refresh = useCallback(async () => {
    const owner = currentIdentity.current
    if (owner.identity !== identity) return
    const token = ++revision.current
    const current = () => live.current && revision.current === token && currentIdentity.current === owner
    const deadline = performance.now() + 3000
    const guard = localChoice.current.enabled && [...elements.current.values()].some(handle => handle.isPlaying()) ? setTimeout(() => {
      if (!current()) return
      localChoice.current.enabled = false; stopLocal(); setEnabled(false); setNotice('音轨读取较慢，本机音频已停止；可重新开启。')
    }, 3000) : null
    try {
      const value = await readTtrpgOpenAudioDeskV1(input())
      if (!current()) return
      const before = lastView.current?.visit === owner ? lastView.current.value : null
      // Duplicate same-head reads are not new playback controls. Only a newly
      // observed head invalidates an earlier tail; safety/read failures stop below.
      if (!before || before.sequence !== value.sequence) transitions.cancel()
      if (before && before.authorizationRevision !== value.authorizationRevision) {
        localChoice.current.enabled = false; stopLocal(); setEnabled(false)
      } else if (before && localChoice.current.enabled && !value.paused && before.tracks.map(row => row.clipKey).join('|') !== value.tracks.map(row => row.clipKey).join('|')) {
        const playingClips = before.tracks.flatMap(track => {
          const clip = clips.current.get(track.clipKey), handle = elements.current.get(track.clipKey)
          return clip && handle?.isPlaying() && handle.element.getAttribute('src') === clip.url ? [{ clipKey: track.clipKey, blob: clip.blob }] : []
        })
        if (playingClips.length) {
          try {
            const evidence = await readTtrpgOpenAudioTransitionsV1({ ...input(), before, after: value, playingClips })
            if (!current()) return
            if (localChoice.current.enabled) for (const plan of evidence.transitions) {
              const clip = clips.current.get(plan.fromClipKey), handle = elements.current.get(plan.fromClipKey)
              const track = before.tracks.find(row => row.clipKey === plan.fromClipKey)
              if (!clip || !handle || !track || handle.element.getAttribute('src') !== clip.url) continue
              const accepted = transitions.begin(plan, handle, { follow: localChoice.current.follow, deadline,
                release: () => { URL.revokeObjectURL(clip.url); if (live.current && currentIdentity.current === owner) setRetained(rows => rows.filter(row => row.visit !== owner || row.track.clipKey !== plan.fromClipKey)) },
                fallback: () => { if (live.current && currentIdentity.current === owner) setNotice('旧音轨已停止，新音轨请按播放继续。') } })
              if (accepted) {
                clips.current.delete(plan.fromClipKey)
                if (transitions.retains(plan.fromClipKey)) setRetained(rows => [...rows.filter(row => row.track.clipKey !== plan.fromClipKey), { visit: owner, track, url: clip.url }])
              }
            }
          } catch { /* Failed/stale evidence means immediate old-node disposal at the view change. */ }
        }
      }
      if (current()) { lastView.current = { visit: owner, value }; setPage({ identity, value }); setError('') }
    } catch {
      if (current()) { localChoice.current.enabled = false; lastView.current = null; setPage(null); setEnabled(false); stopLocal(); setError('音频资料暂不可读取，请重新读取或核对原存档。') }
    } finally { if (guard !== null) clearTimeout(guard) }
  }, [identity, input, stopLocal, transitions])
  useLayoutEffect(() => { live.current = true; return () => { live.current = false; localChoice.current.enabled = false; releaseLocal() } }, [identity, releaseLocal])
  useEffect(() => {
    live.current = true; operationLocked.current = false
    setPage(null); setEnabled(false); setReview(null); setAgreed(false); setWorking(false); setError(''); setNotice('')
    setFile(null); setDurationMs(null); setSource(''); setLicense(''); setCause(''); setActor(''); setChannel('music'); setAudience('party'); setVoiceChecked(false); setFadeMs(0); setStopFadeMs(0); setFollow(false); bookmarks.current.clear(); lastView.current = null
    localChoice.current.enabled = false; localChoice.current.follow = false
    fileRead.current?.abort(); stopLocal()
    return () => { live.current = false; fileRead.current?.abort(); releaseLocal() }
  }, [identity, releaseLocal, stopLocal])
  useEffect(() => { void refresh() }, [props.sequence, refresh])
  const view = page?.identity === identity ? page.value : null, pending = review?.identity === identity ? review.value : null
  const currentTracks = useRef<TtrpgOpenAudioDeskV1['tracks']>([])
  currentTracks.current = view?.tracks ?? []
  const silenced = props.paused || view?.paused !== false, trackKey = view?.tracks.map(track => track.clipKey).join('|') ?? ''
  useLayoutEffect(() => { if (silenced) { localChoice.current.enabled = false; stopLocal(); setEnabled(false) } }, [silenced, stopLocal])
  useEffect(() => {
    let cancelled = false
    const owner = currentIdentity.current
    const tracks = currentTracks.current
    if (!enabled || silenced) { stopLocal(); return }
    const active = new Set(tracks.map(track => track.clipKey))
    for (const [key, clip] of clips.current) if (!active.has(key)) { elements.current.get(key)?.(); URL.revokeObjectURL(clip.url); clips.current.delete(key) }
    const cachedUrls = () => Object.fromEntries([...clips.current].map(([key, clip]) => [key, clip.url]))
    setUrls(cachedUrls()); setClipFailures({})
    for (const track of tracks) if (!clips.current.has(track.clipKey)) {
      void readTtrpgOpenAudioClipV1({ ...input(), sourceRef: track.sourceRef, expectedClipKey: track.clipKey }).then(result => {
        if (cancelled || !live.current || !localChoice.current.enabled || currentIdentity.current !== owner) return
        const url = URL.createObjectURL(result.blob); clips.current.set(track.clipKey, { url, blob: result.blob }); setUrls(cachedUrls())
      }).catch(() => { if (!cancelled && live.current && localChoice.current.enabled && currentIdentity.current === owner) setClipFailures(old => ({ ...old, [track.clipKey]: true })) })
    }
    return () => { cancelled = true }
    // Sequence-only game updates keep unchanged authorized tracks playing.
  }, [identity, enabled, silenced, trackKey, reload, input, stopLocal])
  const resetReview = () => { setReview(null); setAgreed(false); setError(''); setNotice('') }
  async function perform(job: () => Promise<void>) {
    if (!live.current || operationLocked.current) return
    operationLocked.current = true
    const owner = currentIdentity.current
    setWorking(true); setError(''); setNotice('')
    try { await job() } catch { if (live.current && currentIdentity.current === owner) setError('音频操作未完成。请核对原文件、接收者和当前进度；已保存的规则结果不受影响。') }
    finally { if (live.current && currentIdentity.current === owner) { operationLocked.current = false; setWorking(false) } }
  }
  const selectedCause = view?.causes.find(row => JSON.stringify(row.sourceRef) === cause)
  const prepareFile = () => perform(async () => {
    if (!file || !selectedCause) return
    const owner = currentIdentity.current, submissionKey = `audio.upload.${crypto.randomUUID()}`
    const request: TtrpgOpenAudioRequestV1 = { action: 'play', channel, audience, privateActorKey: audience === 'private' ? actor : null,
      narrationSourceRef: selectedCause.sourceRef, fade: channel === 'voice' ? 0 : fadeMs, media: { kind: 'upload', submissionKey }, voiceTimeline: channel === 'voice' && durationMs ? {
        granularity: 'char', speakerVoiceId: 'voice.uploaded', styleKey: null, styleDegree: null,
        marks: [{ textOffset: 0, textLength: selectedCause.text.length, startMs: 0, durationMs }] } : null }
    const value = await prepareTtrpgOpenAudioUploadV1({ ...input(), request, file, name: file.name, source, license, durationMs, decision: 'prepare-this-file-for-reviewed-audio' })
    if (live.current && currentIdentity.current === owner) { setReview({ identity, value }); setAgreed(false) }
  })
  const prepareSaved = (sourceRef: TtrpgOpenAudioDeskV1['tracks'][number]['sourceRef'], action: 'play' | 'stop') => perform(async () => {
    const owner = currentIdentity.current, value = await prepareTtrpgOpenRetainedAudioV1({ ...input(), sourceRef, action,
      ...(action === 'stop' ? { fade: view?.tracks.find(row => JSON.stringify(row.sourceRef) === JSON.stringify(sourceRef))?.channel === 'voice' ? 0 : stopFadeMs } : {}), submissionKey: `audio.${action}.${crypto.randomUUID()}` })
    if (live.current && currentIdentity.current === owner) { setReview({ identity, value }); setAgreed(false) }
  })
  const displayed = new Map<string, { track: TtrpgOpenAudioDeskV1['tracks'][number]; url: string | undefined; retiring: boolean }>()
  if (enabled && !silenced) for (const row of retained) if (row.visit === visit) displayed.set(row.track.clipKey, { track: row.track, url: row.url, retiring: true })
  for (const track of view?.tracks ?? []) displayed.set(track.clipKey, { track, url: urls[track.clipKey], retiring: false })
  // Preserve relative DOM order of every existing media node. Reordering a
  // connected audio node can interrupt native playback just like removing it.
  const order = enabled && !silenced ? playbackOrder.current.filter(key => displayed.has(key)) : []
  for (const key of displayed.keys()) if (!order.includes(key)) order.push(key)
  playbackOrder.current = order
  return <section className="sf-open-audio" data-testid="ttrpg-open-audio-panel">
    <h2>本机音频</h2>
    <p>音频可随时静音。刷新或交接身份后默认关闭，本局的文字与规则进度会保留。</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div className="sf-open-audio-actions"><button onClick={() => { localChoice.current.enabled = false; transitions.cancel(); stopLocal(); setEnabled(false); setNotice('本机音频已关闭。') }}>本机静音</button>
      <button disabled={!view || silenced || enabled} onClick={() => { localChoice.current.enabled = true; setClipFailures({}); setEnabled(true) }}>开启本机音频</button>
      <button disabled={working} onClick={() => void refresh()}>重新读取音轨</button></div>
    <label><input type="checkbox" aria-label="跟随背景与环境音轨" disabled={!enabled || silenced} checked={follow && localChoice.current.follow} onChange={event => {
      localChoice.current.follow = event.target.checked; setFollow(event.target.checked); if (!event.target.checked) transitions.cancel()
    }} />跟随正在播放的背景音乐与环境声切换（仅本机本次身份）</label>
    <p>跟随需先手动播放一轨；切换与停止最多衔接 3 秒。配音和音效仍手动播放；本机静音立即停止。</p>
    {view?.humanHost && <label>停止非配音音轨时<select aria-label="停止音轨渐出" value={stopFadeMs} onChange={event => { resetReview(); setStopFadeMs(Number(event.target.value)) }}><option value={0}>立即停止</option><option value={1000}>最多 1 秒渐出</option><option value={3000}>最多 3 秒渐出</option></select></label>}
    {view?.tracks.length === 0 && <p>尚未保存音轨，可继续文字游玩。</p>}
    {order.map(key => { const { track, url, retiring } = displayed.get(key)!; return <article key={track.clipKey} className="sf-open-audio-track" hidden={retiring} style={retiring ? { display: 'none' } : undefined}>
      <h3>{channels[track.channel]} · {audiences[track.audience]}</h3>
      <TtrpgOpenAudioPlayer key={`${identity}:${track.clipKey}`} track={track} url={enabled && !silenced ? url : undefined}
        failed={!!clipFailures[track.clipKey]} resumeSeconds={bookmarks.current.get(track.clipKey) ?? 0} register={register} remember={remember}
        onVolumeTakeover={() => transitions.yieldToListener(track.clipKey)}
        onFailure={() => setClipFailures(old => ({ ...old, [track.clipKey]: true }))} />
      {clipFailures[track.clipKey] && <><p role="status">音频不可用，已保留文字说明。</p><button onClick={() => { const clip = clips.current.get(track.clipKey); if (clip) URL.revokeObjectURL(clip.url); clips.current.delete(track.clipKey); setReload(value => value + 1) }}>重新加载此音轨</button></>}
      {!retiring && view?.humanHost && <button disabled={working || props.busy || !view.canStop} onClick={() => void prepareSaved(track.sourceRef, 'stop')}>核对停止{channels[track.channel]}</button>}
    </article> })}
    {view?.humanHost && <TtrpgOpenVoiceStudio key={`${identity}:${view.authorizationRevision}`} input={input()} view={view} enabled={enabled&&!silenced} busy={props.busy} sequence={props.sequence} registerStop={registerVoiceStop} onChanged={props.onChanged}/>}
    {view?.humanHost && <details><summary>主持音轨管理</summary>
      {view.unavailable && <p>{view.unavailable}</p>}
      {!pending && <fieldset disabled={working || props.busy || !view.canPlay}>
        <legend>选择文件并核对播放范围</legend>
        <label>音轨类型<select value={channel} aria-label="音轨类型" onChange={event => { resetReview(); setVoiceChecked(false); const next = event.target.value as TtrpgAudioChannelV1; setChannel(next); if (next === 'voice') setFadeMs(0); if (next === 'voice' && audience === 'public') setAudience('party') }}>{Object.entries(channels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        {channel !== 'voice' && <label>播放时渐入<select aria-label="音轨播放渐入" value={fadeMs} onChange={event => { resetReview(); setFadeMs(Number(event.target.value)) }}><option value={0}>立即播放</option><option value={1000}>1 秒渐入</option><option value={3000}>3 秒渐入</option></select></label>}
        <label>接收范围<select value={audience} aria-label="音频接收范围" onChange={event => { resetReview(); setAudience(event.target.value as TtrpgAudioAudienceV1) }}>{Object.entries(audiences).filter(([key]) => (key !== 'public' || channel !== 'voice') && (key === 'party' || key === 'public' || view.privateControlAllowed)).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        {audience === 'private' && <label>指定角色<select aria-label="音频指定角色" value={actor} onChange={event => setActor(event.target.value)}><option value="">选择角色</option>{view.players.map(row => <option key={row.actorKey} value={row.actorKey}>{row.name}</option>)}</select></label>}
        <label>本次已确认叙述<select aria-label="音频依据" value={cause} onChange={event => { setCause(event.target.value); setVoiceChecked(false) }}><option value="">选择已完成的行动</option>{view.causes.map(row => <option key={JSON.stringify(row.sourceRef)} value={JSON.stringify(row.sourceRef)}>{row.text.slice(0, 60)}</option>)}</select></label>
        {channel === 'voice' && selectedCause && <><p className="sf-open-audio-caption">{selectedCause.text}</p><p>整段字幕按文件总时长显示，须由上传者试听核对。</p>
          <label><input type="checkbox" checked={voiceChecked} onChange={event => setVoiceChecked(event.target.checked)} />我已试听并核对音频与上述文字一致。</label></>}
        <label>音频文件<input key={identity} type="file" aria-label="音频文件" accept="audio/wav,audio/mpeg,audio/ogg,.wav,.mp3,.ogg" onChange={event => {
          resetReview(); setVoiceChecked(false); fileRead.current?.abort(); const chosen = event.target.files?.[0] ?? null; setFile(chosen); setDurationMs(null)
          if (chosen) { const owner = currentIdentity.current, controller = new AbortController(); fileRead.current = controller; void duration(chosen, controller.signal).then(value => {
            if (!controller.signal.aborted && currentIdentity.current === owner && fileRead.current === controller) setDurationMs(value)
          }) }
        }} /></label>
        <label>文件来源<input aria-label="音频来源" value={source} onChange={event => setSource(event.target.value)} maxLength={5000} /></label>
        <label>许可说明<textarea aria-label="音频许可" value={license} onChange={event => setLicense(event.target.value)} maxLength={5000} /></label>
        <p>文件将保存在本团局，来源与许可由上传者声明。此处不调用供应商。</p>
        <button disabled={!file || !selectedCause || !source.trim() || !license.trim() || audience === 'private' && !actor || channel === 'voice' && (!voiceChecked || !durationMs)} onClick={() => void prepareFile()}>保存文件并核对音轨</button>
      </fieldset>}
      {pending && <section className="sf-open-audio-review" data-testid="ttrpg-open-audio-review">
        <h3>核对{pending.request.action === 'stop' ? '停止' : '播放'}{channels[pending.request.channel]}</h3>
        <p>范围：{audiences[pending.request.audience]}；本次接收者：{pending.recipients.join('、')}{pending.request.audience === 'public' ? '及公开听众' : ''}</p>
        {pending.request.action === 'play' && pending.request.channel !== 'voice' && <p>播放时渐入：{pending.request.fade ? `${pending.request.fade / 1000} 秒` : '无'}；开始播放仍由听众选择。</p>}
        {pending.request.action === 'stop' && <p>停止时渐出：{pending.request.fade ? `最多 ${Math.min(3000, pending.request.fade) / 1000} 秒` : '立即停止'}；本机静音和安全暂停始终立即停止。</p>}
        {pending.asset && <><p>文件：{pending.asset.name}；版本 {pending.asset.version}</p><p>来源：{pending.asset.source}</p><p>许可：{pending.asset.license}</p></>}
        <p className="sf-open-audio-caption">{pending.request.channel === 'voice' ? pending.fallbackText : '音轨用于辅助展示，不改变本次已确认行动。'}</p>
        <label><input type="checkbox" disabled={working} checked={agreed} onChange={event => setAgreed(event.target.checked)} />我已核对文件、文字与接收范围，并确认拥有本次使用许可。</label>
        <button disabled={!agreed || working || props.busy} onClick={() => void perform(async () => {
          const owner = currentIdentity.current; await confirmTtrpgOpenAudioReviewV1({ ...input(), review: pending, decision: 'confirm-this-audio-and-audience' })
          if (live.current && currentIdentity.current === owner) {
            setReview(null); setAgreed(false); setNotice('音轨控制已保存。本机播放仍由本人开启。')
            try { await props.onChanged(); await refresh() } catch { if (live.current && currentIdentity.current === owner) setError('音轨已保存，桌面尚未刷新，请重新读取进度。') }
          }
        })}>确认本次音轨控制</button>
        <button disabled={working} onClick={resetReview}>返回重新核对</button>
      </section>}
      {view.library.length > 0 && <details><summary>本桌可读的已保存音轨</summary>{view.library.map(row => <p key={JSON.stringify(row.sourceRef)}>{row.name} · {channels[row.channel]} · {audiences[row.audience]}
        <button disabled={working || props.busy || !view.canPlay || !!pending} onClick={() => void prepareSaved(row.sourceRef, 'play')}>核对重播</button></p>)}</details>}
    </details>}
  </section>
}
