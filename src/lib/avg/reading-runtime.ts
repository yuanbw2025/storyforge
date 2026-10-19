import type { AvgRuntimeModuleV2 } from './executable-module'
import type { ProductRuntimeState } from '../types'
import { avgKey, avgNumber, avgRecord, avgEnum, avgText } from './protocol-validation'
import { AVG_VOICE_OUTCOMES_V1, type AvgReadingRuntimeStateV1 } from './reading-contract'

export function nextAvgVoiceGenerationV1(reading: AvgReadingRuntimeStateV1): string {
  const n = reading.current ? Number(reading.current.generation.slice(5)) : 0
  if (!Number.isSafeInteger(n) || n < 0 || n >= Number.MAX_SAFE_INTEGER) throw new Error('[avg-reading] generation 无效')
  return `play.${n+1}`
}

export function avgCurrentReadingLineV1(state: ProductRuntimeState) {
  const n = state.narrative, p = state.presentation
  if (!n || !p || !n.currentNodeKey) return null
  const ordered = (n.beats ?? []).filter(b => b.nodeKey === n.currentNodeKey).sort((a,b) => a.order-b.order || a.beatKey.localeCompare(b.beatKey))
  const index = p.currentNodeKey === n.currentNodeKey && p.currentBeatKey ? ordered.findIndex(b => b.beatKey === p.currentBeatKey) : -1
  const beat = ordered[index+1]
  return beat ? { beat, visit: n.visitedNodeKeys.length - 1 } : null
}
export function avgVoiceReadyV1(state: ProductRuntimeState): boolean {
  const reading = state.avgReading, line = avgCurrentReadingLineV1(state)
  if (!reading || !line || !reading.plan.voices.some(v => v.lineKey === line.beat.beatKey)) return true
  const c = reading.current
  if (!c || c.lineKey !== line.beat.beatKey || c.visit !== line.visit) return false
  return c.status === 'ended' || c.status === 'interrupted' && reading.plan.manualVoice === 'interrupt'
    || c.status === 'failed' && reading.plan.voiceFailure === 'continue'
}
export function applyAvgVoiceEventV1(state: ProductRuntimeState, type: string, value: unknown): void {
  const reading = state.avgReading, line = avgCurrentReadingLineV1(state)
  if (!reading || !line) throw new Error('[avg-reading] 当前没有原生阅读句')
  const started = type === 'avg.reading.voice.started'
  if (!started && type !== 'avg.reading.voice.observed') throw new Error('[avg-reading] 未登记观察类型')
  const p = avgRecord(value, ['lineKey','visit','generation','assetKey',...(started ? [] : ['outcome','reason','playedMs'])], 'voice event')
  const lineKey = avgKey(p.lineKey, 'lineKey'), visit = avgNumber(p.visit, 'visit', 0, 1_000_000)
  const generation = avgKey(p.generation, 'generation'), assetKey = avgKey(p.assetKey, 'assetKey')
  if (line.beat.beatKey !== lineKey || line.visit !== visit || !reading.plan.voices.some(v => v.lineKey === lineKey && v.assetKey === assetKey)) throw new Error('[avg-reading] 观察已过期或音频/句不匹配')
  if (started) {
    if (generation !== nextAvgVoiceGenerationV1(reading)) throw new Error('[avg-reading] 播放 generation 必须单调递增')
    reading.current = { lineKey, visit, generation, assetKey, status: 'requested', reason: '', playedMs: null }
    return
  }
  const c = reading.current
  if (!c || c.generation !== generation || c.lineKey !== lineKey || c.visit !== visit || c.assetKey !== assetKey) throw new Error('[avg-reading] 播放 generation 已过期')
  const outcome = avgEnum(p.outcome, AVG_VOICE_OUTCOMES_V1, 'voice.outcome')
  if (outcome === 'interrupted' && reading.plan.manualVoice !== 'interrupt') throw new Error('[avg-reading] 作品未允许打断配音')
  // A failed generation may only be explicitly interrupted; a retry starts a new generation.
  if (c.status !== 'requested' && !(c.status === 'failed' && outcome === 'interrupted')) throw new Error('[avg-reading] 该播放已终结')
  c.playedMs = avgNumber(p.playedMs, 'playedMs', 0, 86_400_000)
  c.status = outcome; c.reason = avgText(p.reason, 'voice.reason', 2000, outcome === 'ended')
}
export function recordAvgReadingHistoryV1(state: ProductRuntimeState, kind: 'line' | 'choice', key: string): void {
  const reading = state.avgReading
  if (!reading || !state.narrative) return
  if (reading.history.length >= 100_000) throw new Error('[avg-reading] 阅读历史达到受支持上限')
  const base = { index: reading.history.length, visit: state.narrative.visitedNodeKeys.length - 1 }
  if (kind === 'choice') {
    const choice = state.narrative.choices?.find(c => c.choiceKey === key)
    if (!choice) throw new Error('[avg-reading] 历史引用未知选择')
    reading.history.push({ ...base, kind, choiceKey: key, text: choice.text })
  } else {
    if (!avgVoiceReadyV1(state)) throw new Error('[avg-reading] 配音尚未结束或失败尚待处理')
    const line = reading.lines.find(l => l.lineKey === key)
    if (!line || avgCurrentReadingLineV1(state)?.beat.beatKey !== key) throw new Error('[avg-reading] 历史句不是当前规范句')
    const voice = reading.plan.voices.find(v => v.lineKey === key)
    reading.history.push({ ...base, kind, ...line, voiceAssetKey: voice?.assetKey ?? null, voiceOutcome: voice ? reading.current!.status : 'unvoiced', voicePlayedMs: voice ? reading.current!.playedMs : null })
  }
}
export function assertAvgReadingHistoryV1(reading: AvgReadingRuntimeStateV1, state: ProductRuntimeState): void {
  if (reading.current && (!reading.plan.voices.some(v => v.lineKey === reading.current!.lineKey && v.assetKey === reading.current!.assetKey)
    || reading.current.visit >= (state.narrative?.visitedNodeKeys.length ?? 0)
    || (reading.current.status === 'requested') !== (reading.current.playedMs === null)
    || reading.current.status === 'interrupted' && reading.plan.manualVoice !== 'interrupt')) throw new Error('[avg-reading] 播放回执与冻结来源不一致')
  for (const h of reading.history) {
    if (h.visit >= (state.narrative?.visitedNodeKeys.length ?? 0)) throw new Error('[avg-reading] 历史引用未知访问')
    if (h.kind === 'line') {
      const l = reading.lines.find(l => l.lineKey === h.lineKey), voice = reading.plan.voices.find(v => v.lineKey === h.lineKey)
      if (!l || h.text !== l.text || h.textRevision !== l.textRevision || h.speaker !== l.speaker || h.voiceAssetKey !== (voice?.assetKey ?? null)
        || state.narrative?.beats?.find(b => b.beatKey === h.lineKey)?.nodeKey !== state.narrative?.visitedNodeKeys[h.visit]
        || voice && (['requested','unvoiced'].includes(h.voiceOutcome) || h.voiceOutcome === 'interrupted' && reading.plan.manualVoice !== 'interrupt' || h.voiceOutcome === 'failed' && reading.plan.voiceFailure !== 'continue')
        || (h.voicePlayedMs === null) !== !voice || !voice && h.voiceOutcome !== 'unvoiced') throw new Error('[avg-reading] 历史与冻结规范句/音频不一致')
    } else if (!state.narrative?.choices?.some(c => c.choiceKey === h.choiceKey && c.text === h.text)) throw new Error('[avg-reading] 历史选择与冻结内容不一致')
  }
}

export function createAvgReadingStateV1(module: AvgRuntimeModuleV2): AvgReadingRuntimeStateV1 | undefined {
  if (!module.reading) return undefined
  return { schema: 'storyforge.avg.reading-state', version: 1, plan: structuredClone(module.reading),
    lines: module.lines.map(l => ({ lineKey: l.lineKey, text: l.text, textRevision: l.textRevision, speaker: module.systemPlan.characters.find(c => c.key === l.speakerKey)?.displayName ?? '旁白' })), current: null, history: [] }
}
