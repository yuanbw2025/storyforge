import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import {
  ArrowLeft,
  Backpack,
  BookOpenCheck,
  Check,
  ChevronRight,
  CircleDot,
  Compass,
  Gem,
  GitBranch,
  History,
  KeyRound,
  Loader2,
  Map,
  PackageOpen,
  Plus,
  Save,
  ScrollText,
  Send,
  Sparkles,
  Square,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react'
import { isAIConfigReady } from '../../lib/ai/config-readiness'
import { resolveRequestConfig } from '../../lib/ai/client'
import {
  parseAdventureNarrativeBlocks,
  parseAdventurePlayerCommand,
  projectAdventureTranscript,
  resolveAdventurePlayerIdentity,
  type AdventureNarrativeBlock,
  type AdventureSystemCommand,
} from '../../lib/adventure/player-experience'
import { currentPlayerReleases } from '../../lib/text-game/player-library'
import type { AdventureProductRuntimePackageV1, Project, WorkspaceScope } from '../../lib/types'
import { useAdventureGamePlayerStore, selectAdventureActions } from '../../stores/adventure-game-player'
import { useAIConfigStore } from '../../stores/ai-config'
import { useDialog } from '../shared/Dialog'
import './player-roadshow.css'

type AdventurePanel = 'inventory' | 'skills' | 'quests' | 'journal' | 'saves' | null

interface AdventureNarrativePlayback {
  eventSequence: number
  unitIndex: number
  visibleCharacters: number
}

const QUEST_STATUS: Record<string, string> = {
  locked: '未解锁', available: '可接取', active: '进行中', completed: '已完成', failed: '已失败',
}

const ACTION_KIND = {
  look: '观察', move: '移动', talk: '交谈', take: '拾取', give: '交付', use: '使用',
  inspect: '调查', attempt: '尝试', rest: '休整', 'quest-action': '任务',
} as const

const COMMON_LABELS: Record<string, string> = {
  notice: '失物告示', gate: '集市门闩', ledger: '档案簿', lock: '档案柜锁',
  grate: '水渠格栅', mechanism: '水渠机关', keeper: '守钟人', beacon: '旧灯塔',
  rope: '旧绳', 'brass-key': '黄铜钥匙', 'ledger-page': '档案抄页', 'lamp-oil': '灯油',
  herb: '水渠草药', seal: '旧印章', gear: '备用齿轮', letter: '未寄出的信',
  coin: '港币', 'bell-shard': '潮汐钟片', observe: '观察', agility: '灵巧',
  reason: '推理', empathy: '共情', wounded: '受伤', inspired: '振奋', wanted: '被通缉',
}

function friendlyName(title: string | undefined, key: string): string {
  const value = title?.trim()
  return !value || value.toLowerCase() === key.toLowerCase() ? COMMON_LABELS[key] ?? value ?? key : value
}

function friendlyDescription(description: string | undefined, key: string, kind: 'object' | 'item' | 'ability' | 'condition'): string {
  const value = description?.trim() ?? ''
  if (value && !value.toLowerCase().startsWith(key.toLowerCase())) return value
  if (kind === 'object') return '可调查的场景要素，可能藏着推进冒险的线索。'
  if (kind === 'item') return '可在任务、判定或场景行动中使用的物品。'
  if (kind === 'condition') return '当前状态会影响后续行动与剧情结果。'
  const abilityCopy: Record<string, string> = {
    observe: '发现环境细节与未被说出的线索。', agility: '完成需要身手与反应的行动。',
    reason: '分析记录、机关与相互矛盾的证据。', empathy: '理解人物动机并建立信任。',
  }
  return abilityCopy[key] ?? '用于解决冒险中的能力检定。'
}

function itemIcon(tags: string[], key: string) {
  const text = `${tags.join(' ')} ${key}`.toLowerCase()
  if (text.includes('key') || text.includes('钥')) return <KeyRound />
  if (text.includes('record') || text.includes('document') || text.includes('记录')) return <ScrollText />
  if (text.includes('artifact') || text.includes('bell') || text.includes('宝物')) return <Gem />
  return <PackageOpen />
}

function gauge(value: number, minimum: number, maximum: number): number {
  if (maximum <= minimum) return 100
  return Math.min(100, Math.max(0, (value - minimum) / (maximum - minimum) * 100))
}

function formatTime(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(value)
}

function adventureNpcCount(manifest: AdventureProductRuntimePackageV1): number {
  const player = resolveAdventurePlayerIdentity(manifest)
  return manifest.interaction.profiles.filter(profile => profile.participantKey !== player?.participantKey).length
}

function splitNarrativeSentences(value: string): string[] {
  const result: string[] = []
  const closingMarks = '”’」』】》）)]'
  let sentence = ''
  for (let index = 0; index < value.length; index += 1) {
    sentence += value[index]
    if (!'。！？!?;；…'.includes(value[index])) continue
    while (index + 1 < value.length && closingMarks.includes(value[index + 1])) {
      index += 1
      sentence += value[index]
    }
    if (sentence.trim()) result.push(sentence.trim())
    sentence = ''
  }
  if (sentence.trim()) result.push(sentence.trim())
  return result.length ? result : [value]
}

function sequenceNarrativeBlocks(blocks: AdventureNarrativeBlock[]): AdventureNarrativeBlock[] {
  return blocks.flatMap(block => splitNarrativeSentences(block.text).map(text => ({ ...block, text })))
}

export default function AdventureGamePlayer(props: {
  project: Project
  scope: WorkspaceScope
  worldGroupId: number | null
  initialSessionId?: number | null
}) {
  const store = useAdventureGamePlayerStore()
  const { config } = useAIConfigStore()
  const dialog = useDialog()
  const [panel, setPanel] = useState<AdventurePanel>(null)
  const [commandText, setCommandText] = useState('')
  const [consoleResponse, setConsoleResponse] = useState<{ command: string; text: string } | null>(null)
  const [narrativePlayback, setNarrativePlayback] = useState<AdventureNarrativePlayback | null>(null)
  const [commandHistory, setCommandHistory] = useState<string[]>([])
  const [historyCursor, setHistoryCursor] = useState(-1)
  const [checkpointName, setCheckpointName] = useState('')
  const [branchTitle, setBranchTitle] = useState('')
  const [localError, setLocalError] = useState('')
  const [catalogReleaseId, setCatalogReleaseId] = useState<number | null>(null)
  const playbackSessionRef = useRef<number | null>(null)
  const transcriptHydratedRef = useRef(false)
  const knownTranscriptSequencesRef = useRef<Set<number>>(new Set())
  const generatedNarrativeRef = useRef('')

  useEffect(() => {
    setCatalogReleaseId(null)
    void store.load(props.scope, props.worldGroupId, props.initialSessionId == null).then(async () => {
      if (props.initialSessionId != null) await store.select(props.initialSessionId)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.scope.projectId, props.scope.worldId, props.scope.workId, props.worldGroupId, props.initialSessionId])

  const selected = store.sessions.find(item => item.id === store.selectedSessionId) ?? null
  const catalog = useMemo(() => currentPlayerReleases(store.releases), [store.releases])
  const catalogRelease = catalog.find(item => item.release.id === catalogReleaseId) ?? null
  const adventure = store.runtimeState.adventure
  const manifest = store.selectedManifest
  const playerIdentity = useMemo(() => manifest ? resolveAdventurePlayerIdentity(manifest) : null, [manifest])
  const location = manifest?.adventure.locations.find(item => item.key === adventure?.currentLocationKey) ?? null
  const objects = useMemo(() => manifest?.adventure.objects.filter(item => item.locationKey === location?.key) ?? [], [manifest, location?.key])
  const actions = selectAdventureActions(store).filter(item => (
    !playerIdentity?.participantKey || item.action.interaction?.participantKey !== playerIdentity.participantKey
  ))
  const availableActions = actions.filter(item => item.available)
  const endingKeys = new Set((store.runtimeState.narrative?.nodes ?? []).filter(node => node.kind === 'ending').map(node => node.key))
  const endingChoices = (store.runtimeState.narrative?.choices ?? []).filter(choice => (
    endingKeys.has(choice.targetNodeKey)
      && store.runtimeState.narrative?.visibleChoiceKeys?.includes(choice.choiceKey)
      && store.runtimeState.narrative?.availableChoiceKeys?.includes(choice.choiceKey)
  ))
  const resolved = resolveRequestConfig(config, { category: 'runtime.prose.adventure-intent-parser' })
  const aiReady = isAIConfigReady(resolved.config)
  const generating = store.generatingRunId != null
  const error = localError || store.error
  const lastAction = adventure?.actionHistory[adventure.actionHistory.length - 1] ?? null
  const playerItems = adventure?.inventory.filter(item => item.ownerKey === 'player') ?? []
  const currentParticipantKeys = useMemo(() => new Set(actions
    .filter(item => item.action.locationKey === location?.key && item.action.interaction)
    .map(item => item.action.interaction!.participantKey)), [actions, location?.key])
  const currentProfiles = useMemo(() => {
    const profiles = manifest?.interaction.profiles ?? []
    const nonPlayers = profiles.filter(profile => profile.participantKey !== playerIdentity?.participantKey)
    const present = nonPlayers.filter(profile => currentParticipantKeys.has(profile.participantKey))
    return present.length ? present : nonPlayers
  }, [currentParticipantKeys, manifest?.interaction.profiles, playerIdentity?.participantKey])
  const transcript = useMemo(() => manifest && adventure
    ? projectAdventureTranscript(manifest, adventure.actionHistory, store.events)
    : [], [adventure, manifest, store.events])

  useLayoutEffect(() => {
    if (playbackSessionRef.current === store.selectedSessionId) return
    playbackSessionRef.current = store.selectedSessionId
    transcriptHydratedRef.current = false
    knownTranscriptSequencesRef.current = new Set()
    generatedNarrativeRef.current = ''
    setNarrativePlayback(null)
  }, [store.selectedSessionId])

  useLayoutEffect(() => {
    if (store.loading) return
    const sequences = new Set(transcript.map(entry => entry.eventSequence))
    if (!transcriptHydratedRef.current) {
      transcriptHydratedRef.current = true
      knownTranscriptSequencesRef.current = sequences
      return
    }
    const added = transcript.filter(entry => !knownTranscriptSequencesRef.current.has(entry.eventSequence))
    knownTranscriptSequencesRef.current = sequences
    const latestAdded = added[added.length - 1]
    if (latestAdded) setNarrativePlayback({ eventSequence: latestAdded.eventSequence, unitIndex: 0, visibleCharacters: 0 })
  }, [store.loading, store.selectedSessionId, transcript])

  useLayoutEffect(() => {
    const candidate = store.generatedNarrative
    const identity = candidate ? `${candidate.runId}:${candidate.narrative}` : ''
    if (!identity || identity === generatedNarrativeRef.current) {
      generatedNarrativeRef.current = identity
      return
    }
    generatedNarrativeRef.current = identity
    if (candidate && lastAction && candidate.evidenceEventSequences.includes(lastAction.eventSequence)) {
      setNarrativePlayback({ eventSequence: lastAction.eventSequence, unitIndex: 0, visibleCharacters: 0 })
    }
  }, [lastAction, store.generatedNarrative])

  const playbackEventSequence = narrativePlayback?.eventSequence ?? null
  const activeNarrativeUnits = useMemo(() => {
    if (playbackEventSequence == null) return []
    const entry = transcript.find(item => item.eventSequence === playbackEventSequence)
    if (!entry) return []
    const generatedText = store.generatedNarrative?.evidenceEventSequences.includes(entry.eventSequence)
      ? store.generatedNarrative.narrative
      : ''
    return sequenceNarrativeBlocks(generatedText ? parseAdventureNarrativeBlocks(generatedText) : entry.blocks)
  }, [playbackEventSequence, store.generatedNarrative, transcript])
  const activeNarrativeUnit = narrativePlayback ? activeNarrativeUnits[narrativePlayback.unitIndex] : null
  const narrativeReading = narrativePlayback != null && activeNarrativeUnit != null

  useEffect(() => {
    if (!narrativePlayback || !activeNarrativeUnit || narrativePlayback.visibleCharacters >= activeNarrativeUnit.text.length) return
    const timer = window.setTimeout(() => setNarrativePlayback(current => {
      if (!current
        || current.eventSequence !== narrativePlayback.eventSequence
        || current.unitIndex !== narrativePlayback.unitIndex) return current
      return { ...current, visibleCharacters: Math.min(activeNarrativeUnit.text.length, current.visibleCharacters + 1) }
    }), 22)
    return () => window.clearTimeout(timer)
  }, [activeNarrativeUnit, narrativePlayback])

  const run = async (action: () => Promise<unknown>) => {
    setLocalError('')
    try { await action() } catch (reason) { setLocalError(reason instanceof Error ? reason.message : String(reason)) }
  }

  const systemResponse = (command: AdventureSystemCommand): string => {
    if (!adventure || !manifest || !location) return '冒险尚未就绪。'
    if (command === 'help') return `你可以直接输入行动，例如“观察${location.title}”“询问人物”“前往下一个地点”。也可输入数字执行下方快捷指令，或输入“状态、背包、技能、任务、记录、存档”。`
    if (command === 'status') {
      const resources = Object.entries(adventure.resources).map(([key, value]) => `${manifest.adventure.resources.find(item => item.key === key)?.title ?? key} ${value}`).join('；')
      const conditions = adventure.conditions.map(item => manifest.adventure.conditions.find(value => value.key === item.conditionKey)?.title ?? item.conditionKey).join('、')
      return `当前位置：${location.title}。${resources || '暂无资源状态'}。${conditions ? `当前状态：${conditions}。` : '当前没有异常状态。'}`
    }
    if (command === 'inventory') return playerItems.length
      ? `背包：${playerItems.map(item => `${friendlyName(manifest.adventure.items.find(value => value.key === item.itemKey)?.title, item.itemKey)} ×${item.quantity}${item.state === 'equipped' ? '（已装备）' : ''}`).join('；')}。`
      : '背包是空的。调查场景、完成任务或与人物交谈可能获得物品。'
    if (command === 'skills') return `能力：${Object.entries(adventure.abilities).map(([key, value]) => `${friendlyName(manifest.adventure.abilities.find(item => item.key === key)?.title, key)} ${value}`).join('；')}。`
    if (command === 'quests') return adventure.quests.map(quest => {
      const definition = manifest.adventure.quests.find(item => item.key === quest.questKey)
      const completed = quest.objectives.filter(item => item.completed).length
      return `${definition?.title ?? quest.questKey}（${QUEST_STATUS[quest.status]}，${completed}/${quest.objectives.length}）`
    }).join('；') || '当前没有任务。'
    if (command === 'history') return transcript.length ? `已经完成 ${transcript.length} 次行动。最近一次是“${transcript[transcript.length - 1]?.actionLabel}”。` : '冒险刚刚开始，还没有行动记录。'
    setPanel('saves')
    return '已打开存档与时间线。正式行动会自动保存，也可以为当前时刻建立检查点。'
  }

  const executeAction = async (actionKey: string) => {
    if (narrativeReading) return
    setConsoleResponse(null)
    await run(() => store.act(actionKey))
  }

  const submitCommand = async (event?: FormEvent) => {
    event?.preventDefault()
    const value = commandText.trim()
    if (!value || store.busy || generating || narrativeReading) return
    setCommandHistory(current => [...current.filter(item => item !== value), value].slice(-30))
    setHistoryCursor(-1)
    setCommandText('')
    const parsed = parseAdventurePlayerCommand(value, actions)
    if (parsed.kind === 'system') {
      setConsoleResponse({ command: value, text: systemResponse(parsed.command) })
      return
    }
    if (parsed.kind === 'action') {
      if (!parsed.available) {
        setConsoleResponse({ command: value, text: parsed.reason || '这个行动当前还不能执行。' })
        return
      }
      await executeAction(parsed.action.key)
      return
    }
    if (aiReady) {
      setConsoleResponse({ command: value, text: '主 Agent 正在把这句话映射为当前世界允许的正式行动；确认后才会改变存档。' })
      await run(() => store.generateIntent(value, resolved.config))
      return
    }
    setConsoleResponse({
      command: value,
      text: parsed.suggestions.length
        ? `当前没有理解这条指令。你可以尝试：${parsed.suggestions.join('、')}。`
        : '当前没有可执行的行动。输入“状态”或“任务”检查进度。',
    })
  }

  const navigateCommandHistory = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!commandHistory.length || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
    event.preventDefault()
    const next = event.key === 'ArrowUp'
      ? Math.min(commandHistory.length - 1, historyCursor + 1)
      : Math.max(-1, historyCursor - 1)
    setHistoryCursor(next)
    setCommandText(next < 0 ? '' : commandHistory[commandHistory.length - 1 - next])
  }

  const advanceNarrative = () => {
    setNarrativePlayback(current => {
      if (!current) return current
      const unit = activeNarrativeUnits[current.unitIndex]
      if (!unit) return null
      if (current.visibleCharacters < unit.text.length) return { ...current, visibleCharacters: unit.text.length }
      if (current.unitIndex < activeNarrativeUnits.length - 1) {
        return { ...current, unitIndex: current.unitIndex + 1, visibleCharacters: 0 }
      }
      return null
    })
  }

  const removeSession = async (sessionId: number, title: string) => {
    const confirmed = await dialog.confirm({
      title: `删除冒险存档“${title}”？`, message: '该存档的事件与检查点将一起删除。', confirmText: '删除', tone: 'danger',
    })
    if (confirmed) await run(() => store.remove(sessionId))
  }

  if (store.loading && !selected) return <div className="adventure-launcher adventure-player-v2"><Loader2 className="adventure-loading" /><span>正在整理行囊…</span></div>

  if (!selected || !adventure || !manifest || !location) return <div className="adventure-launcher adventure-player-v2" data-testid="adventure-game-player">
    <div className="adventure-launcher-atmosphere" />
    <div className="adventure-launcher-content">
      <span className="adventure-kicker"><Compass /> TEXT ADVENTURE</span>
      <h2>{catalogRelease ? '冒险详情' : '文字冒险游戏库'}</h2>
      <p>{catalogRelease ? '确认地图、角色、物品、技能与任务规模，然后开始新的旅程。' : '先选择一部冒险，再从独立标题页开始旅程；角色、地图、物品、技能与任务会在进入游戏后展开。'}</p>
      {error && <div role="alert" className="adventure-alert">{error}</div>}
      {catalogRelease ? <section className="textgame-title-page adventure-title-page" aria-label="文字冒险游戏详情">
        <button type="button" className="textgame-catalog-back" onClick={() => setCatalogReleaseId(null)}><ArrowLeft />返回全部游戏</button>
        <div className="textgame-title-art" aria-hidden="true"><Compass /><span>EXPLORE<br />THE UNKNOWN</span></div>
        <div className="textgame-title-copy">
          <small>文字冒险 · 当前可玩版本</small>
          <h3>{catalogRelease.manifest?.definition.title ?? catalogRelease.release.label}</h3>
          <p>{catalogRelease.manifest?.definition.description || '一场由探索、物品、能力和任务共同推进的冒险。'}</p>
          {catalogRelease.manifest && <div className="textgame-title-stats"><span>{catalogRelease.manifest.adventure.locations.length} 个地点</span><span>{adventureNpcCount(catalogRelease.manifest)} 名可交谈角色</span><span>{catalogRelease.manifest.adventure.items.length} 件物品</span><span>{catalogRelease.manifest.adventure.abilities.length} 项技能</span><span>{catalogRelease.manifest.adventure.quests.length} 个任务</span></div>}
          {catalogRelease.error ? <p className="adventure-error">{catalogRelease.error}</p> : <div className="textgame-title-actions"><button type="button" className="textgame-start" disabled={!catalogRelease.manifest || store.busy} onClick={() => void run(() => store.start(catalogRelease.release.id!))}><Plus />开始新冒险</button>{store.sessions.find(session => session.productReleaseId === catalogRelease.release.id) && <button type="button" onClick={() => void store.select(store.sessions.find(session => session.productReleaseId === catalogRelease.release.id)!.id!)}><Save />继续上次进度</button>}</div>}
        </div>
      </section> : <>
        <div className="textgame-catalog-heading"><span>全部游戏</span><small>{catalog.length} 部可游玩作品</small></div>
        <section className="textgame-catalog-list" aria-label="文字冒险游戏列表">
          {catalog.map(item => <article key={item.release.id}><button type="button" aria-label={`查看游戏：${item.manifest?.definition.title ?? item.release.label}`} onClick={() => setCatalogReleaseId(item.release.id!)}><span className="textgame-catalog-icon"><Map /></span><span className="textgame-catalog-copy"><small>文字冒险</small><strong>{item.manifest?.definition.title ?? item.release.label}</strong><p>{item.manifest?.definition.description || '一场由探索、物品、能力和任务共同推进的冒险。'}</p>{item.manifest && <i>{item.manifest.adventure.locations.length} 地点 · {adventureNpcCount(item.manifest)} 可交谈角色 · {item.manifest.adventure.items.length} 物品 · {item.manifest.adventure.quests.length} 任务</i>}</span><span className="textgame-catalog-open">查看详情<ChevronRight /></span></button></article>)}
          {!catalog.length && <div className="adventure-empty">尚无可游玩的文字冒险。请先在作者工作台完成发布。</div>}
        </section>
        {!!store.sessions.length && <section className="adventure-launcher-saves"><h3><Save />继续冒险</h3>{store.sessions.map(session => <div key={session.id}><button onClick={() => void store.select(session.id!)}><strong>{session.title}</strong><small>{formatTime(session.updatedAt)} · 可继续</small></button><button aria-label="删除冒险存档" onClick={() => void removeSession(session.id!, session.title)}><Trash2 /></button></div>)}</section>}
      </>}
    </div>
  </div>

  return <div className="adventure-game adventure-player-v2" data-testid="adventure-game-player">
    <header className="adventure-gamebar adventure-console-bar">
      <button className="textgame-player-exit" aria-label="退出游戏" onClick={() => void store.select(null)}><ArrowLeft /><span>退出游戏</span></button>
      <div><small>{manifest.definition.title}</small><strong>{location.title}</strong></div>
      <span className="adventure-autosave"><CircleDot />自动保存已开启</span>
      <nav aria-label="冒险功能">
        <button onClick={() => setPanel('inventory')}><Backpack />背包 <b>{playerItems.reduce((sum, item) => sum + item.quantity, 0)}</b></button>
        <button onClick={() => setPanel('skills')}><WandSparkles />技能</button>
        <button onClick={() => setPanel('quests')}><ScrollText />任务</button>
        <button onClick={() => setPanel('journal')}><History />记录</button>
        <button onClick={() => setPanel('saves')}><Save />存档</button>
      </nav>
    </header>

    {error && <div role="alert" className="adventure-alert adventure-game-alert">{error}</div>}
    <main className="adventure-console-shell">
      <div className="adventure-console">
        <section className="adventure-console-prologue">
          <small>玩家身份 · {playerIdentity ? `${playerIdentity.name}（由你扮演）` : '你（唯一行动主角）'} · {selected.title}</small>
          <h1>{location.title}</h1>
          <p>{location.description}</p>
          <dl>
            <div><dt>在场</dt><dd>{currentProfiles.filter(profile => currentParticipantKeys.has(profile.participantKey)).map(profile => profile.name).join('、') || '没有可交谈的人'}</dd></div>
            <div><dt>可调查</dt><dd>{objects.map(item => friendlyName(item.title, item.key)).join('、') || '暂时没有显眼的物件'}</dd></div>
            <div><dt>状态</dt><dd>{Object.entries(adventure.resources).map(([key, value]) => `${manifest.adventure.resources.find(item => item.key === key)?.title ?? key} ${value}`).join(' · ')}</dd></div>
          </dl>
        </section>

        <section className="adventure-console-log" role="log" aria-label="冒险文字记录" aria-live="polite">
          {!transcript.length && <article className="adventure-console-system"><p>故事从这里开始。输入“帮助”查看命令，也可以直接描述你想做的事。</p></article>}
          {transcript.map(entry => {
            const generatedText = store.generatedNarrative?.evidenceEventSequences.includes(entry.eventSequence)
              ? store.generatedNarrative.narrative
              : ''
            const blocks = generatedText ? parseAdventureNarrativeBlocks(generatedText) : entry.blocks
            const playback = narrativePlayback?.eventSequence === entry.eventSequence ? narrativePlayback : null
            const sequencedBlocks = playback ? sequenceNarrativeBlocks(blocks) : blocks
            const visibleBlocks = playback
              ? sequencedBlocks.slice(0, playback.unitIndex + 1).map((block, index) => (
                index === playback.unitIndex
                  ? { ...block, text: block.text.slice(0, playback.visibleCharacters) }
                  : block
              ))
              : sequencedBlocks
            const currentUnitComplete = playback != null
              && activeNarrativeUnit != null
              && playback.visibleCharacters >= activeNarrativeUnit.text.length
            return <article className={`adventure-console-entry outcome-${entry.outcome}${playback ? ' is-playing' : ''}`} key={entry.eventSequence}>
              <header className="adventure-player-command"><span>&gt;</span><strong>{entry.actionLabel}</strong><small>你 · {ACTION_KIND[manifest.adventure.actions.find(item => item.key === entry.actionKey)?.kind ?? 'look']}</small></header>
              <div className="adventure-console-prose" aria-live={playback ? 'off' : undefined}>{visibleBlocks.map((block, index) => block.kind === 'dialogue'
                ? <blockquote className={block.speaker === playerIdentity?.name ? 'player-dialogue' : ''} key={index}><small>{block.speaker}</small><p>{block.text}{playback && index === playback.unitIndex && <span className="adventure-typewriter-caret" aria-hidden="true" />}</p></blockquote>
                : <p className={`adventure-${block.kind}`} key={index}>{block.text}{playback && index === playback.unitIndex && <span className="adventure-typewriter-caret" aria-hidden="true" />}</p>)}</div>
              {playback && <button
                type="button"
                className="adventure-narrative-continue"
                aria-label={currentUnitComplete
                  ? playback.unitIndex < sequencedBlocks.length - 1 ? '继续叙述' : '完成叙述'
                  : '显示完整句子'}
                onClick={advanceNarrative}
              >{currentUnitComplete
                  ? playback.unitIndex < sequencedBlocks.length - 1 ? '继续' : '读完本段'
                  : '跳过打字'}<ChevronRight /></button>}
              {!playback && !!entry.changes.length && <ul>{entry.changes.map((change, index) => <li key={`${entry.eventSequence}:${index}`}>{change}</li>)}</ul>}
              {!playback && entry.eventSequence === lastAction?.eventSequence && aiReady && <button className="adventure-console-polish" disabled={store.busy || generating} onClick={() => void run(() => store.narrateLastResult(resolved.config))}><Sparkles />让主 Agent 润色本次结果</button>}
            </article>
          })}
          {consoleResponse && <article className="adventure-console-entry adventure-console-response"><header className="adventure-player-command"><span>&gt;</span><strong>{consoleResponse.command}</strong><small>你 · 指令</small></header><div className="adventure-console-prose"><p className="adventure-system-response">{consoleResponse.text}</p></div></article>}
          {generating && <article className="adventure-console-system"><Loader2 /><p>主 Agent 正在理解你的行动……</p><button onClick={() => void store.cancelGeneration()}><Square />取消</button></article>}
          {store.pendingIntent && <article className="adventure-console-intent"><small>请确认行动</small><strong>{manifest.adventure.actions.find(item => item.key === store.pendingIntent?.actionKey)?.label ?? store.pendingIntent.actionKey}</strong><p>{store.pendingIntent.rationale}</p><div><button onClick={() => void run(async () => { await store.adoptPendingIntent(); setConsoleResponse(null) })}><Check />执行</button><button onClick={() => void run(() => store.rejectPendingIntent())}>取消</button></div></article>}
          {!!store.recoverableRunIds.length && <details className="adventure-console-recovery"><summary>恢复未完成的主 Agent 行动</summary><p>候选已经保存在统一 Harness 中，可以从原检查点继续，不会重复调用模型。</p>{store.recoverableRunIds.map(runId => <button key={runId} disabled={store.busy || generating} onClick={() => void run(() => store.resumeRun(runId))}>恢复行动 #{runId}</button>)}</details>}
        </section>

        {!!endingChoices.length && !store.runtimeState.narrative?.completed && <section className="adventure-console-choices"><small>最终抉择已经解锁</small>{endingChoices.map(choice => <button key={choice.choiceKey} disabled={store.busy || narrativeReading} onClick={() => void run(() => store.choose(choice.choiceKey))}>{choice.text}<ChevronRight /></button>)}</section>}
        {store.runtimeState.narrative?.completed && <section className="adventure-console-ending"><BookOpenCheck /><div><small>冒险结束</small><h2>{store.runtimeState.narrative.nodes.find(item => item.key === store.runtimeState.narrative?.endingKey)?.title}</h2><p>这条时间线已经完整保存。你可以从检查点探索另一种结果。</p></div><button onClick={() => setPanel('saves')}><GitBranch />查看时间线</button></section>}

        {!store.runtimeState.narrative?.completed && <section className={`adventure-command-center${narrativeReading ? ' is-reading' : ''}`} aria-label="冒险指令台" aria-busy={narrativeReading}>
          <header><div><small>{narrativeReading ? '故事正在继续…' : '你要做什么？'}</small><p>{narrativeReading ? '读完当前行动结果后，下一轮指令会重新开放。' : '输入自然语言命令，或选择当前可执行的文字指令。'}</p></div><span>{narrativeReading ? '正在逐句呈现' : aiReady ? '自由表达已连接主 Agent' : '离线确定性模式'}</span></header>
          <div className="adventure-command-suggestions">{availableActions.slice(0, 8).map((item, index) => <button key={item.action.key} disabled={store.busy || generating || narrativeReading} title={item.action.description} onClick={() => void executeAction(item.action.key)}><kbd>{index + 1}</kbd>{item.action.label}</button>)}</div>
          <form onSubmit={(event) => void submitCommand(event)}>
            <span>&gt;</span>
            <input aria-label="输入冒险指令" value={commandText} onChange={event => setCommandText(event.target.value)} onKeyDown={navigateCommandHistory} disabled={store.busy || generating || narrativeReading} autoComplete="off" placeholder={narrativeReading ? '请先读完当前行动结果' : `例如：观察${location.title}，或输入“帮助”`} />
            <button type="submit" disabled={!commandText.trim() || store.busy || generating || narrativeReading}><Send />执行</button>
          </form>
        </section>}
      </div>
    </main>

    <nav className="adventure-mobile-dock" aria-label="冒险快捷功能"><button onClick={() => setPanel('inventory')}><Backpack /><span>背包</span></button><button onClick={() => setPanel('skills')}><WandSparkles /><span>技能</span></button><button onClick={() => setPanel('quests')}><ScrollText /><span>任务</span></button><button onClick={() => setPanel('journal')}><History /><span>记录</span></button><button onClick={() => setPanel('saves')}><Save /><span>存档</span></button></nav>

    {panel && <div className="adventure-panel-backdrop" role="presentation"><section className="adventure-panel" aria-label={{ inventory: '背包', skills: '技能', quests: '任务', journal: '冒险记录', saves: '存档与时间线' }[panel]}><header><div><small>ADVENTURER'S JOURNAL</small><h2>{{ inventory: '背包与物品', skills: '角色能力', quests: '任务日志', journal: '冒险记录', saves: '存档与时间线' }[panel]}</h2></div><button aria-label="关闭面板" onClick={() => setPanel(null)}><X /></button></header><div className="adventure-panel-content">
      {panel === 'inventory' && <div className="adventure-inventory-grid">{playerItems.map(item => { const definition = manifest.adventure.items.find(value => value.key === item.itemKey); return <article key={`${item.itemKey}:${item.state}`}><i>{itemIcon(definition?.tags ?? [], item.itemKey)}</i><div><small>{item.state === 'equipped' ? '已装备' : definition?.consumable ? '消耗品' : '携带中'}</small><strong>{friendlyName(definition?.title, item.itemKey)}</strong><p>{friendlyDescription(definition?.description, item.itemKey, 'item')}</p></div><b>×{item.quantity}</b></article> })}{!playerItems.length && <div className="adventure-empty">背包还是空的，探索场景会找到可携带的物品。</div>}</div>}
      {panel === 'skills' && <div className="adventure-skills-grid">{Object.entries(adventure.abilities).map(([key, value]) => { const definition = manifest.adventure.abilities.find(item => item.key === key); return <article key={key}><i><WandSparkles /></i><div><small>能力等级 {value}</small><strong>{friendlyName(definition?.title, key)}</strong><p>{friendlyDescription(definition?.description, key, 'ability')}</p><span><b style={{ width: `${gauge(value, definition?.minimum ?? 0, definition?.maximum ?? 10)}%` }} /></span></div></article> })}</div>}
      {panel === 'quests' && <div className="adventure-quest-list">{adventure.quests.map(quest => { const definition = manifest.adventure.quests.find(item => item.key === quest.questKey); return <article className={`status-${quest.status}`} key={quest.questKey}><header><span>{QUEST_STATUS[quest.status]}</span><strong>{definition?.title ?? quest.questKey}</strong></header><p>{definition?.description}</p><ul>{quest.objectives.map(item => <li className={item.completed ? 'done' : ''} key={item.objectiveKey}>{item.completed ? <Check /> : <CircleDot />}{definition?.objectives.find(value => value.key === item.objectiveKey)?.title ?? item.objectiveKey}</li>)}</ul></article> })}</div>}
      {panel === 'journal' && <div className="adventure-journal">{[...adventure.actionHistory].reverse().map(item => <article key={item.eventSequence}><i>{item.eventSequence}</i><div><small>{ACTION_KIND[item.kind]} · {item.outcome === 'success' ? '成功' : item.outcome}</small><strong>{manifest.adventure.actions.find(value => value.key === item.actionKey)?.label ?? item.actionKey}</strong><p>{item.narrative}</p></div></article>)}{!adventure.actionHistory.length && <div className="adventure-empty">你的冒险还没有留下行动记录。</div>}</div>}
      {panel === 'saves' && <div className="adventure-save-panel"><section><h3><Save />保存检查点</h3><div><input value={checkpointName} onChange={event => setCheckpointName(event.target.value)} placeholder="为此刻命名" /><button disabled={!checkpointName.trim()} onClick={() => void run(async () => { await store.saveCheckpoint(checkpointName); setCheckpointName('') })}>保存</button></div></section><section><h3><GitBranch />已有检查点</h3>{store.checkpoints.map(item => <button key={item.id} onClick={() => void run(() => store.forkCheckpoint(item.id!))}><span><strong>{item.name}</strong><small>事件 #{item.throughSequence} · {formatTime(item.createdAt)}</small></span><b>从这里分支</b></button>)}{!store.checkpoints.length && <p>行动会自动保存；你也可以为重要时刻建立手动检查点。</p>}</section><section><h3><GitBranch />当前时间线分支</h3><div><input value={branchTitle} onChange={event => setBranchTitle(event.target.value)} placeholder="新时间线名称" /><button disabled={!branchTitle.trim()} onClick={() => void run(async () => { await store.forkCurrent(branchTitle); setBranchTitle(''); setPanel(null) })}>建立分支</button></div></section></div>}
    </div></section></div>}
  </div>
}
