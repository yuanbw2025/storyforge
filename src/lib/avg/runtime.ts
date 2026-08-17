import type {
  AvgCueType,
  AvgMediaAsset,
  AvgMediaKind,
  AvgPresentationContentV1,
  AvgPresentationCue,
  AvgStageState,
  AvgValidationReport,
  FrozenAvgMediaAsset,
  FrozenNarrativeBeat,
  SimulationAvgPresentationState,
  SimulationEvent,
} from '../types'
import { AVG_CUE_TYPES, AVG_MEDIA_KINDS, AVG_STAGE_LAYERS } from '../types'

const STABLE_KEY = /^[a-zA-Z0-9._:-]+$/
const VISUAL_KINDS = new Set<AvgMediaKind>(['background', 'character-pose', 'character-expression', 'cg', 'ui'])
const AUDIO_KINDS = new Set<AvgMediaKind>(['bgm', 'ambience', 'sfx', 'voice'])
const SUPPORTED_MIME_PREFIXES: Partial<Record<AvgMediaKind, string[]>> = {
  background: ['image/'], 'character-pose': ['image/'], 'character-expression': ['image/'], cg: ['image/'], ui: ['image/'],
  bgm: ['audio/'], ambience: ['audio/'], sfx: ['audio/'], voice: ['audio/'],
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`[avg] ${label} 必须是对象`)
  return value as Record<string, unknown>
}

function stableKey(value: unknown, label: string): string {
  const key = String(value ?? '').trim()
  if (!key || key.length > 200 || !STABLE_KEY.test(key)) throw new Error(`[avg] ${label} 无效`)
  return key
}

function optionalKey(value: unknown, label: string): string | null {
  return value == null || String(value).trim() === '' ? null : stableKey(value, label)
}

function numberIn(value: unknown, label: string, minimum: number, maximum: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) throw new Error(`[avg] ${label} 无效`)
  return parsed
}

function parseCue(value: unknown): AvgPresentationCue {
  const row = object(value, 'Cue')
  const type = String(row.type ?? '') as AvgCueType
  if (!AVG_CUE_TYPES.includes(type)) throw new Error(`[avg] Cue 类型无效:${String(row.type ?? '')}`)
  const phase = String(row.phase ?? '')
  if (!['before', 'during', 'after'].includes(phase)) throw new Error('[avg] Cue phase 无效')
  const layer = row.layer == null || String(row.layer).trim() === '' ? null : String(row.layer)
  if (layer != null && !AVG_STAGE_LAYERS.includes(layer as never)) throw new Error('[avg] Cue layer 无效')
  const easing = String(row.easing ?? 'ease')
  if (!['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'].includes(easing)) throw new Error('[avg] Cue easing 无效')
  const tone = row.tone == null ? null : String(row.tone).trim()
  const cue: AvgPresentationCue = {
    cueKey: stableKey(row.cueKey, 'cueKey'),
    beatKey: stableKey(row.beatKey, 'beatKey'),
    phase: phase as AvgPresentationCue['phase'],
    type,
    assetKey: optionalKey(row.assetKey, 'assetKey'),
    actorKey: optionalKey(row.actorKey, 'actorKey'),
    slot: optionalKey(row.slot, 'slot'),
    layer: layer as AvgPresentationCue['layer'],
    x: row.x == null ? null : numberIn(row.x, 'x', -4, 4),
    y: row.y == null ? null : numberIn(row.y, 'y', -4, 4),
    scale: row.scale == null ? null : numberIn(row.scale, 'scale', 0.05, 8),
    opacity: row.opacity == null ? null : numberIn(row.opacity, 'opacity', 0, 1),
    tone,
    durationMs: numberIn(row.durationMs ?? 0, 'durationMs', 0, 60_000),
    easing: easing as AvgPresentationCue['easing'],
    volume: row.volume == null ? null : numberIn(row.volume, 'volume', 0, 1),
    loop: Boolean(row.loop),
    snapshotKey: optionalKey(row.snapshotKey, 'snapshotKey'),
    order: numberIn(row.order ?? 0, 'order', 0, 1_000_000),
  }
  validateCueShape(cue)
  return cue
}

function validateCueShape(cue: AvgPresentationCue): void {
  const assetRequired = new Set<AvgCueType>(['set-background', 'set-overlay', 'show-actor', 'show-cg', 'play-audio'])
  if (assetRequired.has(cue.type) && !cue.assetKey) throw new Error(`[avg] ${cue.type} 缺少 assetKey:${cue.cueKey}`)
  if (['show-actor', 'hide-actor', 'move-actor'].includes(cue.type) && !cue.actorKey) {
    throw new Error(`[avg] ${cue.type} 缺少 actorKey:${cue.cueKey}`)
  }
  if (cue.type === 'restore-snapshot' && !cue.snapshotKey) throw new Error(`[avg] restore-snapshot 缺少 snapshotKey:${cue.cueKey}`)
}

export function parseAvgPresentationContent(value: string | unknown): AvgPresentationContentV1 {
  let raw: unknown = value
  if (typeof value === 'string') {
    try { raw = JSON.parse(value) } catch { throw new Error('[avg] 演出内容不是合法 JSON') }
  }
  const parsed = object(raw, '演出内容')
  if (parsed.version !== 1 || !Array.isArray(parsed.cues)) throw new Error('[avg] 不支持的演出内容版本')
  return { version: 1, cues: parsed.cues.map(parseCue) }
}

export function freezeAvgMediaAsset(asset: AvgMediaAsset): FrozenAvgMediaAsset {
  if (!AVG_MEDIA_KINDS.includes(asset.kind) || !asset.name.trim() || !asset.contentHash.match(/^[a-f0-9]{64}$/)
    || !Number.isInteger(asset.version) || asset.version < 1 || !Number.isInteger(asset.byteSize) || asset.byteSize < 0) {
    throw new Error(`[avg] 媒资元数据无效:${asset.assetKey}`)
  }
  return {
    assetKey: stableKey(asset.assetKey, 'assetKey'), version: asset.version, kind: asset.kind,
    name: asset.name.trim(), mimeType: asset.mimeType.trim().toLowerCase(), byteSize: asset.byteSize,
    width: asset.width, height: asset.height, durationMs: asset.durationMs, contentHash: asset.contentHash,
    source: asset.source.trim(), license: asset.license.trim(), altText: asset.altText.trim(),
    characterTag: asset.characterTag.trim(), sceneTag: asset.sceneTag.trim(),
  }
}

export function validateAvgPresentation(input: {
  content: AvgPresentationContentV1
  beats: FrozenNarrativeBeat[]
  assets: FrozenAvgMediaAsset[]
  allWorkAssets?: FrozenAvgMediaAsset[]
}): AvgValidationReport {
  const errors: string[] = []
  const warnings: string[] = []
  const beatKeys = new Set(input.beats.map(beat => beat.beatKey))
  const assetByKey = new Map(input.assets.map(asset => [asset.assetKey, asset]))
  const cueKeys = new Set<string>()
  const missingAssetKeys = new Set<string>()
  const orphanCueKeys: string[] = []
  const longWaitCueKeys: string[] = []
  for (const cue of input.content.cues) {
    if (cueKeys.has(cue.cueKey)) errors.push(`[avg] cueKey 重复:${cue.cueKey}`)
    cueKeys.add(cue.cueKey)
    if (!beatKeys.has(cue.beatKey)) orphanCueKeys.push(cue.cueKey)
    if (cue.assetKey && !assetByKey.has(cue.assetKey)) missingAssetKeys.add(cue.assetKey)
    if (cue.type === 'wait' && cue.durationMs > 10_000) longWaitCueKeys.push(cue.cueKey)
    const asset = cue.assetKey ? assetByKey.get(cue.assetKey) : null
    if (asset && cue.type === 'set-background' && asset.kind !== 'background') errors.push(`[avg] 背景 Cue 引用了错误类型:${cue.cueKey}`)
    if (asset && cue.type === 'set-overlay' && asset.kind !== 'ui') errors.push(`[avg] 覆盖层 Cue 引用了错误类型:${cue.cueKey}`)
    if (asset && cue.type === 'show-cg' && asset.kind !== 'cg') errors.push(`[avg] CG Cue 引用了错误类型:${cue.cueKey}`)
    if (asset && cue.type === 'show-actor' && !['character-pose', 'character-expression'].includes(asset.kind)) errors.push(`[avg] 角色 Cue 引用了错误类型:${cue.cueKey}`)
    if (asset && cue.type === 'play-audio' && !AUDIO_KINDS.has(asset.kind)) errors.push(`[avg] 音频 Cue 引用了错误类型:${cue.cueKey}`)
  }
  const referenced = new Set(input.content.cues.flatMap(cue => cue.assetKey ? [cue.assetKey] : []))
  const orphanAssetKeys = (input.allWorkAssets ?? input.assets).map(asset => asset.assetKey).filter(key => !referenced.has(key)).sort()
  const unsupportedMimeAssetKeys = input.assets.filter(asset => !(SUPPORTED_MIME_PREFIXES[asset.kind] ?? [])
    .some(prefix => asset.mimeType.startsWith(prefix))).map(asset => asset.assetKey).sort()
  const missingAltTextAssetKeys = input.assets.filter(asset => VISUAL_KINDS.has(asset.kind) && !asset.altText.trim())
    .map(asset => asset.assetKey).sort()
  if (orphanCueKeys.length) errors.push(`[avg] Cue 绑定不存在 Beat:${orphanCueKeys.join(',')}`)
  if (missingAssetKeys.size) errors.push(`[avg] 缺失媒资:${[...missingAssetKeys].join(',')}`)
  if (unsupportedMimeAssetKeys.length) errors.push(`[avg] 不支持的媒资格式:${unsupportedMimeAssetKeys.join(',')}`)
  if (missingAltTextAssetKeys.length) errors.push(`[avg] 视觉媒资缺少替代文本:${missingAltTextAssetKeys.join(',')}`)
  if (longWaitCueKeys.length) warnings.push(`[avg] 等待超过 10 秒:${longWaitCueKeys.join(',')}`)
  if (orphanAssetKeys.length) warnings.push(`[avg] 未被引用的媒资:${orphanAssetKeys.join(',')}`)
  return { valid: errors.length === 0, errors, warnings, missingAssetKeys: [...missingAssetKeys].sort(), orphanAssetKeys, orphanCueKeys: orphanCueKeys.sort(), unsupportedMimeAssetKeys, missingAltTextAssetKeys, longWaitCueKeys: longWaitCueKeys.sort() }
}

export const EMPTY_AVG_STAGE: AvgStageState = {
  backgroundAssetKey: null, cgAssetKey: null, actors: [], overlayAssetKey: null, tone: 'normal',
  camera: { x: 0, y: 0, scale: 1 }, activeAudio: [], mask: null, lastTransition: null,
}

function audioChannel(kind: AvgMediaKind): 'bgm' | 'ambience' | 'sfx' | 'voice' {
  if (!AUDIO_KINDS.has(kind)) throw new Error(`[avg] ${kind} 不是音频类型`)
  return kind as 'bgm' | 'ambience' | 'sfx' | 'voice'
}

export function applyAvgCue(stage: AvgStageState, cue: AvgPresentationCue, assets: FrozenAvgMediaAsset[], snapshots: Record<string, AvgStageState>): AvgStageState {
  let next = structuredClone(stage)
  const asset = cue.assetKey ? assets.find(item => item.assetKey === cue.assetKey) : null
  if (cue.assetKey && !asset) return next
  switch (cue.type) {
    case 'set-background': next.backgroundAssetKey = cue.assetKey!; break
    case 'clear-background': next.backgroundAssetKey = null; break
    case 'set-overlay': next.overlayAssetKey = cue.assetKey!; break
    case 'clear-overlay': next.overlayAssetKey = null; break
    case 'show-cg': next.cgAssetKey = cue.assetKey!; break
    case 'clear-cg': next.cgAssetKey = null; break
    case 'show-actor': {
      const actor = {
        actorKey: cue.actorKey!, assetKey: cue.assetKey!, slot: cue.slot ?? 'center',
        layer: cue.layer === 'actor-back' ? 'actor-back' as const : 'actor-front' as const,
        x: cue.x ?? 0, y: cue.y ?? 0, scale: cue.scale ?? 1, opacity: cue.opacity ?? 1,
      }
      next.actors = [...next.actors.filter(item => item.actorKey !== actor.actorKey), actor]
      break
    }
    case 'hide-actor': next.actors = next.actors.filter(item => item.actorKey !== cue.actorKey); break
    case 'move-actor': next.actors = next.actors.map(item => item.actorKey === cue.actorKey ? {
      ...item, slot: cue.slot ?? item.slot, layer: cue.layer === 'actor-back' || cue.layer === 'actor-front' ? cue.layer : item.layer,
      x: cue.x ?? item.x, y: cue.y ?? item.y, scale: cue.scale ?? item.scale, opacity: cue.opacity ?? item.opacity,
    } : item); break
    case 'set-tone': next.tone = cue.tone || 'normal'; break
    case 'camera': next.camera = { x: cue.x ?? next.camera.x, y: cue.y ?? next.camera.y, scale: cue.scale ?? next.camera.scale }; break
    case 'mask': next.mask = cue.tone || null; break
    case 'transition': case 'shake': case 'flash': next.lastTransition = cue.type; break
    case 'play-audio': {
      const channel = audioChannel(asset!.kind)
      next.activeAudio = [...next.activeAudio.filter(item => item.channel !== channel), { channel, assetKey: asset!.assetKey, volume: cue.volume ?? 1, loop: Boolean(cue.loop) }]
      break
    }
    case 'stop-audio': {
      const channel = asset ? audioChannel(asset.kind) : (cue.tone as 'bgm' | 'ambience' | 'sfx' | 'voice' | null)
      next.activeAudio = channel ? next.activeAudio.filter(item => item.channel !== channel) : []
      break
    }
    case 'restore-snapshot': next = structuredClone(snapshots[cue.snapshotKey!] ?? next); break
    case 'wait': break
  }
  return next
}

export function createInitialAvgPresentationState(input: {
  contentHash: string
  assets: FrozenAvgMediaAsset[]
  content: AvgPresentationContentV1
  entryNodeKey: string
}): SimulationAvgPresentationState {
  return {
    schema: 'storyforge.avg-presentation', version: 1, contentHash: input.contentHash,
    assets: structuredClone(input.assets), cues: structuredClone(input.content.cues), currentNodeKey: input.entryNodeKey,
    currentBeatKey: null, reachedBeatKeys: [], readBeatKeys: [], stage: structuredClone(EMPTY_AVG_STAGE),
    snapshots: {}, mediaFailures: [],
  }
}

export function parseAvgPresentationState(value: unknown): SimulationAvgPresentationState | null {
  if (value == null) return null
  const row = object(value, '演出状态')
  if (row.schema !== 'storyforge.avg-presentation' || row.version !== 1 || typeof row.contentHash !== 'string'
    || !Array.isArray(row.assets) || !Array.isArray(row.cues) || !Array.isArray(row.readBeatKeys)
    || !Array.isArray(row.reachedBeatKeys) || !row.stage || typeof row.currentNodeKey !== 'string') {
    throw new Error('[avg] 演出状态无效')
  }
  const assets = (row.assets as AvgMediaAsset[]).map(freezeAvgMediaAsset)
  const cues = (row.cues as unknown[]).map(parseCue)
  const stage = structuredClone(row.stage) as AvgStageState
  if (!stage || !Array.isArray(stage.actors) || !Array.isArray(stage.activeAudio)) throw new Error('[avg] 舞台状态无效')
  const snapshots = object(row.snapshots ?? {}, '舞台快照') as Record<string, AvgStageState>
  const failures = Array.isArray(row.mediaFailures) ? row.mediaFailures.map(item => {
    const entry = object(item, '媒资失败记录')
    return { assetKey: stableKey(entry.assetKey, 'assetKey'), reason: String(entry.reason ?? ''), eventSequence: numberIn(entry.eventSequence, 'eventSequence', 1, Number.MAX_SAFE_INTEGER) }
  }) : []
  return {
    schema: 'storyforge.avg-presentation', version: 1, contentHash: row.contentHash,
    assets, cues, currentNodeKey: stableKey(row.currentNodeKey, 'currentNodeKey'),
    currentBeatKey: optionalKey(row.currentBeatKey, 'currentBeatKey'),
    reachedBeatKeys: (row.reachedBeatKeys as unknown[]).map(item => stableKey(item, 'reachedBeatKey')),
    readBeatKeys: (row.readBeatKeys as unknown[]).map(item => stableKey(item, 'readBeatKey')),
    stage, snapshots: structuredClone(snapshots), mediaFailures: failures,
  }
}

export function applyAvgPresentationEvent(current: SimulationAvgPresentationState | null, event: SimulationEvent, currentNodeKey: string | null, beats: FrozenNarrativeBeat[]): SimulationAvgPresentationState {
  if (!current) throw new Error('[avg] 演出事件缺少冻结状态')
  const state = structuredClone(current)
  const payload = object(JSON.parse(event.payloadJson), '演出事件 payload')
  if (event.type === 'presentation.media.failed') {
    const assetKey = stableKey(payload.assetKey, '失败媒资 key')
    if (!state.assets.some(asset => asset.assetKey === assetKey)) throw new Error('[avg] 失败媒资不在冻结发布中')
    state.mediaFailures.push({ assetKey, reason: String(payload.reason ?? '').trim() || '资源不可用', eventSequence: event.sequence })
    return state
  }
  if (event.type !== 'presentation.beat.reached') throw new Error('[avg] 未知演出事件')
  const beatKey = stableKey(payload.beatKey, 'beatKey')
  if (!currentNodeKey) throw new Error('[avg] 当前叙事节点不存在')
  const ordered = beats.filter(beat => beat.nodeKey === currentNodeKey).sort((a, b) => a.order - b.order || a.beatKey.localeCompare(b.beatKey))
  const priorIndex = state.currentNodeKey === currentNodeKey && state.currentBeatKey
    ? ordered.findIndex(beat => beat.beatKey === state.currentBeatKey)
    : -1
  const expected = ordered[priorIndex + 1]
  if (!expected || expected.beatKey !== beatKey) throw new Error('[avg] Beat 必须按冻结顺序到达')
  let stage = state.currentNodeKey === currentNodeKey ? state.stage : structuredClone(state.stage)
  const cues = state.cues.filter(cue => cue.beatKey === beatKey)
    .sort((a, b) => ['before', 'during', 'after'].indexOf(a.phase) - ['before', 'during', 'after'].indexOf(b.phase) || a.order - b.order || a.cueKey.localeCompare(b.cueKey))
  for (const cue of cues) stage = applyAvgCue(stage, cue, state.assets, state.snapshots)
  state.currentNodeKey = currentNodeKey
  state.currentBeatKey = beatKey
  state.reachedBeatKeys = [...new Set([...state.reachedBeatKeys, beatKey])]
  state.readBeatKeys = [...new Set([...state.readBeatKeys, beatKey])]
  state.stage = stage
  state.snapshots[`beat:${beatKey}`] = structuredClone(stage)
  const snapshotKey = typeof payload.snapshotKey === 'string' && payload.snapshotKey.trim() ? payload.snapshotKey.trim() : null
  if (snapshotKey) state.snapshots[snapshotKey] = structuredClone(stage)
  return state
}
