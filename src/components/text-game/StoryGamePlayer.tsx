import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Clock3,
  GitBranch,
  History,
  Library,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Trash2,
  UserRound,
  X,
} from 'lucide-react'
import type { FrozenNarrativeBeat, FrozenNarrativeChoice, Project, WorkspaceScope } from '../../lib/types'
import { currentPlayerReleases } from '../../lib/text-game/player-library'
import { useStoryGamePlayerStore } from '../../stores/story-game-player'
import { useDialog } from '../shared/Dialog'
import './player-roadshow.css'

type PlayerView = 'story' | 'history' | 'saves'
type ReaderTheme = 'paper' | 'night'

interface ReaderPreferences {
  fontScale: number
  lineHeight: number
  theme: ReaderTheme
}

interface ReaderCursor {
  sceneKey: string
  revealedStep: number
}

interface DisplayBeat {
  label: string
  text: string
  dialogue: boolean
}

const DEFAULT_PREFERENCES: ReaderPreferences = { fontScale: 1, lineHeight: 1.85, theme: 'paper' }

function preferenceKey(projectId: number): string {
  return `storyforge.storygame.reader.${projectId}`
}

function cursorKey(sessionId: number): string {
  return `storyforge.storygame.cursor.${sessionId}`
}

function loadCursor(sessionId: number, sceneKey: string, maximumStep: number): ReaderCursor {
  try {
    const value = JSON.parse(localStorage.getItem(cursorKey(sessionId)) ?? '{}') as Partial<ReaderCursor>
    if (value.sceneKey === sceneKey && Number.isInteger(value.revealedStep)) {
      return {
        sceneKey,
        revealedStep: Math.min(maximumStep, Math.max(1, Number(value.revealedStep))),
      }
    }
  } catch { /* restart the current scene when a local cursor is invalid */ }
  return { sceneKey, revealedStep: 1 }
}

function saveCursor(sessionId: number, cursor: ReaderCursor): void {
  try { localStorage.setItem(cursorKey(sessionId), JSON.stringify(cursor)) } catch { /* reading can continue in memory */ }
}

function loadPreferences(projectId: number): ReaderPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(preferenceKey(projectId)) ?? '{}') as Partial<ReaderPreferences>
    return {
      fontScale: [0.9, 1, 1.15, 1.3].includes(value.fontScale ?? 0) ? value.fontScale! : 1,
      lineHeight: [1.6, 1.85, 2.1].includes(value.lineHeight ?? 0) ? value.lineHeight! : 1.85,
      theme: value.theme === 'night' ? 'night' : 'paper',
    }
  } catch {
    return DEFAULT_PREFERENCES
  }
}

function attributedText(text: string): { speaker: string; text: string } | null {
  const match = text.trim().match(/^【([^】]+)】\s*([\s\S]*)$/)
  return match ? { speaker: match[1].trim(), text: match[2].trim() } : null
}

function displayBeat(beat: FrozenNarrativeBeat, speakers: Record<string, string>): DisplayBeat {
  const attributed = attributedText(beat.text)
  if (attributed) return { label: attributed.speaker, text: attributed.text, dialogue: true }
  if (beat.kind === 'dialogue') return {
    label: (beat.speakerKey ? speakers[beat.speakerKey] : null)
      ?? (Object.keys(speakers).length === 1 ? Object.values(speakers)[0] : '未知角色'),
    text: beat.text,
    dialogue: true,
  }
  if (beat.kind === 'action') return { label: '行动', text: beat.text, dialogue: false }
  if (beat.kind === 'system') return { label: '系统', text: beat.text, dialogue: false }
  return { label: '旁白', text: beat.text, dialogue: false }
}

function choiceForKey(choices: FrozenNarrativeChoice[], key: string): FrozenNarrativeChoice | null {
  return choices.find(choice => choice.choiceKey === key) ?? null
}

function formatTime(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(value)
}

export default function StoryGamePlayer(props: {
  project: Project
  scope: WorkspaceScope
  worldGroupId: number | null
}) {
  const store = useStoryGamePlayerStore()
  const dialog = useDialog()
  const [view, setView] = useState<PlayerView>('story')
  const [showSettings, setShowSettings] = useState(false)
  const [catalogReleaseId, setCatalogReleaseId] = useState<number | null>(null)
  const [preferences, setPreferences] = useState(() => loadPreferences(props.project.id!))
  const [readerCursor, setReaderCursor] = useState<ReaderCursor>({ sceneKey: '', revealedStep: 1 })

  useEffect(() => {
    setCatalogReleaseId(null)
    void store.load(props.scope, props.worldGroupId, true)
  // Zustand actions are stable; the explicit scope is the reload boundary.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.scope.projectId, props.scope.worldId, props.scope.workId, props.worldGroupId])

  useEffect(() => {
    localStorage.setItem(preferenceKey(props.project.id!), JSON.stringify(preferences))
  }, [preferences, props.project.id])

  const selected = store.sessions.find(session => session.id === store.selectedSessionId) ?? null
  const catalog = useMemo(() => currentPlayerReleases(store.releases), [store.releases])
  const catalogRelease = catalog.find(item => item.release.id === catalogReleaseId) ?? null
  const selectedRelease = store.releases.find(item => item.release.id === selected?.gameReleaseId) ?? null
  const playerCharacter = selectedRelease?.playerCharacter ?? null
  const speakerNames = useMemo(() => ({
    ...(selectedRelease?.speakerNames ?? {}),
    ...store.speakerNames,
  }), [selectedRelease?.speakerNames, store.speakerNames])
  const narrative = store.runtimeState.narrative ?? null
  const isLegacy = narrative?.version === 1
  const currentNode = narrative?.nodes.find(node => node.key === narrative.currentNodeKey) ?? null
  const beats = useMemo(() => (narrative?.beats ?? [])
    .filter(beat => beat.nodeKey === currentNode?.key)
    .sort((left, right) => left.order - right.order), [currentNode?.key, narrative?.beats])
  const currentNodeVisit = narrative && currentNode
    ? narrative.visitedNodeKeys.filter(key => key === currentNode.key).length
    : 0
  const readerSceneKey = selected && currentNode ? `${selected.id}:${currentNode.key}:${currentNodeVisit}` : ''
  const maximumReadingStep = Math.max(1, beats.length + 1)
  const revealedStep = readerCursor.sceneKey === readerSceneKey
    ? Math.min(maximumReadingStep, Math.max(1, readerCursor.revealedStep))
    : 1
  const revealedBeatCount = beats.length === 0 ? 0 : Math.min(beats.length, revealedStep)
  const revealedBeats = useMemo(() => beats.slice(0, revealedBeatCount), [beats, revealedBeatCount])
  const nodeContentComplete = beats.length === 0 || revealedStep > beats.length
  const visibleChoices = useMemo(() => (narrative?.visibleChoiceKeys ?? [])
    .map(key => choiceForKey(narrative?.choices ?? [], key))
    .filter((choice): choice is FrozenNarrativeChoice => choice != null), [narrative])
  const legacyChoices = useMemo(() => (narrative?.version === 1 ? narrative.availableNodeKeys : [])
    .map(key => narrative?.nodes.find(node => node.key === key))
    .filter((node): node is NonNullable<typeof node> => node != null), [narrative])
  const speakers = useMemo(() => Array.from(new Set([
    ...(playerCharacter ? [playerCharacter.name] : []),
    ...revealedBeats
    .map(beat => displayBeat(beat, speakerNames))
    .filter(beat => beat.dialogue)
    .map(beat => beat.label),
  ])), [playerCharacter, revealedBeats, speakerNames])
  const progress = narrative ? Math.min(100, Math.max(8, Math.round(
    narrative.visitedNodeKeys.length / Math.max(narrative.nodes.length, 1) * 100,
  ))) : 0

  useEffect(() => {
    if (!selected?.id || !readerSceneKey) return
    setReaderCursor(current => current.sceneKey === readerSceneKey
      ? current
      : loadCursor(selected.id!, readerSceneKey, maximumReadingStep))
  }, [maximumReadingStep, readerSceneKey, selected?.id])

  const run = async (action: () => Promise<unknown>) => {
    try { await action() } catch { /* store exposes the actionable error */ }
  }

  const advanceReader = () => {
    if (!selected?.id || !readerSceneKey || nodeContentComplete) return
    const next = {
      sceneKey: readerSceneKey,
      revealedStep: Math.min(maximumReadingStep, revealedStep + 1),
    }
    saveCursor(selected.id, next)
    setReaderCursor(next)
  }

  const beatBelongsToPlayer = (beat: FrozenNarrativeBeat, shown: DisplayBeat): boolean => (
    shown.dialogue
    && playerCharacter != null
    && (beat.speakerKey === playerCharacter.speakerKey || shown.label === playerCharacter.name)
  )

  const startGame = async (releaseId: number, title: string) => {
    await run(async () => {
      await store.start(releaseId, `${title} · ${new Date().toLocaleDateString('zh-CN')} 存档`)
      setView('story')
    })
  }

  const saveCheckpoint = async () => {
    const name = await dialog.prompt({
      title: '保存检查点',
      message: '检查点会保留当前事件序号，可以从这里建立不覆盖原存档的新时间线。',
      defaultValue: currentNode?.title ? `${currentNode.title} · 手动存档` : '手动存档',
      confirmText: '保存',
    })
    if (name == null) return
    await run(() => store.saveCheckpoint(name))
  }

  const forkCheckpoint = async (checkpointId: number, checkpointName: string) => {
    const title = await dialog.prompt({
      title: '从检查点创建新时间线',
      message: '原存档不会被覆盖。',
      defaultValue: `${selected?.title ?? '存档'} · ${checkpointName}`,
      confirmText: '创建分支',
    })
    if (title == null) return
    await run(async () => {
      await store.forkCheckpoint(checkpointId, title)
      setView('story')
    })
  }

  const removeSession = async (sessionId: number, title: string) => {
    const confirmed = await dialog.confirm({
      title: `删除文字游戏存档“${title}”？`,
      message: '该存档的事件、检查点会一起删除；它的子分支会保留并解除父存档引用。',
      confirmText: '删除',
      tone: 'danger',
    })
    if (confirmed) await run(async () => {
      await store.remove(sessionId)
      try { localStorage.removeItem(cursorKey(sessionId)) } catch { /* stale local cursor is harmless */ }
    })
  }

  if (store.loading && !selected) return <div className="storygame-launcher storygame-player-v2"><div className="storygame-empty"><Loader2 className="h-6 w-6 animate-spin" /><span>正在恢复本地存档…</span></div></div>

  if (!selected || !narrative || !currentNode) return (
    <div className="storygame-launcher storygame-player-v2" data-testid="storygame-player">
      <div className="storygame-launcher-atmosphere" />
      <div className="storygame-launcher-content">
        <span className="storygame-launcher-kicker"><Library className="h-4 w-4" /> BRANCHING STORIES</span>
        <h2>{catalogRelease ? '游戏详情' : '分支叙事游戏库'}</h2>
        <p>{catalogRelease ? '确认故事规模与结局结构，然后开始一条全新的时间线。' : '先从游戏库选择作品，再进入标题页开始或继续；进入前不会自动创建存档。'}</p>
        {store.error && <div className="storygame-alert" role="alert"><span>{store.error}</span><button type="button" onClick={() => void store.load(props.scope, props.worldGroupId)}>重新同步</button></div>}
        {catalogRelease ? <section className="textgame-title-page storygame-title-page" aria-label="分支叙事游戏详情">
          <button type="button" className="textgame-catalog-back" onClick={() => setCatalogReleaseId(null)}><ArrowLeft className="h-4 w-4" />返回全部游戏</button>
          <div className="textgame-title-art" aria-hidden="true"><BookOpen /><span>BRANCHING<br />NARRATIVE</span></div>
          <div className="textgame-title-copy">
            <small>分支叙事 · 当前可玩版本</small>
            <h3>{catalogRelease.manifest?.definition.title ?? catalogRelease.release.label}</h3>
            <p>{catalogRelease.manifest?.definition.description || '一段等待你作出选择的故事。'}</p>
            {catalogRelease.playerCharacter && <div className="textgame-player-role" aria-label={`你将扮演 ${catalogRelease.playerCharacter.name}`}><i>{catalogRelease.playerCharacter.name.slice(0, 1)}</i><span><small>你将扮演</small><strong>{catalogRelease.playerCharacter.name}</strong>{catalogRelease.playerCharacter.description && <p>{catalogRelease.playerCharacter.description}</p>}</span></div>}
            {catalogRelease.manifest && <div className="textgame-title-stats"><span>{catalogRelease.manifest.narrative.nodes.length} 个场景</span><span>{catalogRelease.manifest.narrative.choices.length} 个选择</span><span>{catalogRelease.manifest.narrative.nodes.filter(node => node.kind === 'ending').length} 个结局</span></div>}
            {catalogRelease.error ? <span className="storygame-error-text">{catalogRelease.error}</span> : <div className="textgame-title-actions"><button type="button" className="textgame-start" onClick={() => void startGame(catalogRelease.release.id!, catalogRelease.manifest!.definition.title)} disabled={store.busy}><Plus className="h-4 w-4" />开始新游戏</button>{store.sessions.find(session => session.gameReleaseId === catalogRelease.release.id) && <button type="button" onClick={() => void store.select(store.sessions.find(session => session.gameReleaseId === catalogRelease.release.id)!.id!)}><Clock3 className="h-4 w-4" />继续上次进度</button>}</div>}
          </div>
        </section> : <>
          <div className="textgame-catalog-heading"><span>全部游戏</span><small>{catalog.length} 部可游玩作品</small></div>
          <section className="textgame-catalog-list" aria-label="分支叙事游戏列表">
            {catalog.map(item => <article key={item.release.id}><button type="button" aria-label={`查看游戏：${item.manifest?.definition.title ?? item.release.label}`} onClick={() => setCatalogReleaseId(item.release.id!)}><span className="textgame-catalog-icon"><GitBranch /></span><span className="textgame-catalog-copy"><small>分支叙事</small><strong>{item.manifest?.definition.title ?? item.release.label}</strong><p>{item.manifest?.definition.description || '一段等待你作出选择的故事。'}</p>{item.manifest && <i>{item.manifest.narrative.nodes.length} 场景 · {item.manifest.narrative.choices.length} 选择 · {item.manifest.narrative.nodes.filter(node => node.kind === 'ending').length} 结局</i>}</span><span className="textgame-catalog-open">查看详情<ChevronRight /></span></button></article>)}
            {!catalog.length && <div className="storygame-empty-small">还没有可游玩的分支叙事，请先在作者工作台完成发布。</div>}
          </section>
          {!!store.sessions.length && <section className="storygame-launcher-saves"><h3><Clock3 className="h-4 w-4" />继续故事</h3>{store.sessions.map(session => <div key={session.id}><button type="button" onClick={() => void store.select(session.id!)}><strong>{session.title}</strong><small>{formatTime(session.updatedAt)}{session.gameReleaseId == null ? ' · 旧版兼容' : session.parentSessionId ? ' · 分支' : ' · 自动保存'}</small></button><button type="button" aria-label={`删除存档 ${session.title}`} onClick={() => void removeSession(session.id!, session.title)}><Trash2 className="h-4 w-4" /></button></div>)}</section>}
        </>}
      </div>
    </div>
  )

  return (
    <div className={`storygame-shell storygame-player-v2 storygame-playing storygame-theme-${preferences.theme}`} data-testid="storygame-player">
      <section className="storygame-main" aria-label="分支叙事播放器">
        <header className="storygame-gamebar">
          <button type="button" aria-label="返回游戏库" onClick={() => void store.select(null)}><ArrowLeft className="h-4 w-4" /></button>
          <div className="storygame-game-title"><small>{narrative.moduleTitle}{playerCharacter ? ` · 你是 ${playerCharacter.name}` : ''}{isLegacy ? ' · 旧版兼容模式' : ''}</small><strong>{selectedRelease?.manifest?.definition.title ?? selected.title}</strong></div>
          <div className="storygame-progress" aria-label={`故事进度 ${progress}%`}><span style={{ width: `${progress}%` }} /></div>
          <nav aria-label="播放器功能">
            <button type="button" className={view === 'story' ? 'active' : ''} onClick={() => setView('story')}><BookOpen className="h-4 w-4" />故事</button>
            <button type="button" className={view === 'history' ? 'active' : ''} onClick={() => setView('history')}><History className="h-4 w-4" />历史</button>
            <button type="button" className={view === 'saves' ? 'active' : ''} onClick={() => setView('saves')}><Save className="h-4 w-4" />存档</button>
            <button type="button" aria-label="阅读设置" onClick={() => setShowSettings(value => !value)}><Settings2 className="h-4 w-4" /></button>
            <button type="button" aria-label="刷新存档" onClick={() => void store.load(props.scope, props.worldGroupId)}><RefreshCw className="h-4 w-4" /></button>
          </nav>
        </header>

        {store.error && <div className="storygame-alert" role="alert"><span>{store.error}</span><button type="button" onClick={() => void store.load(props.scope, props.worldGroupId)}>重新同步</button></div>}
        {view === 'story' && !narrative.completed && <section key={readerSceneKey} className="storygame-story-stage" aria-labelledby="storygame-node-title" style={{ fontSize: `${preferences.fontScale}rem`, lineHeight: preferences.lineHeight }}>
          <div className="storygame-stage-atmosphere"><span /><span /><span /></div>
          <div className="storygame-scene-meta"><span>场景 {narrative.visitedNodeKeys.length} / {narrative.nodes.length}</span><span>已自动保存 · 事件 #{store.runtimeState.lastSequence}</span></div>
          <header><small>当前场景</small><h2 id="storygame-node-title">{currentNode.title}</h2>{currentNode.summary && <p>{currentNode.summary}</p>}</header>
          {isLegacy && <div className="storygame-legacy-note">旧 WORLD-2F 兼容存档：可以继续阅读和分支，但不会覆盖为新发布。</div>}
          {playerCharacter && <div className="storygame-player-identity" aria-label={`你扮演 ${playerCharacter.name}`}><span>你扮演</span><i>{playerCharacter.name.slice(0, 1)}</i><div><strong>{playerCharacter.name}</strong>{playerCharacter.description && <small>{playerCharacter.description}</small>}</div></div>}
          {!!speakers.length && <div className="storygame-cast" aria-label="本场角色">{speakers.map(speaker => <span className={speaker === playerCharacter?.name ? 'is-player' : ''} key={speaker}><i>{speaker.slice(0, 1)}</i><b>{speaker}</b><small>{speaker === playerCharacter?.name ? '玩家角色' : '场景角色'}</small></span>)}</div>}
          <div className="storygame-beats" aria-live="polite">
            {revealedBeats.map(beat => {
              const shown = displayBeat(beat, speakerNames)
              const playerBeat = beatBelongsToPlayer(beat, shown)
              return <article className={`storygame-beat storygame-beat-${beat.kind} ${shown.dialogue ? `is-dialogue ${playerBeat ? 'is-player side-right' : 'is-npc side-left'}` : ''}`} data-speaker-role={shown.dialogue ? playerBeat ? 'player' : 'npc' : undefined} key={beat.beatKey} aria-label={`${shown.label}：${shown.text}`}>
                {shown.dialogue && <span className="storygame-speaker-mark" aria-hidden="true">{shown.label.slice(0, 1)}</span>}
                <div><strong>{shown.label}</strong><p>{shown.text}</p></div>
              </article>
            })}
            {!beats.length && <p className="storygame-node-summary">继续选择，推进这段故事。</p>}
          </div>
          {!nodeContentComplete && <div className="storygame-reading-controls"><button type="button" onClick={advanceReader} disabled={store.busy} aria-label={revealedBeatCount < beats.length ? '继续阅读' : '进入选择'}><span>{revealedBeatCount < beats.length ? '继续' : '作出选择'}</span><small>{revealedBeatCount} / {beats.length}</small><ChevronRight className="h-4 w-4" /></button></div>}
          {nodeContentComplete && <div className="storygame-choices" aria-label="剧情选择">
            <small>你的选择</small>
            {isLegacy ? legacyChoices.map((node, index) => <div key={node.key}><button type="button" onClick={() => void run(() => store.advanceLegacy(node.key))} disabled={store.busy}><span>{index + 1}</span><span><strong>{node.title}</strong>{node.summary && <small>{node.summary}</small>}</span><ChevronRight className="h-4 w-4" /></button></div>) : visibleChoices.map((choice, index) => {
              const available = narrative.availableChoiceKeys?.includes(choice.choiceKey) ?? false
              const reasonId = `choice-reason-${choice.choiceKey.replace(/[^a-zA-Z0-9_-]/g, '-')}`
              return <div key={choice.choiceKey}><button type="button" onClick={() => void run(() => store.choose(choice.choiceKey))} disabled={!available || store.busy} aria-describedby={!available && choice.unavailableReason ? reasonId : undefined}><span>{index + 1}</span><span><strong>{choice.text}</strong>{choice.description && <small>{choice.description}</small>}</span><ChevronRight className="h-4 w-4" /></button>{!available && <p id={reasonId}>{choice.unavailableReason || '当前条件未满足。'}</p>}</div>
            })}
          </div>}
        </section>}

        {view === 'story' && narrative.completed && <section key={readerSceneKey} className="storygame-ending" aria-labelledby="storygame-ending-title"><CheckCircle2 className="h-10 w-10" /><small>{nodeContentComplete ? 'ENDING REACHED' : 'FINAL SCENE'}</small><h2 id="storygame-ending-title">{currentNode.title}</h2>{revealedBeats.map(beat => { const shown = displayBeat(beat, speakerNames); const playerBeat = beatBelongsToPlayer(beat, shown); return <div className={`storygame-beat storygame-beat-${beat.kind} ${shown.dialogue ? `is-dialogue ${playerBeat ? 'is-player side-right' : 'is-npc side-left'}` : ''}`} data-speaker-role={shown.dialogue ? playerBeat ? 'player' : 'npc' : undefined} key={beat.beatKey}><strong>{shown.label}</strong><p>{shown.text}</p></div> })}{!nodeContentComplete ? <div className="storygame-reading-controls"><button type="button" onClick={advanceReader} disabled={store.busy} aria-label={revealedBeatCount < beats.length ? '继续阅读' : '查看结局'}><span>{revealedBeatCount < beats.length ? '继续' : '查看结局'}</span><small>{revealedBeatCount} / {beats.length}</small><ChevronRight className="h-4 w-4" /></button></div> : <><div className="storygame-ending-stats"><span><strong>{narrative.visitedNodeKeys.length}</strong>到访节点</span><span><strong>{narrative.choiceHistory?.length ?? 0}</strong>关键选择</span><span><strong>{store.runtimeState.lastSequence}</strong>回放事件</span></div><div className="storygame-ending-actions"><button type="button" onClick={() => setView('history')}><History className="h-4 w-4" />回看选择</button><button type="button" onClick={() => setView('saves')}><GitBranch className="h-4 w-4" />从检查点改选</button></div></>}</section>}

        {view !== 'story' && <div className="storygame-panel-backdrop" role="presentation"><section className="storygame-panel" aria-label={view === 'history' ? '选择历史' : '检查点与分支'}><header><div><small>{view === 'history' ? 'READING HISTORY' : 'SAVE & FORK'}</small><h2>{view === 'history' ? '这条时间线的阅读记录' : '检查点与时间线'}</h2></div><button type="button" aria-label="关闭面板" onClick={() => setView('story')}><X className="h-4 w-4" /></button></header>{view === 'history' ? <div className="storygame-history">{narrative.visitedNodeKeys.map((nodeKey, index) => { const node = narrative.nodes.find(candidate => candidate.key === nodeKey); const allNodeBeats = (narrative.beats ?? []).filter(beat => beat.nodeKey === nodeKey).sort((left, right) => left.order - right.order); const nodeBeats = nodeKey === currentNode.key && index === narrative.visitedNodeKeys.length - 1 ? allNodeBeats.slice(0, revealedBeatCount) : allNodeBeats; const historyItem = narrative.choiceHistory?.[index]; const choice = historyItem ? choiceForKey(narrative.choices ?? [], historyItem.choiceKey) : null; return <article key={`${nodeKey}-${index}`}><span>{index + 1}</span><div><small>{node?.kind === 'ending' ? '结局' : '场景'}</small><strong>{node?.title ?? nodeKey}</strong>{nodeBeats.map(beat => { const shown = displayBeat(beat, speakerNames); return <p key={beat.beatKey}><b>{shown.label}</b>：{shown.text}</p> })}{choice && <p className="storygame-history-choice">选择：{choice.text} · 事件 #{historyItem?.eventSequence}</p>}</div></article>})}</div> : <div className="storygame-saves"><button type="button" className="storygame-primary-save" onClick={() => void saveCheckpoint()} disabled={store.busy}><Save className="h-4 w-4" />保存当前检查点</button><div className="storygame-save-list">{store.checkpoints.map(checkpoint => <article key={checkpoint.id}><div><strong>{checkpoint.name}</strong><span>事件 #{checkpoint.throughSequence} · {formatTime(checkpoint.createdAt)}</span></div><button type="button" onClick={() => void forkCheckpoint(checkpoint.id!, checkpoint.name)} disabled={store.busy}><GitBranch className="h-4 w-4" />从这里分支</button></article>)}</div><button type="button" className="storygame-secondary-action" onClick={() => void run(() => store.forkCurrent())} disabled={store.busy}><GitBranch className="h-4 w-4" />从当前位置建立新时间线</button></div>}</section></div>}

        {showSettings && <div className="storygame-settings-popover"><div><UserRound className="h-4 w-4" /><strong>阅读设置</strong></div><label>字号<select value={preferences.fontScale} onChange={event => setPreferences(value => ({ ...value, fontScale: Number(event.target.value) }))}><option value={0.9}>较小</option><option value={1}>标准</option><option value={1.15}>较大</option><option value={1.3}>特大</option></select></label><label>行距<select value={preferences.lineHeight} onChange={event => setPreferences(value => ({ ...value, lineHeight: Number(event.target.value) }))}><option value={1.6}>紧凑</option><option value={1.85}>舒适</option><option value={2.1}>宽松</option></select></label><label>主题<select value={preferences.theme} onChange={event => setPreferences(value => ({ ...value, theme: event.target.value as ReaderTheme }))}><option value="paper">纸张</option><option value="night">夜间</option></select></label></div>}
      </section>
    </div>
  )
}
