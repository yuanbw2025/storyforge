import { parseAvgProfessionalArtifactV1 } from './artifact-contract'
import type { AvgRawVoicePayloadV1 } from './voice-raw-contract'

/** Author evaluation only. Raw producer/response/Blob/source authority and
 * actual browser byte validation are separate service obligations. */
export function parseAvgAuthorVoiceReviewV1(value: unknown) {
  const report = parseAvgProfessionalArtifactV1(value)
  if (report.schema !== 'storyforge.avg.review-issues' || !report.audioEvidence || report.visualEvidence
    || report.observations.some(o => o !== 'audio') || !report.observations.length && !report.unobserved.length
    || report.observations.includes('audio') !== (report.audioEvidence.audioHash !== null)
    || (report.audioEvidence.audioHash !== null) !== (report.audioEvidence.audition !== null)) {
    throw new Error('[avg-voice] 请准确记录已审听的音频和未观察项，不能以文本或波形评审冒充审听')
  }
  return report
}

export function assertAvgVoiceReviewScopeV1(value: unknown, raw: AvgRawVoicePayloadV1) {
  const report = parseAvgAuthorVoiceReviewV1(value), evidence = report.audioEvidence!
  const r = raw.requirement, a = evidence.audition
  const locations = new Set([r.requirementKey, r.assetKey, r.lineKey, r.sceneKey, r.speakerKey])
  if (report.targetKey !== r.requirementKey || evidence.requestIdentityHash !== raw.request.identityHash
    || evidence.audioHash !== null && evidence.audioHash !== raw.measurement.contentHash
    || a !== null && Math.abs(a.durationMs - raw.measurement.durationMs) > 1
    || report.issues.some(issue => !locations.has(issue.locationKey))) {
    throw new Error('[avg-voice] 审听不属于准确音频、台词、音色或演法修订')
  }
  const complete = a?.outcome === 'ended' && !a.muted && a.volume > 0 && a.playbackRate === 1 && !a.seeked
    && a.playedMs > 0 && a.playedMs >= a.durationMs - 1
  const partlyHeard = a !== null && a.playedMs > 0 && !a.muted && a.volume > 0 && a.playbackRate === 1 && !a.seeked
  if (!complete && report.unobserved.length === 0) throw new Error('[avg-voice] 未完整原速审听准确音频，须保留未观察项')
  for (const check of evidence.checks) {
    if (check.result === 'unknown' && !report.unobserved.length) throw new Error('[avg-voice] 未知审听结论须明确记录未观察项')
    if (!complete && check.result === 'pass' || !partlyHeard && check.result === 'fail') {
      throw new Error('[avg-voice] 未完成实际审听不能签发通过；失败结论也必须有实际听到的片段')
    }
    if (check.result === 'fail' && (!check.note.trim() || !report.issues.some(issue =>
      issue.issueKey === `audio.${check.criterion}` && issue.severity === 'blocking'))) {
      throw new Error('[avg-voice] 失败审听项须记录对应 blocking 证据与返修交接')
    }
  }
  return report
}

export function assertAvgVoiceReviewSelectableV1(value: unknown, raw: AvgRawVoicePayloadV1) {
  const report = assertAvgVoiceReviewScopeV1(value, raw)
  if (!report.observations.includes('audio') || report.unobserved.length
    || report.audioEvidence!.checks.some(check => check.result !== 'pass') || report.issues.some(issue => issue.severity === 'blocking')) {
    throw new Error('[avg-voice] 审听仍有未知、失败或 blocking 问题，须返修并重新审听后再选择')
  }
  return report
}

export function assertAvgVoiceReviewRevisionV1(previous: unknown | null, next: unknown) {
  if (previous === null) return
  const old = parseAvgAuthorVoiceReviewV1(previous), current = parseAvgAuthorVoiceReviewV1(next)
  const wasBlocked = old.unobserved.length > 0 || old.issues.some(issue => issue.severity === 'blocking')
    || old.audioEvidence!.checks.some(check => check.result !== 'pass')
  const isPass = current.unobserved.length === 0 && !current.issues.some(issue => issue.severity === 'blocking')
    && current.audioEvidence!.checks.every(check => check.result === 'pass')
  if (wasBlocked && isPass && old.audioEvidence!.note.trim() === current.audioEvidence!.note.trim()) {
    throw new Error('[avg-voice] 解除审听未知或 blocking 结论须说明本次重新观察依据')
  }
}
