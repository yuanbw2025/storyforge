import { avgBoolean, avgEnum, avgHash, avgKey, avgList, avgNumber, avgRecord, avgText, avgUnique } from './protocol-validation'

export const AVG_VOICE_REVIEW_CRITERIA_V1 = ['text-match', 'pronunciation', 'delivery', 'clip-boundaries', 'noise'] as const
export type AvgVoiceReviewCriterionV1 = typeof AVG_VOICE_REVIEW_CRITERIA_V1[number]

/** Native playback observation plus author assessment; this cannot establish
 * listener identity, independent review, certified loudness or commercial QA.
 * The service still binds it to exact same-Work raw bytes and producer proof.
 */
export interface AvgAuthorVoiceEvidenceV1 {
  audioHash: string | null
  requestIdentityHash: string
  audition: {
    generation: string
    outcome: 'ended' | 'failed' | 'interrupted'
    durationMs: number
    playedMs: number
    muted: boolean
    volume: number
    playbackRate: number
    seeked: boolean
  } | null
  checks: Array<{ criterion: AvgVoiceReviewCriterionV1; result: 'pass' | 'fail' | 'unknown'; note: string }>
  note: string
}

export function parseAvgAuthorVoiceEvidenceV1(value: unknown): AvgAuthorVoiceEvidenceV1 {
  const r = avgRecord(value, ['audioHash', 'requestIdentityHash', 'audition', 'checks', 'note'], 'voice evidence')
  const a = r.audition === null ? null : avgRecord(r.audition, ['generation', 'outcome', 'durationMs', 'playedMs', 'muted',
    'volume', 'playbackRate', 'seeked'], 'voice audition')
  const audition: AvgAuthorVoiceEvidenceV1['audition'] = a === null ? null : {
    generation: avgKey(a.generation, 'voice audition generation'),
    outcome: avgEnum(a.outcome, ['ended', 'failed', 'interrupted'], 'voice audition outcome'),
    durationMs: avgNumber(a.durationMs, 'voice audition duration', 1, 120_000), playedMs: avgNumber(a.playedMs, 'voice audition position', 0, 120_000),
    muted: avgBoolean(a.muted, 'voice audition muted'), volume: avgNumber(a.volume, 'voice audition volume', 0, 1, false),
    playbackRate: avgNumber(a.playbackRate, 'voice audition playback rate', 0.25, 4, false), seeked: avgBoolean(a.seeked, 'voice audition seeked'),
  }
  if (audition && (!audition.generation.startsWith('audition.') || audition.playedMs > audition.durationMs + 1)) {
    throw new Error('[avg-voice] 审听播放身份或实际位置无效')
  }
  const checks = avgUnique(avgList(r.checks, 'voice checks', value => {
    const c = avgRecord(value, ['criterion', 'result', 'note'], 'voice check')
    return { criterion: avgEnum(c.criterion, AVG_VOICE_REVIEW_CRITERIA_V1, 'voice criterion'),
      result: avgEnum(c.result, ['pass', 'fail', 'unknown'] as const, 'voice result'), note: avgText(c.note, 'voice check note', 2000, true) }
  }, AVG_VOICE_REVIEW_CRITERIA_V1.length), c => c.criterion, 'voice checks')
  if (checks.length !== AVG_VOICE_REVIEW_CRITERIA_V1.length) throw new Error('[avg-voice] 审听观察项不完整')
  return { audioHash: r.audioHash === null ? null : avgHash(r.audioHash, 'voice observed audio hash'),
    requestIdentityHash: avgHash(r.requestIdentityHash, 'voice observed request identity'), audition, checks, note: avgText(r.note, 'voice observation note', 4000) }
}
