import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from 'react'
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
  Settings2,
  Sparkles,
  Square,
  Trash2,
  Users,
  WandSparkles,
  X,
} from 'lucide-react'
import { isAIConfigReady } from '../../lib/ai/config-readiness'
import { resolveRequestConfig } from '../../lib/ai/client'
import {
  parseAdventureNarrativeBlocks,
  parseAdventurePlayerCommand,
  projectAdventureTranscript,
  isAdventureActionPlayerVisible,
  resolveAdventurePlayerIdentity,
  type AdventureNarrativeBlock,
  type AdventureSystemCommand,
} from '../../lib/adventure/player-experience'
import { adventureEffectiveAbilityValue } from '../../lib/adventure/runtime'
import { verifyProductMediaRuntimeUrlsV1 } from '../../lib/product-production/media-runtime-verifier'
import { recordProductMediaRuntimeMeasurementV1 } from '../../lib/product-production/quality-receipts'
import { currentPlayerReleases } from '../../lib/text-game/player-library'
import type { AdventureProductRuntimePackageV1, Project, WorkspaceScope } from '../../lib/types'
import { useAdventureGamePlayerStore, selectAdventureActions } from '../../stores/adventure-game-player'
import { useAIConfigStore } from '../../stores/ai-config'
import { useDialog } from '../shared/Dialog'
import './player-roadshow.css'

type AdventurePanel = 'character' | 'world' | 'inventory' | 'equipment' | 'skills' | 'quests' | 'relationships' | 'journal' | 'ending' | 'accessibility' | 'saves' | null

interface AdventureAccessibilityPreferences {
  fontScale: number
  lineHeight: number
  highContrast: boolean
  reducedMotion: boolean
}

const DEFAULT_ACCESSIBILITY: AdventureAccessibilityPreferences = {
  fontScale: 1,
  lineHeight: 1.9,
  highContrast: false,
  reducedMotion: false,
}

function initialAccessibilityPreferences(): AdventureAccessibilityPreferences {
  try {
    const stored = JSON.parse(localStorage.getItem('storyforge.text-adventure.accessibility') ?? '{}') as Partial<AdventureAccessibilityPreferences>
    return {
      fontScale: [0.9, 1, 1.15, 1.3].includes(Number(stored.fontScale)) ? Number(stored.fontScale) : 1,
      lineHeight: [1.6, 1.9, 2.2].includes(Number(stored.lineHeight)) ? Number(stored.lineHeight) : 1.9,
      highContrast: stored.highContrast === true,
      reducedMotion: stored.reducedMotion === true,
    }
  } catch { return DEFAULT_ACCESSIBILITY }
}

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

function presentationText(value: string | undefined): string {
  return (value ?? '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/gs, '$2')
    .replace(/~~(.*?)~~/gs, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/[*_~]/g, '')
    .trim()
}

function friendlyName(title: string | undefined, key: string): string {
  const value = presentationText(title)
  return !value || value.toLowerCase() === key.toLowerCase() ? COMMON_LABELS[key] ?? value ?? key : value
}

function friendlyDescription(description: string | undefined, key: string, kind: 'object' | 'item' | 'ability' | 'condition'): string {
  const value = presentationText(description)
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
    viewport: { width: Math.max(1, window.innerWidth), height: Math.max(1, window.innerHeight) },
  }
}

function adventureNpcCount(manifest: AdventureProductRuntimePackageV1): number {
  const player = resolveAdventurePlayerIdentity(manifest)
  const talkableKeys = new Set(manifest.adventure.actions.flatMap(action => (
    action.kind === 'talk' && action.interaction && isAdventureActionPlayerVisible(manifest, action)
      ? [action.interaction.participantKey] : []
  )))
  return manifest.interaction.profiles.filter(profile => (
    talkableKeys.has(profile.participantKey)
    && profile.participantKey !== player?.participantKey
    && !profile.characterKey.startsWith('generated:')
    && !/^产品角色\s*\d+$/u.test(profile.name.trim())
  )).length
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
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({})
  const [mediaFailures, setMediaFailures] = useState<Array<{ assetKey: string; reason: string }>>([])
  const [accessibility, setAccessibility] = useState<AdventureAccessibilityPreferences>(initialAccessibilityPreferences)
  const playbackSessionRef = useRef<number | null>(null)
  const transcriptHydratedRef = useRef(false)
  const knownTranscriptSequencesRef = useRef<Set<number>>(new Set())
  const generatedNarrativeRef = useRef('')
  const mediaVerificationKeys = useRef(new Set<string>())

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
  const adventureV2 = manifest?.adventure.version === 2 ? manifest.adventure : null
  const questGroups = ([
    { key: 'main', title: '主线任务' },
    { key: 'side', title: '支线任务' },
    { key: 'ambient', title: '区域事件' },
  ] as const).map(group => ({
    ...group,
    quests: (adventure?.quests ?? []).filter(quest => {
      const definition = manifest?.adventure.quests.find(item => item.key === quest.questKey)
      const category = definition && 'category' in definition ? definition.category : 'main'
      return category === group.key
    }),
  })).filter(group => group.quests.length > 0)
  const playerIdentity = useMemo(() => manifest ? resolveAdventurePlayerIdentity(manifest) : null, [manifest])
  const location = manifest?.adventure.locations.find(item => item.key === adventure?.currentLocationKey) ?? null
  const locationTitle = presentationText(location?.title)
  const objects = useMemo(() => manifest?.adventure.objects.filter(item => item.locationKey === location?.key) ?? [], [manifest, location?.key])
  const actions = selectAdventureActions(store)
  const availableActions = actions.filter(item => item.available)
  const commandSuggestions = availableActions.filter(item => item.action.narrativeChoiceKey == null).slice(0, 8)
  const narrativeActionByChoice = new globalThis.Map(actions
    .filter(item => item.action.narrativeChoiceKey)
    .map(item => [item.action.narrativeChoiceKey!, item]))
  const endingKeys = new Set((store.runtimeState.narrative?.nodes ?? []).filter(node => node.kind === 'ending').map(node => node.key))
  const narrativeChoices = (store.runtimeState.narrative?.choices ?? []).filter(choice => (
    choice.sourceNodeKey === store.runtimeState.narrative?.currentNodeKey
      && store.runtimeState.narrative?.visibleChoiceKeys?.includes(choice.choiceKey)
      && store.runtimeState.narrative?.availableChoiceKeys?.includes(choice.choiceKey)
  ))
  const endingChoices = narrativeChoices.filter(choice => endingKeys.has(choice.targetNodeKey))
  const progressionChoices = narrativeChoices.filter(choice => !endingKeys.has(choice.targetNodeKey))
  const resolved = resolveRequestConfig(config, { category: 'runtime.prose.adventure-intent-parser' })
  const aiReady = isAIConfigReady(resolved.config)
  const generating = store.generatingRunId != null
  const error = localError || store.error
  const lastAction = adventure?.actionHistory[adventure.actionHistory.length - 1] ?? null
  const playerItems = adventure?.inventory.filter(item => item.ownerKey === 'player') ?? []
  const currentArea = adventureV2?.areas.find(item => item.key === adventureV2.locations.find(location => location.key === adventure?.currentLocationKey)?.areaKey) ?? null
  const currentRegion = adventureV2?.regions.find(item => item.key === currentArea?.regionKey) ?? null
  const clockValue = adventureV2 && adventure ? adventure.resources[adventureV2.clock.resourceKey] : null
  const clockInitial = adventureV2?.resources.find(item => item.key === adventureV2.clock.resourceKey)?.initial ?? null
  const elapsedMinutes = clockValue != null && clockInitial != null ? Math.max(0, clockValue - clockInitial) : null
  const currentNarrativeBeatKeys = new Set((manifest?.narrative.beats ?? [])
    .filter(beat => beat.nodeKey === store.runtimeState.narrative?.currentNodeKey)
    .map(beat => beat.beatKey))
  const currentIllustrationAsset = manifest?.presentation?.cues
    .filter(cue => currentNarrativeBeatKeys.has(cue.beatKey) && cue.assetKey)
    .map(cue => manifest.presentation?.assets.find(asset => asset.assetKey === cue.assetKey))
    .find(asset => asset?.kind === 'background' || asset?.kind === 'cg')
    ?? manifest?.presentation?.assets.find(asset => asset.kind === 'background' || asset.kind === 'cg')
  const characterPortraitAsset = manifest?.presentation?.assets.find(asset => (
    asset.kind === 'character-pose' || asset.kind === 'character-expression'
  ))
  const visibleAbilities = manifest && adventure
    ? manifest.adventure.abilities.map(definition => ({
        definition,
        base: adventure.abilities[definition.key] ?? definition.initial,
        effective: adventureEffectiveAbilityValue(manifest.adventure, adventure, definition.key),
      }))
    : []
  const abilityRole = (abilityKey: string) => adventureV2?.abilities.find(item => item.key === abilityKey)?.role ?? null
  const currentParticipantKeys = useMemo(() => new Set(actions
    .filter(item => item.action.locationKey === location?.key && item.action.interaction)
    .map(item => item.action.interaction!.participantKey)), [actions, location?.key])
  const currentProfiles = useMemo(() => {
    const profiles = manifest?.interaction.profiles ?? []
    return profiles.filter(profile => (
      currentParticipantKeys.has(profile.participantKey)
      && profile.participantKey !== playerIdentity?.participantKey
      && !profile.characterKey.startsWith('generated:')
      && !/^产品角色\s*\d+$/u.test(profile.name.trim())
    ))
  }, [currentParticipantKeys, manifest?.interaction.profiles, playerIdentity?.participantKey])
  const relationshipProfiles = useMemo(() => (manifest?.interaction.profiles ?? []).map(profile => ({
    profile,
    values: (store.runtimeState.interaction?.relationships ?? []).filter(relationship => (
      relationship.fromParticipantKey === profile.participantKey
      && relationship.toParticipantKey === (store.runtimeState.interaction?.playerKey ?? 'player')
    )),
    changes: (store.runtimeState.interaction?.relationshipHistory ?? []).filter(change => (
      change.fromParticipantKey === profile.participantKey
      && change.toParticipantKey === (store.runtimeState.interaction?.playerKey ?? 'player')
    )),
  })), [manifest?.interaction.profiles, store.runtimeState.interaction])
  const endingJourney = useMemo(() => (store.runtimeState.narrative?.choiceHistory ?? []).map(history => {
    const choice = manifest?.narrative.choices.find(item => item.choiceKey === history.choiceKey)
    const target = manifest?.narrative.nodes.find(item => item.key === history.toNodeKey)
    return { ...history, label: presentationText(choice?.text) || history.choiceKey, targetTitle: presentationText(target?.title) || history.toNodeKey }
  }), [manifest?.narrative.choices, manifest?.narrative.nodes, store.runtimeState.narrative?.choiceHistory])
  const transcript = useMemo(() => manifest && adventure
    ? projectAdventureTranscript(manifest, adventure.actionHistory, store.events)
    : [], [adventure, manifest, store.events])
  const mediaCacheKey = `${store.selectedSessionId ?? 'title'}:${manifest?.presentation?.assets
    .map(asset => `${asset.assetKey}@${asset.version}:${asset.contentHash}`).join('|') ?? ''}`

  useEffect(() => {
    localStorage.setItem('storyforge.text-adventure.accessibility', JSON.stringify(accessibility))
  }, [accessibility])

  useEffect(() => {
    let active = true
    setMediaUrls({})
    setMediaFailures([])
    const assets = manifest?.presentation?.assets ?? []
    if (!assets.length || store.selectedSessionId == null) return () => { active = false }
    void store.preloadMedia().then(result => {
      if (active) {
        setMediaUrls(result.urls)
        setMediaFailures(result.failures)
      }
      if (selected?.productBuildId == null) return
      const verificationKey = `${selected.productBuildId}:${assets
        .map(asset => `${asset.assetKey}:${asset.contentHash}`).sort().join('|')}`
      if (mediaVerificationKeys.current.has(verificationKey)) return
      mediaVerificationKeys.current.add(verificationKey)
      void verifyProductMediaRuntimeUrlsV1({
        assets: assets.map(asset => ({
          assetKey: asset.assetKey, contentHash: asset.contentHash, mimeType: asset.mimeType,
          width: asset.width, height: asset.height, durationMs: asset.durationMs,
        })),
        urls: result.urls,
        environment: currentBrowserEnvironment(),
      }).then(measurement => recordProductMediaRuntimeMeasurementV1({
        scope: props.scope, productBuildId: selected.productBuildId!, measurement,
      })).then(verified => {
        if (!verified.evidence.passed) mediaVerificationKeys.current.delete(verificationKey)
      }).catch(() => {
        // The visible pure-text fallback remains authoritative. A failed or
        // interrupted measurement may be retried when this Preview is reopened.
        mediaVerificationKeys.current.delete(verificationKey)
      })
    }).catch(reason => {
      if (active) setMediaFailures([{ assetKey: 'presentation', reason: reason instanceof Error ? reason.message : String(reason) }])
    })
    return () => { active = false }
  // The store owns resolver disposal; URLs remain valid across action refreshes in the same session.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaCacheKey, props.scope.projectId, props.scope.worldId, props.scope.workId])

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
    if (command === 'help') return `你可以直接输入行动，例如“观察${locationTitle}”“询问人物”“前往下一个地点”。也可输入数字执行下方快捷指令，或输入“状态、背包、技能、任务、记录、存档”。`
    if (command === 'status') {
      const resources = Object.entries(adventure.resources).map(([key, value]) => `${manifest.adventure.resources.find(item => item.key === key)?.title ?? key} ${value}`).join('；')
      const conditions = adventure.conditions.map(item => manifest.adventure.conditions.find(value => value.key === item.conditionKey)?.title ?? item.conditionKey).join('、')
      return `当前位置：${locationTitle}。${resources || '暂无资源状态'}。${conditions ? `当前状态：${conditions}。` : '当前没有异常状态。'}`
    }
    if (command === 'inventory') return playerItems.length
      ? `背包：${playerItems.map(item => `${friendlyName(manifest.adventure.items.find(value => value.key === item.itemKey)?.title, item.itemKey)} ×${item.quantity}${item.state === 'equipped' ? '（已装备）' : ''}`).join('；')}。`
      : '背包是空的。调查场景、完成任务或与人物交谈可能获得物品。'
    if (command === 'skills') return `能力：${visibleAbilities.map(item => `${friendlyName(item.definition.title, item.definition.key)} ${item.effective}${item.effective !== item.base ? `（基础 ${item.base}）` : ''}`).join('；')}。`
    if (command === 'quests') return adventure.quests.map(quest => {
      const definition = manifest.adventure.quests.find(item => item.key === quest.questKey)
      const completed = quest.objectives.filter(item => item.completed).length
      return `${presentationText(definition?.title) || quest.questKey}（${QUEST_STATUS[quest.status]}，${completed}/${quest.objectives.length}）`
    }).join('；') || '当前没有任务。'
    if (command === 'history') return transcript.length ? `已经完成 ${transcript.length} 次行动。最近一次是“${transcript[transcript.length - 1]?.actionLabel}”。` : '冒险刚刚开始，还没有行动记录。'
    setPanel('saves')
    return '已打开存档与时间线。正式行动会自动保存，也可以为当前时刻建立检查点。'
  }

  const executeAction = async (actionKey: string) => {
    if (narrativeReading) return
    setConsoleResponse(null)
    const entry = actions.find(item => item.action.key === actionKey)
    if (!entry?.available) {
      setConsoleResponse({ command: actionKey, text: entry?.reason || '这个行动当前还不能执行。' })
      return
    }
    await run(() => entry.action.narrativeChoiceKey
      ? store.choose(entry.action.narrativeChoiceKey)
      : store.act(entry.action.key))
  }

  const submitCommand = async (event?: FormEvent) => {
    event?.preventDefault()
    const value = commandText.trim()
    if (!value || store.busy || generating || narrativeReading) return
    setCommandHistory(current => [...current.filter(item => item !== value), value].slice(-30))
    setHistoryCursor(-1)
    setCommandText('')
    const parsed = parseAdventurePlayerCommand(value, /^\d+$/.test(value) ? commandSuggestions : actions)
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
          <h3>{presentationText(catalogRelease.manifest?.definition.title) || catalogRelease.release.label}</h3>
          <p>{presentationText(catalogRelease.manifest?.definition.description) || '一场由探索、物品、能力和任务共同推进的冒险。'}</p>
          {catalogRelease.manifest && <div className="textgame-title-stats"><span>{catalogRelease.manifest.adventure.locations.length} 个地点</span><span>{adventureNpcCount(catalogRelease.manifest)} 名可交谈角色</span><span>{catalogRelease.manifest.adventure.items.length} 件物品</span><span>{catalogRelease.manifest.adventure.abilities.length} 项技能</span><span>{catalogRelease.manifest.adventure.quests.length} 个任务</span></div>}
          {catalogRelease.error ? <p className="adventure-error">{catalogRelease.error}</p> : <div className="textgame-title-actions"><button type="button" className="textgame-start" disabled={!catalogRelease.manifest || store.busy} onClick={() => void run(() => store.start(catalogRelease.release.id!))}><Plus />开始新冒险</button>{store.sessions.find(session => session.productReleaseId === catalogRelease.release.id) && <button type="button" onClick={() => void store.select(store.sessions.find(session => session.productReleaseId === catalogRelease.release.id)!.id!)}><Save />继续上次进度</button>}</div>}
        </div>
      </section> : <>
        <div className="textgame-catalog-heading"><span>全部游戏</span><small>{catalog.length} 部可游玩作品</small></div>
        <section className="textgame-catalog-list" aria-label="文字冒险游戏列表">
          {catalog.map(item => <article key={item.release.id}><button type="button" aria-label={`查看游戏：${presentationText(item.manifest?.definition.title) || item.release.label}`} onClick={() => setCatalogReleaseId(item.release.id!)}><span className="textgame-catalog-icon"><Map /></span><span className="textgame-catalog-copy"><small>文字冒险</small><strong>{presentationText(item.manifest?.definition.title) || item.release.label}</strong><p>{presentationText(item.manifest?.definition.description) || '一场由探索、物品、能力和任务共同推进的冒险。'}</p>{item.manifest && <i>{item.manifest.adventure.locations.length} 地点 · {adventureNpcCount(item.manifest)} 可交谈角色 · {item.manifest.adventure.items.length} 物品 · {item.manifest.adventure.quests.length} 任务</i>}</span><span className="textgame-catalog-open">查看详情<ChevronRight /></span></button></article>)}
          {!catalog.length && <div className="adventure-empty">尚无可游玩的文字冒险。请先在作者工作台完成发布。</div>}
        </section>
        {!!store.sessions.length && <section className="adventure-launcher-saves"><h3><Save />继续冒险</h3>{store.sessions.map(session => <div key={session.id}><button onClick={() => void store.select(session.id!)}><strong>{session.title}</strong><small>{formatTime(session.updatedAt)} · 可继续</small></button><button aria-label="删除冒险存档" onClick={() => void removeSession(session.id!, session.title)}><Trash2 /></button></div>)}</section>}
      </>}
    </div>
  </div>

  return <div
    className={`adventure-game adventure-player-v2${accessibility.highContrast ? ' adventure-high-contrast' : ''}${accessibility.reducedMotion ? ' adventure-reduced-motion' : ''}`}
    style={{
      '--adventure-font-scale': accessibility.fontScale,
      '--adventure-line-height': accessibility.lineHeight,
    } as CSSProperties}
    data-testid="adventure-game-player"
  >
    <header className="adventure-gamebar adventure-console-bar">
      <button className="textgame-player-exit" aria-label="退出游戏" onClick={() => void store.select(null)}><ArrowLeft /><span>退出游戏</span></button>
      <div><small>{presentationText(manifest.definition.title)}</small><strong>{locationTitle}</strong></div>
      <span className="adventure-autosave"><CircleDot />自动保存已开启</span>
      <nav aria-label="冒险功能">
        {adventureV2 && <button onClick={() => setPanel('character')}><CircleDot />角色</button>}
        {adventureV2 && <button onClick={() => setPanel('world')}><Map />地图</button>}
        <button onClick={() => setPanel('inventory')}><Backpack />背包 <b>{playerItems.reduce((sum, item) => sum + item.quantity, 0)}</b></button>
        {adventureV2 && <button onClick={() => setPanel('equipment')}><Gem />装备</button>}
        <button onClick={() => setPanel('skills')}><WandSparkles />技能</button>
        <button onClick={() => setPanel('quests')}><ScrollText />任务</button>
        {adventureV2 && <button onClick={() => setPanel('relationships')}><Users />关系</button>}
        <button onClick={() => setPanel('journal')}><History />记录</button>
        <button onClick={() => setPanel('accessibility')}><Settings2 />显示</button>
        <button onClick={() => setPanel('saves')}><Save />存档</button>
      </nav>
    </header>

    {error && <div role="alert" className="adventure-alert adventure-game-alert">{error}</div>}
    <main className="adventure-console-shell">
      <div className="adventure-console">
        {currentIllustrationAsset && mediaUrls[currentIllustrationAsset.assetKey] && <figure className="adventure-scene-illustration">
          <img src={mediaUrls[currentIllustrationAsset.assetKey]} alt={currentIllustrationAsset.altText} />
          <figcaption>{currentIllustrationAsset.name}</figcaption>
        </figure>}
        {!!mediaFailures.length && <details className="adventure-media-fallback"><summary>插图已降级为纯文字</summary><p>{mediaFailures.map(item => `${item.assetKey}：${item.reason}`).join('；')}</p></details>}
        <section className="adventure-console-prologue">
          <small>玩家身份 · {playerIdentity ? `${playerIdentity.name}（由你扮演）` : '你（唯一行动主角）'} · {selected.title}</small>
          <h1>{locationTitle}</h1>
          <p>{presentationText(location.description)}</p>
          <dl>
            <div><dt>在场</dt><dd>{currentProfiles.filter(profile => currentParticipantKeys.has(profile.participantKey)).map(profile => profile.name).join('、') || '没有可交谈的人'}</dd></div>
            <div><dt>可调查</dt><dd>{objects.map(item => friendlyName(item.title, item.key)).join('、') || '暂时没有显眼的物件'}</dd></div>
            <div><dt>状态</dt><dd>{Object.entries(adventure.resources).filter(([key]) => adventureV2?.resources.find(item => item.key === key)?.role !== 'clock').map(([key, value]) => `${manifest.adventure.resources.find(item => item.key === key)?.title ?? key} ${value}`).join(' · ')}</dd></div>
            {adventureV2 && <div><dt>区域</dt><dd>{[currentRegion?.title, currentArea?.title].map(presentationText).filter(Boolean).join(' · ') || '未标记区域'}{elapsedMinutes != null ? ` · ${presentationText(adventureV2.clock.startLabel)} +${elapsedMinutes} 分钟` : ''}</dd></div>}
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
              <header className="adventure-player-command"><span>&gt;</span><strong>{presentationText(entry.actionLabel)}</strong><small>你 · {ACTION_KIND[manifest.adventure.actions.find(item => item.key === entry.actionKey)?.kind ?? 'look']}</small></header>
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
          {store.pendingIntent && <article className="adventure-console-intent"><small>请确认行动</small><strong>{presentationText(manifest.adventure.actions.find(item => item.key === store.pendingIntent?.actionKey)?.label) || store.pendingIntent.actionKey}</strong><p>{presentationText(store.pendingIntent.rationale)}</p><div><button onClick={() => void run(async () => { await store.adoptPendingIntent(); setConsoleResponse(null) })}><Check />执行</button><button onClick={() => void run(() => store.rejectPendingIntent())}>取消</button></div></article>}
          {!!store.recoverableRunIds.length && <details className="adventure-console-recovery"><summary>恢复未完成的主 Agent 行动</summary><p>候选已经保存在统一 Harness 中，可以从原检查点继续，不会重复调用模型。</p>{store.recoverableRunIds.map(runId => <button key={runId} disabled={store.busy || generating} onClick={() => void run(() => store.resumeRun(runId))}>恢复行动 #{runId}</button>)}</details>}
        </section>

        {!!progressionChoices.length && !store.runtimeState.narrative?.completed && <section className="adventure-console-choices"><small>关键推进已经解锁</small>{progressionChoices.map(choice => { const action = narrativeActionByChoice.get(choice.choiceKey); return <button key={choice.choiceKey} title={action && !action.available ? presentationText(action.reason) : undefined} disabled={store.busy || narrativeReading || (action != null && !action.available)} onClick={() => void run(() => store.choose(choice.choiceKey))}>{presentationText(choice.text)}<ChevronRight /></button> })}</section>}
        {!!endingChoices.length && !store.runtimeState.narrative?.completed && <section className="adventure-console-choices"><small>最终抉择已经解锁</small>{endingChoices.map(choice => { const action = narrativeActionByChoice.get(choice.choiceKey); return <button key={choice.choiceKey} title={action && !action.available ? presentationText(action.reason) : undefined} disabled={store.busy || narrativeReading || (action != null && !action.available)} onClick={() => void run(() => store.choose(choice.choiceKey))}>{presentationText(choice.text)}<ChevronRight /></button> })}</section>}
        {store.runtimeState.narrative?.completed && <section className="adventure-console-ending"><BookOpenCheck /><div><small>冒险结束</small><h2>{store.runtimeState.narrative.nodes.find(item => item.key === store.runtimeState.narrative?.endingKey)?.title}</h2><p>这条时间线已经完整保存。你可以回顾关键决定，或从检查点探索另一种结果。</p></div><span><button onClick={() => setPanel('ending')}><BookOpenCheck />结局因果</button><button onClick={() => setPanel('saves')}><GitBranch />查看时间线</button></span></section>}

        {!store.runtimeState.narrative?.completed && <section className={`adventure-command-center${narrativeReading ? ' is-reading' : ''}`} aria-label="冒险指令台" aria-busy={narrativeReading}>
          <header><div><small>{narrativeReading ? '故事正在继续…' : '你要做什么？'}</small><p>{narrativeReading ? '读完当前行动结果后，下一轮指令会重新开放。' : '输入自然语言命令，或选择当前可执行的文字指令。'}</p></div><span>{narrativeReading ? '正在逐句呈现' : aiReady ? '自由表达已连接主 Agent' : '离线确定性模式'}</span></header>
          <div className="adventure-command-suggestions">{commandSuggestions.map((item, index) => <button key={item.action.key} disabled={store.busy || generating || narrativeReading} title={presentationText(item.action.description)} onClick={() => void executeAction(item.action.key)}><kbd>{index + 1}</kbd>{presentationText(item.action.label)}</button>)}</div>
          <form onSubmit={(event) => void submitCommand(event)}>
            <span>&gt;</span>
            <input aria-label="输入冒险指令" value={commandText} onChange={event => setCommandText(event.target.value)} onKeyDown={navigateCommandHistory} disabled={store.busy || generating || narrativeReading} autoComplete="off" placeholder={narrativeReading ? '请先读完当前行动结果' : `例如：观察${locationTitle}，或输入“帮助”`} />
            <button type="submit" disabled={!commandText.trim() || store.busy || generating || narrativeReading}><Send />执行</button>
          </form>
        </section>}
      </div>
    </main>

    <nav className="adventure-mobile-dock" aria-label="冒险快捷功能"><button onClick={() => setPanel(adventureV2 ? 'character' : 'inventory')}>{adventureV2 ? <CircleDot /> : <Backpack />}<span>{adventureV2 ? '角色' : '背包'}</span></button><button onClick={() => setPanel('inventory')}><Backpack /><span>背包</span></button><button onClick={() => setPanel('skills')}><WandSparkles /><span>技能</span></button><button onClick={() => setPanel('quests')}><ScrollText /><span>任务</span></button><button onClick={() => setPanel('saves')}><Save /><span>存档</span></button></nav>

    {panel && <div className="adventure-panel-backdrop" role="presentation"><section className="adventure-panel" aria-label={{ character: '角色状态', world: '区域地图', inventory: '背包', equipment: '装备', skills: '技能', quests: '任务', relationships: '人物关系', journal: '冒险记录', ending: '结局因果回顾', accessibility: '阅读与可访问性', saves: '存档与时间线' }[panel]}><header><div><small>ADVENTURER'S JOURNAL</small><h2>{{ character: '角色状态', world: '区域与地点', inventory: '背包与物品', equipment: '装备栏', skills: '角色能力', quests: '任务日志', relationships: '人物关系', journal: '冒险记录', ending: '结局因果回顾', accessibility: '阅读与可访问性', saves: '存档与时间线' }[panel]}</h2></div><button aria-label="关闭面板" onClick={() => setPanel(null)}><X /></button></header><div className="adventure-panel-content">
      {panel === 'character' && adventureV2 && <div className="adventure-system-grid"><article>{characterPortraitAsset && mediaUrls[characterPortraitAsset.assetKey] && <figure className="adventure-panel-portrait"><img src={mediaUrls[characterPortraitAsset.assetKey]} alt={characterPortraitAsset.altText} /></figure>}<small>身份与成长</small><strong>{playerIdentity?.name ?? '玩家'} · 等级 {adventure.abilities[adventureV2.progression.levelAbilityKey] ?? 1}</strong><p>{playerIdentity?.description}</p><dl>{adventureV2.resources.filter(item => item.role !== 'clock').map(item => <div key={item.key}><dt>{item.title}</dt><dd>{adventure.resources[item.key]} / {item.maximum}</dd></div>)}</dl></article><article><small>基础属性</small><dl>{visibleAbilities.filter(item => abilityRole(item.definition.key) === 'stat').map(item => <div key={item.definition.key}><dt>{item.definition.title}</dt><dd>{item.effective}{item.effective !== item.base ? `（装备 +${item.effective - item.base}）` : ''}</dd></div>)}</dl></article></div>}
      {panel === 'world' && adventureV2 && <div className="adventure-system-grid">{adventureV2.regions.map(region => <article key={region.key}><small>{region.key === currentRegion?.key ? '当前大区域' : '大区域'}</small><strong>{region.title}</strong><p>{region.description}</p>{adventureV2.areas.filter(area => area.regionKey === region.key).map(area => <section key={area.key}><b>{area.title}</b>{adventureV2.locations.filter(item => item.areaKey === area.key).map((item, index) => { const move = actions.find(candidate => candidate.available && candidate.action.kind === 'move' && candidate.action.targetKey === item.key); const revealed = item.key === adventure.currentLocationKey || adventure.visitedLocationKeys.includes(item.key) || move != null; return <span className="adventure-map-location" key={item.key}><i>{item.key === adventure.currentLocationKey ? '●' : adventure.visitedLocationKeys.includes(item.key) ? '○' : '◇'}</i>{revealed ? item.title : `未探索地点 ${index + 1}`}{move && item.key !== adventure.currentLocationKey && <button onClick={() => void executeAction(move.action.key)}>前往</button>}</span> })}</section>)}</article>)}</div>}
      {panel === 'inventory' && <div className="adventure-inventory-grid">{playerItems.map(item => { const definition = manifest.adventure.items.find(value => value.key === item.itemKey); const itemActions = actions.filter(candidate => candidate.available && candidate.action.targetKey === item.itemKey && ['use', 'give'].includes(candidate.action.kind)); return <article key={`${item.itemKey}:${item.state}`}><i>{itemIcon(definition?.tags ?? [], item.itemKey)}</i><div><small>{item.state === 'equipped' ? '已装备' : definition?.consumable ? '消耗品' : '携带中'}</small><strong>{friendlyName(definition?.title, item.itemKey)}</strong><p>{friendlyDescription(definition?.description, item.itemKey, 'item')}</p>{itemActions.length > 0 && <span className="adventure-item-actions">{itemActions.map(action => <button key={action.action.key} onClick={() => void executeAction(action.action.key)}>{presentationText(action.action.label)}</button>)}</span>}</div><b>×{item.quantity}</b></article> })}{!playerItems.length && <div className="adventure-empty">背包还是空的，探索场景会找到可携带的物品。</div>}</div>}
      {panel === 'equipment' && adventureV2 && <div className="adventure-system-grid">{adventureV2.equipmentSlots.map(slot => { const entry = playerItems.find(item => item.state === 'equipped' && adventureV2.items.find(definition => definition.key === item.itemKey)?.equipmentSlotKey === slot.key); const definition = entry ? adventureV2.items.find(item => item.key === entry.itemKey) : null; const availableEquipment = playerItems.filter(item => item.state !== 'equipped' && adventureV2.items.find(candidate => candidate.key === item.itemKey)?.equipmentSlotKey === slot.key); const selectedAction = entry ? actions.find(candidate => candidate.available && candidate.action.key.startsWith('action.unequip.') && candidate.action.targetKey === entry.itemKey) : availableEquipment.map(item => actions.find(candidate => candidate.available && candidate.action.key.startsWith('action.equip.') && candidate.action.targetKey === item.itemKey)).find(Boolean); return <article key={slot.key}><small>{slot.title}</small><strong>{definition?.title ?? '未装备'}</strong><p>{definition?.description ?? `可放置带有 ${slot.acceptsTags.join('、') || '兼容'} 标签的装备。`}</p>{definition?.modifiers.map(modifier => <span key={modifier.abilityKey}>{adventureV2.abilities.find(item => item.key === modifier.abilityKey)?.title ?? modifier.abilityKey} {modifier.delta > 0 ? '+' : ''}{modifier.delta}</span>)}{selectedAction && <button className="adventure-panel-action" onClick={() => void executeAction(selectedAction.action.key)}>{presentationText(selectedAction.action.label)}</button>}</article> })}</div>}
      {panel === 'skills' && <div className="adventure-skills-grid">{visibleAbilities.filter(item => !adventureV2 || abilityRole(item.definition.key) === 'skill').map(({ definition, base, effective }) => <article key={definition.key}><i><WandSparkles /></i><div><small>能力等级 {effective}{effective !== base ? ` · 基础 ${base}` : ''}</small><strong>{friendlyName(definition.title, definition.key)}</strong><p>{friendlyDescription(definition.description, definition.key, 'ability')}</p><span><b style={{ width: `${gauge(effective, definition.minimum, definition.maximum)}%` }} /></span></div></article>)}</div>}
      {panel === 'quests' && <div className="adventure-quest-list">{questGroups.map(group => <section className="adventure-quest-group" key={group.key}><h3>{group.title}<span>{group.quests.length}</span></h3>{group.quests.map(quest => { const definition = manifest.adventure.quests.find(item => item.key === quest.questKey); const activeObjective = quest.objectives.find(item => !item.completed && !item.optional) ?? quest.objectives.find(item => !item.completed); const activeDefinition = definition?.objectives.find(item => item.key === activeObjective?.objectiveKey); const activeStage = adventureV2?.quests.find(item => item.key === quest.questKey)?.stages.find(stage => stage.objectiveKeys.includes(activeObjective?.objectiveKey ?? '')); const actionLocationKey = activeDefinition?.alternativeActionKeys.map(actionKey => manifest.adventure.actions.find(action => action.key === actionKey)?.locationKey).find(Boolean); const actionLocation = manifest.adventure.locations.find(item => item.key === actionLocationKey); return <article className={'status-' + quest.status} key={quest.questKey}><header><span>{QUEST_STATUS[quest.status]}</span><strong>{definition?.title ?? quest.questKey}</strong></header><p>{definition?.description}</p>{activeObjective && <div className="adventure-quest-current"><small>{activeStage ? '当前阶段 · ' + activeStage.title : '当前目标'}</small><b>{activeDefinition?.title ?? activeObjective.objectiveKey}</b>{actionLocation && <span>地点：{actionLocation.title}</span>}</div>}<ul>{quest.objectives.map(item => <li className={item.completed ? 'done' : ''} key={item.objectiveKey}>{item.completed ? <Check /> : <CircleDot />}{definition?.objectives.find(value => value.key === item.objectiveKey)?.title ?? item.objectiveKey}</li>)}</ul></article>})}</section>)}</div>}
      {panel === 'relationships' && <div className="adventure-system-grid">{relationshipProfiles.map(({ profile, values, changes }) => <article key={profile.participantKey}><small>{profile.roleLabel || '同行者'}</small><strong>{profile.name}</strong><p>{values.length ? '关系由玩家行动的正式事件推进。' : '尚未形成可量化的关系变化。'}</p>{values.map(value => <dl key={`${value.dimensionKey}:${value.toParticipantKey}`}><div><dt>{value.label}</dt><dd>{value.value}</dd></div></dl>)}{changes.slice(-2).map(change => <span key={change.eventSequence}>{change.delta > 0 ? '+' : ''}{change.delta} · {change.reason}</span>)}</article>)}{!relationshipProfiles.length && <div className="adventure-empty">当前发布包没有可互动角色。</div>}</div>}
      {panel === 'ending' && <div className="adventure-ending-review"><header><small>抵达结局</small><strong>{store.runtimeState.narrative?.nodes.find(item => item.key === store.runtimeState.narrative?.endingKey)?.title ?? '尚未抵达结局'}</strong><p>以下只引用这条时间线已提交的选择与行动，不由 AI 临时补写。</p></header>{endingJourney.map((item, index) => <article key={item.eventSequence}><i>{index + 1}</i><div><small>选择 #{item.eventSequence}</small><strong>{item.label}</strong><p>进入：{item.targetTitle}</p></div></article>)}{!!adventure.conditions.length && <section><small>持久后果</small>{adventure.conditions.map(condition => <span key={`${condition.conditionKey}:${condition.appliedSequence}`}>{manifest.adventure.conditions.find(item => item.key === condition.conditionKey)?.title ?? condition.conditionKey}</span>)}</section>}{!endingJourney.length && <div className="adventure-empty">完成冒险后，这里会列出抵达结局的关键决定链。</div>}</div>}
      {panel === 'accessibility' && <div className="adventure-accessibility"><label><span>正文字号</span><select aria-label="正文字号" value={accessibility.fontScale} onChange={event => setAccessibility(current => ({ ...current, fontScale: Number(event.target.value) }))}><option value={0.9}>较小</option><option value={1}>标准</option><option value={1.15}>较大</option><option value={1.3}>特大</option></select></label><label><span>正文行距</span><select aria-label="正文行距" value={accessibility.lineHeight} onChange={event => setAccessibility(current => ({ ...current, lineHeight: Number(event.target.value) }))}><option value={1.6}>紧凑</option><option value={1.9}>标准</option><option value={2.2}>宽松</option></select></label><label><span>高对比度</span><input type="checkbox" checked={accessibility.highContrast} onChange={event => setAccessibility(current => ({ ...current, highContrast: event.target.checked }))} /></label><label><span>减少动态效果</span><input type="checkbox" checked={accessibility.reducedMotion} onChange={event => setAccessibility(current => ({ ...current, reducedMotion: event.target.checked }))} /></label><button onClick={() => setAccessibility(DEFAULT_ACCESSIBILITY)}>恢复默认</button></div>}
      {panel === 'journal' && <div className="adventure-journal">{[...adventure.actionHistory].reverse().map(item => <article key={item.eventSequence}><i>{item.eventSequence}</i><div><small>{ACTION_KIND[item.kind]} · {item.outcome === 'success' ? '成功' : item.outcome}</small><strong>{manifest.adventure.actions.find(value => value.key === item.actionKey)?.label ?? item.actionKey}</strong><p>{item.narrative}</p></div></article>)}{!adventure.actionHistory.length && <div className="adventure-empty">你的冒险还没有留下行动记录。</div>}</div>}
      {panel === 'saves' && <div className="adventure-save-panel"><section><h3><Save />保存检查点</h3><div><input value={checkpointName} onChange={event => setCheckpointName(event.target.value)} placeholder="为此刻命名" /><button disabled={!checkpointName.trim()} onClick={() => void run(async () => { await store.saveCheckpoint(checkpointName); setCheckpointName('') })}>保存</button></div></section><section><h3><GitBranch />已有检查点</h3>{store.checkpoints.map(item => <button key={item.id} onClick={() => void run(() => store.forkCheckpoint(item.id!))}><span><strong>{item.name}</strong><small>事件 #{item.throughSequence} · {formatTime(item.createdAt)}</small></span><b>从这里分支</b></button>)}{!store.checkpoints.length && <p>行动会自动保存；你也可以为重要时刻建立手动检查点。</p>}</section><section><h3><GitBranch />当前时间线分支</h3><div><input value={branchTitle} onChange={event => setBranchTitle(event.target.value)} placeholder="新时间线名称" /><button disabled={!branchTitle.trim()} onClick={() => void run(async () => { await store.forkCurrent(branchTitle); setBranchTitle(''); setPanel(null) })}>建立分支</button></div></section></div>}
    </div></section></div>}
  </div>
}
