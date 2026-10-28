import { avgEnum, avgKey, avgList, avgNumber, avgRecord, avgText, avgUnique } from './protocol-validation'

export interface AvgReadingPlanV1 {
  schema: 'storyforge.avg.reading-plan'; version: 1
  manualVoice: 'wait' | 'interrupt'; voiceFailure: 'pause' | 'continue'
  maximumVoiceWaitMs: number; autoDelayMs: number
  voices: Array<{ lineKey: string; assetKey: string; text: string; textRevision: number; speakerKey: string | null; locale: 'zh-CN' }>
}
export function parseAvgReadingPlanV1(value: unknown): AvgReadingPlanV1 {
  const r = avgRecord(value, ['schema','version','manualVoice','voiceFailure','maximumVoiceWaitMs','autoDelayMs','voices'], 'reading plan')
  if (r.schema !== 'storyforge.avg.reading-plan' || r.version !== 1) throw new Error('[avg-reading] 未登记阅读协议')
  return { schema: 'storyforge.avg.reading-plan', version: 1,
    manualVoice: avgEnum(r.manualVoice, ['wait','interrupt'] as const, 'manualVoice'), voiceFailure: avgEnum(r.voiceFailure, ['pause','continue'] as const, 'voiceFailure'),
    maximumVoiceWaitMs: avgNumber(r.maximumVoiceWaitMs, 'maximumVoiceWaitMs', 1000, 600_000), autoDelayMs: avgNumber(r.autoDelayMs, 'autoDelayMs', 0, 30_000),
    voices: avgUnique(avgList(r.voices, 'voices', value => {
      const v = avgRecord(value, ['lineKey','assetKey','text','textRevision','speakerKey','locale'], 'voice binding')
      return { lineKey: avgKey(v.lineKey, 'voice.lineKey'), assetKey: avgKey(v.assetKey, 'voice.assetKey'), text: avgText(v.text, 'voice.text', 10_000),
        textRevision: avgNumber(v.textRevision, 'voice.textRevision', 1, 1_000_000), speakerKey: v.speakerKey === null ? null : avgKey(v.speakerKey, 'voice.speakerKey'), locale: avgEnum(v.locale, ['zh-CN'] as const, 'voice.locale') }
    }, 50_000), v => v.lineKey, 'voices') }
}
export const AVG_VOICE_OUTCOMES_V1 = ['ended','failed','interrupted'] as const
export interface AvgVoiceReceiptV1 { lineKey: string; visit: number; generation: string; assetKey: string; status: 'requested' | typeof AVG_VOICE_OUTCOMES_V1[number]; reason: string; playedMs: number | null }
export type AvgReadingHistoryV1 = { index: number; visit: number } & (
  | { kind: 'line'; lineKey: string; text: string; textRevision: number; speaker: string; voiceAssetKey: string | null; voiceOutcome: AvgVoiceReceiptV1['status'] | 'unvoiced'; voicePlayedMs: number | null }
  | { kind: 'choice'; choiceKey: string; text: string }
)
export interface AvgReadingRuntimeStateV1 {
  schema: 'storyforge.avg.reading-state'; version: 1; plan: AvgReadingPlanV1
  lines: Array<{ lineKey: string; text: string; textRevision: number; speaker: string }>
  current: AvgVoiceReceiptV1 | null; history: AvgReadingHistoryV1[]
}
export function parseAvgVoiceReceiptV1(value: unknown): AvgVoiceReceiptV1 {
  const r = avgRecord(value, ['lineKey','visit','generation','assetKey','status','reason','playedMs'], 'voice receipt')
  if (typeof r.generation !== 'string' || !/^play\.[1-9][0-9]*$/.test(r.generation) || !Number.isSafeInteger(Number(r.generation.slice(5)))) throw new Error('[avg-reading] generation 格式无效')
  return { lineKey: avgKey(r.lineKey, 'lineKey'), visit: avgNumber(r.visit, 'visit', 0, 1_000_000), generation: avgKey(r.generation, 'generation'), assetKey: avgKey(r.assetKey, 'assetKey'),
    status: avgEnum(r.status, ['requested',...AVG_VOICE_OUTCOMES_V1] as const, 'voice.status'), reason: avgText(r.reason, 'voice.reason', 2000, true), playedMs: r.playedMs === null ? null : avgNumber(r.playedMs, 'playedMs', 0, 86_400_000) }
}
export function parseAvgReadingStateV1(value: unknown): AvgReadingRuntimeStateV1 {
  const r = avgRecord(value, ['schema','version','plan','lines','current','history'], 'reading state')
  if (r.schema !== 'storyforge.avg.reading-state' || r.version !== 1) throw new Error('[avg-reading] 阅读状态版本无效')
  const lines = avgUnique(avgList(r.lines, 'reading lines', value => {
    const l = avgRecord(value, ['lineKey','text','textRevision','speaker'], 'reading line')
    return { lineKey: avgKey(l.lineKey, 'lineKey'), text: avgText(l.text, 'text', 10_000), textRevision: avgNumber(l.textRevision, 'textRevision', 1, 1_000_000), speaker: avgText(l.speaker, 'speaker', 200) }
  }, 50_000), l => l.lineKey, 'reading lines')
  const history = avgList(r.history, 'reading history', (value, label): AvgReadingHistoryV1 => {
    const kind = (value as { kind?: unknown })?.kind
    const h = avgRecord(value, ['index','visit','kind','text',...(kind === 'line' ? ['lineKey','textRevision','speaker','voiceAssetKey','voiceOutcome','voicePlayedMs'] : ['choiceKey'])], label)
    const common = { index: avgNumber(h.index, 'history.index', 0, 100_000), visit: avgNumber(h.visit, 'history.visit', 0, 1_000_000), text: avgText(h.text, 'history.text', 10_000) }
    if (kind === 'line') return { ...common, kind, lineKey: avgKey(h.lineKey, 'history.lineKey'), textRevision: avgNumber(h.textRevision, 'history.textRevision', 1, 1_000_000), speaker: avgText(h.speaker, 'history.speaker', 200),
      voiceAssetKey: h.voiceAssetKey === null ? null : avgKey(h.voiceAssetKey, 'history.voiceAssetKey'), voiceOutcome: avgEnum(h.voiceOutcome, ['unvoiced','requested',...AVG_VOICE_OUTCOMES_V1] as const, 'history.voiceOutcome'), voicePlayedMs: h.voicePlayedMs === null ? null : avgNumber(h.voicePlayedMs, 'voicePlayedMs', 0, 86_400_000) }
    if (kind !== 'choice') throw new Error('[avg-reading] 历史类型无效')
    return { ...common, kind, choiceKey: avgKey(h.choiceKey, 'history.choiceKey') }
  }, 100_000)
  if (history.some((h,i) => h.index !== i)) throw new Error('[avg-reading] 历史顺序不连续')
  return { schema: 'storyforge.avg.reading-state', version: 1, plan: parseAvgReadingPlanV1(r.plan), lines,
    current: r.current === null ? null : parseAvgVoiceReceiptV1(r.current), history }
}
