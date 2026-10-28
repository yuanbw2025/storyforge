import { parseAvgReviewFieldsV1, type AvgReviewIssuesV1 } from './artifact-contract'
import { avgBoolean, avgEnum, avgHash, avgKey, avgList, avgNumber, avgProtocolBody, avgRecord, avgText, avgUnique } from './protocol-validation'

export const AVG_SOUND_REVIEW_CRITERIA_V1 = ['purpose-fit', 'noise-distortion', 'clip-boundaries', 'instrumental-only', 'loop-seam'] as const
export type AvgSoundReviewCriterionV1 = typeof AVG_SOUND_REVIEW_CRITERIA_V1[number]
export interface AvgAuthorSoundEvidenceV1 {
  audioHash: string | null
  requestIdentityHash: string
  audition: {
    generation: string; outcome: 'ended' | 'failed' | 'interrupted'
    durationMs: number; playedMs: number; completedCycles: number; continuousLoops: number
    muted: boolean; volume: number; playbackRate: number; seeked: boolean
  } | null
  checks: Array<{ criterion: AvgSoundReviewCriterionV1; result: 'pass' | 'fail' | 'unknown'; note: string }>
  note: string
}

/** Explicit sound observation, not a voice transcript, model score, verified
 * listener identity, independent review or commercial quality certificate. */
export type AvgSoundReviewIssuesV3 = Pick<AvgReviewIssuesV1, 'targetKey' | 'observations' | 'unobserved' | 'issues'> & {
  schema: 'storyforge.avg.review-issues'; version: 3; soundEvidence: AvgAuthorSoundEvidenceV1
  audioEvidence?: never; visualEvidence?: never
}
export function parseAvgAuthorSoundReviewV3(value: unknown): AvgSoundReviewIssuesV3 {
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'targetKey', 'observations', 'unobserved', 'issues', 'soundEvidence'], 'sound review')
  if (r.schema !== 'storyforge.avg.review-issues' || r.version !== 3) throw new Error('[avg-sound-review] 需要独立的声音观察版本，不能借用配音或图像评审')
  const fields = parseAvgReviewFieldsV1(r)
  const e = avgRecord(r.soundEvidence, ['audioHash', 'requestIdentityHash', 'audition', 'checks', 'note'], 'sound observation')
  const a = e.audition === null ? null : avgRecord(e.audition, ['generation', 'outcome', 'durationMs', 'playedMs', 'completedCycles',
    'continuousLoops', 'muted', 'volume', 'playbackRate', 'seeked'], 'sound audition')
  const audition: AvgAuthorSoundEvidenceV1['audition'] = a === null ? null : {
    generation: avgKey(a.generation, 'sound playback generation'), outcome: avgEnum(a.outcome, ['ended', 'failed', 'interrupted'], 'sound playback outcome'),
    durationMs: avgNumber(a.durationMs, 'sound playback duration', 1, 120_000), playedMs: avgNumber(a.playedMs, 'sound played duration', 0, 960_001),
    completedCycles: avgNumber(a.completedCycles, 'sound complete cycles', 0, 8), continuousLoops: avgNumber(a.continuousLoops, 'sound continuous transitions', 0, 7),
    muted: avgBoolean(a.muted, 'sound muted'), volume: avgNumber(a.volume, 'sound volume', 0, 1, false),
    playbackRate: avgNumber(a.playbackRate, 'sound playback rate', .25, 4, false), seeked: avgBoolean(a.seeked, 'sound seeked'),
  }
  if (audition && (!audition.generation.startsWith('audition.') || audition.continuousLoops > audition.completedCycles
    || audition.playedMs > audition.durationMs * Math.min(8, audition.completedCycles + 1) + 1)) throw new Error('[avg-sound-review] 播放代际、循环或实际播放时长无效')
  const checks = avgUnique(avgList(e.checks, 'sound checks', value => {
    const c = avgRecord(value, ['criterion', 'result', 'note'], 'sound check')
    return { criterion: avgEnum(c.criterion, AVG_SOUND_REVIEW_CRITERIA_V1, 'sound criterion'),
      result: avgEnum(c.result, ['pass', 'fail', 'unknown'] as const, 'sound check result'), note: avgText(c.note, 'sound check note', 2000, true) }
  }, AVG_SOUND_REVIEW_CRITERIA_V1.length), c => c.criterion, 'sound checks')
  const audioHash = e.audioHash === null ? null : avgHash(e.audioHash, 'observed sound hash')
  if (!checks.length || fields.observations.some(o => o !== 'audio') || fields.observations.includes('audio') !== (audioHash !== null)
    || (audioHash !== null) !== (audition !== null) || !fields.observations.length && !fields.unobserved.length) throw new Error('[avg-sound-review] 准确记录已播放声音与未观察项，不能用波形或文字冒充审听')
  return { schema: r.schema, version: 3, ...fields, soundEvidence: { audioHash,
    requestIdentityHash: avgHash(e.requestIdentityHash, 'observed sound request'), audition, checks, note: avgText(e.note, 'sound observation note', 4000) } }
}
