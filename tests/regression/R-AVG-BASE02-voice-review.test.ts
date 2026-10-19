import { describe, expect, it } from 'vitest'
import { avgRawVoiceFixtureV1 } from '../helpers/avg-voice-production-fixture'
import type { AvgReviewIssuesV1 } from '../../src/lib/avg/artifact-contract'
import { parseAvgProfessionalArtifactV1 } from '../../src/lib/avg/artifact-contract'
import { AVG_VOICE_REVIEW_CRITERIA_V1 } from '../../src/lib/avg/voice-review-contract'
import { assertAvgVoiceReviewRevisionV1, assertAvgVoiceReviewScopeV1, assertAvgVoiceReviewSelectableV1 } from '../../src/lib/avg/voice-review'

async function fixture() {
  const { payload: raw } = await avgRawVoiceFixtureV1()
  const report: AvgReviewIssuesV1 = { schema: 'storyforge.avg.review-issues', version: 1, targetKey: raw.requirement.requirementKey,
    observations: ['audio'], unobserved: [], issues: [], audioEvidence: { audioHash: raw.measurement.contentHash,
      requestIdentityHash: raw.request.identityHash, audition: { generation: 'audition.fixture.1', outcome: 'ended', durationMs: 1000,
        playedMs: 1000, muted: false, volume: 1, playbackRate: 1, seeked: false }, note: '合同测试的作者观察声明；不是实际播放或独立审听证据。',
      checks: AVG_VOICE_REVIEW_CRITERIA_V1.map(criterion => ({ criterion, result: 'pass', note: '工程声明，仅验合同。' })) } }
  return { raw, report }
}

describe('AVG BASE-02 separate author audition/issue contract', () => {
  it('requires all five author checks over the exact clip/request while old review payloads retain their shape', async () => {
    const { raw, report } = await fixture()
    expect(assertAvgVoiceReviewSelectableV1(report, raw)).toEqual(report)
    const legacy = { schema: 'storyforge.avg.review-issues', version: 1, targetKey: 'content', observations: ['text'], unobserved: [], issues: [] }
    expect(parseAvgProfessionalArtifactV1(legacy)).toEqual(legacy)
    expect(parseAvgProfessionalArtifactV1(legacy)).not.toHaveProperty('audioEvidence')
  })

  it.each([{ playedMs: 300 }, { outcome: 'failed' }, { outcome: 'interrupted' }, { seeked: true },
    { muted: true }, { volume: 0 }, { playbackRate: 2 }])('does not let incomplete/inaudible/altered playback %j become a pass', async patch => {
    const { raw, report } = await fixture()
    report.audioEvidence!.audition = { ...report.audioEvidence!.audition!, ...patch } as NonNullable<typeof report.audioEvidence>['audition']
    expect(() => assertAvgVoiceReviewSelectableV1(report, raw)).toThrow()
    report.unobserved = ['尚未完整审听。']
    expect(() => assertAvgVoiceReviewScopeV1(report, raw)).toThrow(/未完成实际审听/)
    report.audioEvidence!.checks.forEach(c => { c.result = 'unknown' })
    expect(assertAvgVoiceReviewScopeV1(report, raw)).toEqual(report)
    expect(() => assertAvgVoiceReviewSelectableV1(report, raw)).toThrow(/未知/)
  })

  it('records a blocking error heard in an interrupted fragment without approving the rest of the clip', async () => {
    const { raw, report } = await fixture()
    report.audioEvidence!.audition!.outcome = 'interrupted'; report.audioEvidence!.audition!.playedMs = 300
    report.unobserved = ['发现错句后停止，未审听余下音频。']
    report.audioEvidence!.checks.forEach(c => { c.result = 'unknown' })
    report.audioEvidence!.checks[0] = { criterion: 'text-match', result: 'fail', note: '首句漏读“封口”。' }
    report.issues = [{ issueKey: 'audio.text-match', locationKey: raw.requirement.lineKey, evidence: '已听片段漏字。', severity: 'blocking',
      owner: 'media', allowedChange: '仅返修该句配音。', impact: '字幕与音频不一致。', recheck: '完整重新审听新 clip。' }]
    expect(assertAvgVoiceReviewScopeV1(report, raw)).toEqual(report)
    expect(() => assertAvgVoiceReviewSelectableV1(report, raw)).toThrow(/blocking/)
    report.issues = []
    expect(() => assertAvgVoiceReviewScopeV1(report, raw)).toThrow(/blocking 证据/)
  })

  it('cannot approve a zero-played fragment using the one-millisecond duration tolerance', async () => {
    const { raw, report } = await fixture()
    raw.measurement.durationMs = 1
    report.audioEvidence!.audition!.durationMs = 1
    report.audioEvidence!.audition!.playedMs = 0
    expect(() => assertAvgVoiceReviewSelectableV1(report, raw)).toThrow(/未完整/)
  })

  it('keeps entirely unobserved clips unknown and refuses text-only, waveform-only or silent self-approval', async () => {
    const { raw, report } = await fixture()
    report.observations = []; report.unobserved = ['尚未播放。']
    report.audioEvidence!.audioHash = null; report.audioEvidence!.audition = null
    report.audioEvidence!.checks.forEach(c => { c.result = 'unknown' })
    expect(assertAvgVoiceReviewScopeV1(report, raw)).toEqual(report)
    expect(() => assertAvgVoiceReviewSelectableV1(report, raw)).toThrow()
    report.observations = ['text']
    expect(() => assertAvgVoiceReviewScopeV1(report, raw)).toThrow(/冒充审听/)
  })

  it('rejects a different clip, line, request/performance identity or duration even when checkboxes all pass', async () => {
    const { raw, report } = await fixture()
    for (const changed of [
      { ...report, targetKey: 'other.line' },
      { ...report, audioEvidence: { ...report.audioEvidence!, audioHash: 'a'.repeat(64) } },
      { ...report, audioEvidence: { ...report.audioEvidence!, requestIdentityHash: 'a'.repeat(64) } },
      { ...report, audioEvidence: { ...report.audioEvidence!, audition: { ...report.audioEvidence!.audition!, durationMs: 2000 } } },
    ]) expect(() => assertAvgVoiceReviewSelectableV1(changed, raw)).toThrow(/准确音频/)
  })

  it('rejects missing/duplicate/unknown criteria, inferred time and a stale unchanged explanation for lifting a block', async () => {
    const { raw, report } = await fixture()
    for (const checks of [report.audioEvidence!.checks.slice(1), Array(1), [...report.audioEvidence!.checks.slice(1), report.audioEvidence!.checks[1]!],
      report.audioEvidence!.checks.map((c, i) => i ? c : { ...c, result: 'not-applicable' })]) {
      expect(() => parseAvgProfessionalArtifactV1({ ...report, audioEvidence: { ...report.audioEvidence, checks } })).toThrow()
    }
    expect(() => parseAvgProfessionalArtifactV1({ ...report, audioEvidence: { ...report.audioEvidence, estimatedDurationMs: 1000 } })).toThrow()
    const old = structuredClone(report); old.unobserved = ['未审听完整。']; old.audioEvidence!.checks.forEach(c => { c.result = 'unknown' })
    expect(() => assertAvgVoiceReviewRevisionV1(old, report)).toThrow(/重新观察依据/)
    report.audioEvidence!.note = '重新完整审听这个准确 clip，已核对首尾、原句和演法。'
    expect(() => assertAvgVoiceReviewRevisionV1(old, report)).not.toThrow()
    expect(assertAvgVoiceReviewSelectableV1(report, raw)).toBeDefined()
  })
})
