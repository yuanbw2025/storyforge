import { describe, expect, it } from 'vitest'
import { avgSoundPlanningFixtureV1 } from '../helpers/avg-sound-planning-fixture'
import { avgSoundAuthorReviewFixtureV3 } from '../helpers/avg-sound-review-fixture'
import { compileAvgSoundRequirementsV1 } from '../../src/lib/avg/sound-requirements'
import { parseAvgSoundPlanningBriefV1 } from '../../src/lib/avg/sound-production-brief'
import { buildAvgRawSoundArtifactV1 } from '../../src/lib/avg/sound-raw-contract'
import { assertAvgSoundReviewScopeV3, assertAvgSoundReviewSelectableV3,
  assertAvgSoundReviewMeasuredSelectableV3 } from '../../src/lib/avg/sound-review'

/** Pure metadata/observation scope. No producer, actual decoder, listening,
 * author adoption, generation or new public processing authority is claimed. */
async function fixture(loop = false) {
  const s = await avgSoundPlanningFixtureV1()
  s.scope.templates.find(t => t.requirementKey === 'desk.bgm')!.cue.loop = loop
  const compiled = await compileAvgSoundRequirementsV1(s.scope, s.plan)
  const requirement = compiled.requirements.find(r => r.template.requirementKey === 'desk.bgm')!
  const planning = parseAvgSoundPlanningBriefV1({ schema: 'storyforge.avg.sound-planning-brief', version: 1,
    scope: s.scope, aspectRatio: '16:9', musicBinding: { adapterId: 'storyforge.avg.local-music.v1', requirementKey: 'avg.media.music',
      bindingHash: '1'.repeat(64), endpointRouteHash: '2'.repeat(64) }, assembly: { schema: 'storyforge.avg.assembly-brief', version: 1,
      title: '声音观察工程', sceneKeys: s.workspace.systemPlan.scenes.map(x => x.key), mediaAssetKeys: s.scope.templates.map(t => t.assetKey), basePackageHash: null } })
  const raw = buildAvgRawSoundArtifactV1({ planning, requirement, scopeHash: '3'.repeat(64), planHash: '4'.repeat(64),
    measurement: { schema: 'storyforge.avg.sound-byte-measurement', version: 1, decoder: 'storyforge.avg.sound-browser.v1',
      contentHash: 'a'.repeat(64), mimeType: 'audio/wav', byteSize: 2_304_044, durationMs: 12_000,
      channelCount: 2, decodedSampleRateHz: 48000, integratedLufs: -18, truePeakDbtp: -12, loopSeamDbfs: -40 },
    providerResult: {}, requestSnapshotHash: '5'.repeat(64), responseEvidenceHash: '6'.repeat(64), contextHash: '7'.repeat(64), inputs: [] }).payload
  const report = avgSoundAuthorReviewFixtureV3(raw), audio = { contentHash: 'b'.repeat(64), durationMs: 12_000 }
  return { raw, report, target: { raw, audio } }
}

describe('AVG independent measured processed-sound review scope', () => {
  it('binds observation to the selected processed hash while preserving the strict original path and raw bytes', async () => {
    const s = await fixture(), original = JSON.stringify(s.raw), report = JSON.stringify(s.report)
    expect(assertAvgSoundReviewSelectableV3(s.report, s.raw)).toEqual(s.report)
    s.report.soundEvidence.audioHash = s.target.audio.contentHash
    expect(() => assertAvgSoundReviewScopeV3(s.report, s.raw)).toThrow(/准确声音/)
    expect(assertAvgSoundReviewMeasuredSelectableV3(s.report, s.target)).toEqual(s.report)
    expect(JSON.stringify(s.raw)).toBe(original)
    expect(JSON.stringify(assertAvgSoundReviewSelectableV3(JSON.parse(report), s.raw))).toBe(report)
  })
  it('refuses an old audition hash, wrong request, wrong duration or unobserved output', async () => {
    const s = await fixture()
    expect(() => assertAvgSoundReviewMeasuredSelectableV3(s.report, s.target)).toThrow(/准确声音/)
    s.report.soundEvidence.audioHash = s.target.audio.contentHash
    for (const mutate of [
      (r: typeof s.report) => { r.soundEvidence.requestIdentityHash = '0'.repeat(64) },
      (r: typeof s.report) => { r.soundEvidence.audition!.durationMs += 5 },
      (r: typeof s.report) => { r.soundEvidence.audition!.muted = true },
      (r: typeof s.report) => { r.soundEvidence.audition!.seeked = true },
    ]) { const report = structuredClone(s.report); mutate(report); expect(() => assertAvgSoundReviewMeasuredSelectableV3(report, s.target)).toThrow() }
  })
  it('retains the original two-cycle loop seam requirement for the actual selected sound', async () => {
    const s = await fixture(true); s.report.soundEvidence.audioHash = s.target.audio.contentHash
    expect(assertAvgSoundReviewMeasuredSelectableV3(s.report, s.target)).toEqual(s.report)
    s.report.soundEvidence.audition!.continuousLoops = 0
    expect(() => assertAvgSoundReviewMeasuredSelectableV3(s.report, s.target)).toThrow(/循环|观察/)
  })
})
