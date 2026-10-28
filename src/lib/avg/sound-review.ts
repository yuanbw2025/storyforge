import type { buildAvgRawSoundArtifactV1 } from './sound-raw-contract'
import { parseAvgAuthorSoundReviewV3, type AvgSoundReviewCriterionV1 } from './sound-review-contract'
import { avgHash, avgNumber } from './protocol-validation'

export type AvgRawSoundPayloadV1 = ReturnType<typeof buildAvgRawSoundArtifactV1>['payload']
export interface AvgSoundMeasuredReviewTargetV1 {
  raw: AvgRawSoundPayloadV1
  audio: { contentHash: string; durationMs: number }
}
export function avgSoundReviewCriteriaV1(raw: AvgRawSoundPayloadV1): AvgSoundReviewCriterionV1[] {
  return ['purpose-fit', 'noise-distortion', 'clip-boundaries',
    ...(raw.requirement.dispatch.operation === 'generate-music' ? ['instrumental-only' as const] : []),
    ...(raw.requirement.template.cue.loop ? ['loop-seam' as const] : [])]
}
/** Only assesses an author's recorded observation. The service separately
 * proves the raw producer, original response and physical same-Work bytes. */
export function assertAvgSoundReviewScopeV3(value: unknown, raw: AvgRawSoundPayloadV1) {
  return assertAvgSoundReviewMeasuredScopeV3(value, { raw, audio: raw.measurement })
}
/** Pure observation scope only. The service must independently prove the
 * selected raw/processed producer and bytes; never alter the raw measurement
 * or transfer an old audition to a different processed hash. */
export function assertAvgSoundReviewMeasuredScopeV3(value: unknown, target: AvgSoundMeasuredReviewTargetV1) {
  const { raw } = target
  const contentHash = avgHash(target.audio.contentHash, 'reviewed sound content')
  const durationMs = avgNumber(target.audio.durationMs, 'reviewed sound duration', 1, 120_000, false)
  const report = parseAvgAuthorSoundReviewV3(value), evidence = report.soundEvidence, a = evidence.audition
  const t = raw.requirement.template, criteria = avgSoundReviewCriteriaV1(raw)
  const locations = new Set([t.requirementKey, t.assetKey, t.consumer.sceneKey, t.cue.beatKey])
  if (report.targetKey !== t.requirementKey || evidence.requestIdentityHash !== raw.requirement.identityHash
    || evidence.audioHash !== null && evidence.audioHash !== contentHash
    || a !== null && Math.abs(a.durationMs - durationMs) > 1
    || report.issues.some(i => !locations.has(i.locationKey)) || evidence.checks.length !== criteria.length
    || criteria.some(c => !evidence.checks.some(check => check.criterion === c))) throw new Error('[avg-sound-review] 观察不是准确声音、用途或循环需求')
  const heard = a !== null && a.playedMs > 0 && !a.muted && a.volume > 0 && a.playbackRate === 1 && !a.seeked
  const complete = heard && a.outcome === 'ended' && a.completedCycles >= 1 && a.playedMs >= a.durationMs * a.completedCycles - 1
  if (!complete && !report.unobserved.length) throw new Error('[avg-sound-review] 未完整原速播放，必须保留未观察项')
  for (const check of evidence.checks) {
    const observed = check.criterion !== 'loop-seam' || a !== null && a.continuousLoops >= 1 && a.completedCycles >= 1 && a.playedMs > a.durationMs
    const passingLoop = check.criterion !== 'loop-seam' || observed && a !== null && a.completedCycles >= 2
    if (check.result === 'unknown' && !report.unobserved.length || check.result === 'pass' && (!complete || !passingLoop)
      || check.result === 'fail' && (!heard || !observed)) throw new Error('[avg-sound-review] 缺少实际片段或循环接缝观察，不能签发该结论')
    if (check.result === 'fail' && (!check.note.trim() || !report.issues.some(i => i.issueKey === `sound.${check.criterion}` && i.severity === 'blocking'))) {
      throw new Error('[avg-sound-review] 失败项须保留准确blocking证据及返修交接')
    }
  }
  return report
}
export function assertAvgSoundReviewSelectableV3(value: unknown, raw: AvgRawSoundPayloadV1) {
  return assertAvgSoundReviewMeasuredSelectableV3(value, { raw, audio: raw.measurement })
}
export function assertAvgSoundReviewMeasuredSelectableV3(value: unknown, target: AvgSoundMeasuredReviewTargetV1) {
  const report = assertAvgSoundReviewMeasuredScopeV3(value, target)
  if (!report.observations.includes('audio') || report.unobserved.length || report.soundEvidence.checks.some(c => c.result !== 'pass')
    || report.issues.some(i => i.severity === 'blocking')) throw new Error('[avg-sound-review] 仍有未观察、失败或blocking项，不能选用声音')
  return report
}
export function assertAvgSoundReviewRevisionV3(previous: unknown | null, next: unknown) {
  if (previous === null) return
  const old = parseAvgAuthorSoundReviewV3(previous), current = parseAvgAuthorSoundReviewV3(next)
  const blocked = old.unobserved.length || old.issues.some(i => i.severity === 'blocking') || old.soundEvidence.checks.some(c => c.result !== 'pass')
  const passing = !current.unobserved.length && !current.issues.some(i => i.severity === 'blocking') && current.soundEvidence.checks.every(c => c.result === 'pass')
  if (blocked && passing && (old.soundEvidence.note.trim() === current.soundEvidence.note.trim()
    || old.soundEvidence.audition !== null && old.soundEvidence.audition.generation === current.soundEvidence.audition?.generation)) {
    throw new Error('[avg-sound-review] 解除未知或blocking须说明新的观察依据并重新播放')
  }
}
