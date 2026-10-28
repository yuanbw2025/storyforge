import type { AvgPresentationCue, AvgStageState, ProductRuntimeState } from '../types'
import { avgEnum, avgHash, avgKey, avgList, avgNumber, avgRecord, avgText, avgUnique } from './protocol-validation'
import { avgCurrentReadingLineV1 } from './reading-runtime'

function last<T>(rows: readonly T[] | undefined): T | undefined { return rows?.[rows.length - 1] }

export const AVG_ONCE_AUDIO_CHANNELS_V1 = ['bgm', 'ambience', 'sfx', 'voice'] as const
export const AVG_ONCE_AUDIO_OUTCOMES_V1 = ['ended', 'failed'] as const
export interface AvgOnceAudioReceiptV1 {
  cueKey: string; beatKey: string; visit: number; assetKey: string; contentHash: string
  channel: typeof AVG_ONCE_AUDIO_CHANNELS_V1[number]; generation: number
  status: 'requested' | 'ended' | 'failed' | 'superseded'; playedMs: number | null; reason: string
}
export interface AvgOnceAudioStateV1 {
  schema: 'storyforge.avg.once-audio'; version: 1; retainedVisit: number; receipts: AvgOnceAudioReceiptV1[]
}
export function parseAvgOnceAudioStateV1(value: unknown): AvgOnceAudioStateV1 {
  const p = avgRecord(value, ['schema', 'version', 'retainedVisit', 'receipts'], 'onceAudio')
  if (p.schema !== 'storyforge.avg.once-audio' || p.version !== 1) throw new Error('[avg-audio] 回执版本无效')
  const receipts = avgUnique(avgList(p.receipts, 'onceAudio.receipts', value => {
    const r = avgRecord(value, ['cueKey', 'beatKey', 'visit', 'assetKey', 'contentHash', 'channel', 'generation', 'status', 'playedMs', 'reason'], 'onceAudio.receipt')
    return { cueKey: avgKey(r.cueKey, 'cueKey'), beatKey: avgKey(r.beatKey, 'beatKey'), visit: avgNumber(r.visit, 'visit', 0, 1_000_000),
      assetKey: avgKey(r.assetKey, 'assetKey'), contentHash: avgHash(r.contentHash, 'contentHash'),
      channel: avgEnum(r.channel, AVG_ONCE_AUDIO_CHANNELS_V1, 'channel'), generation: avgNumber(r.generation, 'generation', 1, Number.MAX_SAFE_INTEGER),
      status: avgEnum(r.status, ['requested', 'ended', 'failed', 'superseded'] as const, 'status'),
      playedMs: r.playedMs === null ? null : avgNumber(r.playedMs, 'playedMs', 0, 86_400_000), reason: avgText(r.reason, 'reason', 2000, true) }
  }, 1004), r => `${r.visit}:${r.cueKey}`, 'onceAudio.receipts')
  return { schema: 'storyforge.avg.once-audio', version: 1, retainedVisit: avgNumber(p.retainedVisit, 'retainedVisit', 0, 1_000_000), receipts }
}

function binding(state: ProductRuntimeState, cueKey: string) {
  const p = state.presentation, cue = p?.cues.find(c => c.cueKey === cueKey), asset = p?.assets.find(a => a.assetKey === cue?.assetKey)
  if (!state.avgRules || !p || !cue || cue.type !== 'play-audio' || cue.loop || !asset
    || !AVG_ONCE_AUDIO_CHANNELS_V1.includes(asset.kind as typeof AVG_ONCE_AUDIO_CHANNELS_V1[number])
    || asset.kind === 'voice' && state.avgReading) throw new Error('[avg-audio] 不是冻结的原生一次性音频 Cue')
  return { cue, asset, channel: asset.kind as typeof AVG_ONCE_AUDIO_CHANNELS_V1[number] }
}
export function avgOnceAudioReceiptV1(state: ProductRuntimeState, cueKey: string, visit: number) {
  return state.presentation?.onceAudio?.receipts.find(r => r.cueKey === cueKey && r.visit === visit) ?? null
}
export function nextAvgOnceAudioGenerationV1(state: ProductRuntimeState): number {
  const generation = (last(state.presentation?.onceAudio?.receipts)?.generation ?? 0) + 1
  return avgNumber(generation, 'next generation', 1, Number.MAX_SAFE_INTEGER)
}
/** Current-visit receipts plus the latest receipt per channel bound the snapshot;
 * the complete history remains in the existing append-only event log. */
function compact(receipts: AvgOnceAudioReceiptV1[], visit: number) {
  return receipts.filter((r, i) => r.visit === visit
    || !receipts.slice(i + 1).some(next => next.channel === r.channel))
}
export function assertAvgOnceAudioStateV1(state: ProductRuntimeState): void {
  const audio = state.presentation?.onceAudio
  if (!audio) return
  if (!state.avgRules || !state.narrative) throw new Error('[avg-audio] 回执缺少原生规则/叙事')
  const receipts = audio.receipts
  if (!receipts.length || audio.retainedVisit >= state.narrative.visitedNodeKeys.length || receipts.length !== compact(receipts, audio.retainedVisit).length) throw new Error('[avg-audio] 回执未按有界上下文收口')
  for (const [index, r] of receipts.entries()) {
    const { cue, asset, channel } = binding(state, r.cueKey)
    if (cue.beatKey !== r.beatKey || asset.assetKey !== r.assetKey || asset.contentHash !== r.contentHash || channel !== r.channel
      || state.narrative.beats.find(b => b.beatKey === r.beatKey)?.nodeKey !== state.narrative.visitedNodeKeys[r.visit]
      || index > 0 && r.generation <= receipts[index - 1].generation
      || ['requested', 'superseded'].includes(r.status) !== (r.playedMs === null)
      || r.status === 'ended' && r.reason !== '' || r.status !== 'ended' && r.status !== 'requested' && !r.reason.trim()
      || r.status === 'requested' && receipts.slice(index + 1).some(next => next.channel === r.channel)) throw new Error('[avg-audio] 回执与冻结来源/事件不一致')
  }
}

export function applyAvgOnceAudioEventV1(state: ProductRuntimeState, type: string, value: unknown, sequence: number): void {
  const started = type === 'avg.audio.once.started'
  if (!started && type !== 'avg.audio.once.observed') throw new Error('[avg-audio] 未登记观察类型')
  const p = avgRecord(value, ['cueKey', 'visit', 'generation', ...(started ? ['retry'] : ['outcome', 'reason', 'playedMs'])], 'onceAudio.event')
  const cueKey = avgKey(p.cueKey, 'cueKey'), visit = avgNumber(p.visit, 'visit', 0, 1_000_000)
  const generation = avgNumber(p.generation, 'generation', 1, Number.MAX_SAFE_INTEGER)
  const { cue, asset, channel } = binding(state, cueKey)
  const previous = avgOnceAudioReceiptV1(state, cueKey, visit)
  if (started) {
    const retry = p.retry
    if (typeof retry !== 'boolean' || generation !== nextAvgOnceAudioGenerationV1(state) || sequence <= state.lastSequence) throw new Error('[avg-audio] 请求 generation/retry 无效')
    const line = avgCurrentReadingLineV1(state)
    const current = line?.beat.beatKey === cue.beatKey && line.visit === visit
    // An interrupted pending clip may be explicitly retried while it is still
    // the persisted channel target after the reader has advanced the text.
    const retained = previous && last(state.presentation!.onceAudio!.receipts.filter(r => r.channel === channel)) === previous
      && state.presentation!.stage.activeAudio.some(a => a.channel === channel && a.assetKey === asset.assetKey && !a.loop)
    if (!current && !(retry && retained)) throw new Error('[avg-audio] Cue/visit 已过期')
    if (previous ? !retry || !['requested', 'failed'].includes(previous.status) : retry) throw new Error('[avg-audio] 已结算或重复请求，恢复须明确重播未完成片段')
    const retainedVisit = state.narrative!.visitedNodeKeys.length - 1
    let receipts = compact(state.presentation!.onceAudio?.receipts ?? [], retainedVisit).filter(r => r !== previous)
    receipts = receipts.map(r => r.channel === channel && r.status === 'requested' ? { ...r, status: 'superseded', playedMs: null, reason: '被同声道后继 Cue 替换' } : r)
    receipts.push({ cueKey, beatKey: cue.beatKey, visit, assetKey: asset.assetKey, contentHash: asset.contentHash, channel, generation,
      status: 'requested', playedMs: null, reason: '' })
    state.presentation!.onceAudio = { schema: 'storyforge.avg.once-audio', version: 1, retainedVisit, receipts: compact(receipts, retainedVisit) }
  } else {
    if (!previous || previous.generation !== generation || previous.status !== 'requested') throw new Error('[avg-audio] generation 已过期或播放已终结')
    previous.status = avgEnum(p.outcome, AVG_ONCE_AUDIO_OUTCOMES_V1, 'outcome')
    previous.playedMs = avgNumber(p.playedMs, 'playedMs', 0, 86_400_000)
    previous.reason = avgText(p.reason, 'reason', 2000, previous.status === 'ended')
    if (previous.status === 'ended' && previous.reason !== '') throw new Error('[avg-audio] ended 不得附失败原因')
  }
}

/** The renderer may start only a due cue. A persisted channel receipt carries
 * an already started non-loop clip across text advancement without a new play. */
export function selectAvgOnceAudioTargetV1(state: ProductRuntimeState, audio: AvgStageState['activeAudio'][number], cues: AvgPresentationCue[]) {
  const cue = last(cues.filter(c => c.type === 'play-audio' && c.assetKey === audio.assetKey && !c.loop))
  if (cue) return { cueKey: cue.cueKey, visit: state.narrative!.visitedNodeKeys.length - 1 }
  if (audio.channel === 'sfx' || audio.channel === 'voice') return null
  const receipt = last(state.presentation?.onceAudio?.receipts.filter(r => r.channel === audio.channel))
  return receipt?.assetKey === audio.assetKey ? { cueKey: receipt.cueKey, visit: receipt.visit } : null
}
