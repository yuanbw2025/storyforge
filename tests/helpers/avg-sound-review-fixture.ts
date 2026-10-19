import { db } from '../../src/lib/db/schema'
import { avgSoundPlanningFixtureV1 } from './avg-sound-planning-fixture'
import { avgSoundWireFixtureV1, avgSoundLibraryFixtureV1 } from './avg-sound-provider-fixture'
import { avgSoundHarnessFixtureV1, adoptAvgSoundSourcesV1, adoptAvgSoundArtifactV1, cycleAvgSoundUntilV1, acceptedAvgSoundArtifactV1 } from './avg-sound-harness-fixture'
import { avgSoundReviewCriteriaV1, type AvgRawSoundPayloadV1 } from '../../src/lib/avg/sound-review'
import type { AvgSoundReviewIssuesV3 } from '../../src/lib/avg/sound-review-contract'
import type { AvgAuthorSoundChoiceV1 } from '../../src/lib/avg/sound-choice-contract'
import type { ProductBuildArtifactRecordV1 } from '../../src/lib/types'

/** Actual S2/start/adoption/Run authority. Only HTTP, the feature fence and
 * unavailable DOM decoder are controlled by callers. Review assertions below
 * are explicit ENGINEERING author declarations, never real hearing evidence. */
export async function avgSoundReviewStartFixtureV1() {
  const semantic = await avgSoundPlanningFixtureV1(), req = semantic.compiled.requirements.find(r => r.dispatch.operation === 'generate-music')!
  const wire = await avgSoundWireFixtureV1(req)
  const s = await avgSoundHarnessFixtureV1({ audioFetcher: wire.fetcher,
    additionalBindings: [{ requirementKey: 'avg.media.music', adapterId: 'storyforge.avg.local-music.v1', bindingHash: wire.route.bindingHash,
      provider: 'storyforge-local-music', model: wire.capability.model }], configureSource: async source => {
      source.brief.avgSoundPlanning!.scope.librarySources = [avgSoundLibraryFixtureV1().source]
      // This review suite deliberately exercises an actual frozen loop
      // requirement; the original raw-producer suite keeps its non-loop case.
      source.brief.avgSoundPlanning!.scope.templates.find(t => t.requirementKey === 'desk.bgm')!.cue.loop = true
      Object.assign(source.brief.avgSoundPlanning!.musicBinding!, wire.route)
      source.brief.capabilityRequirements.find(c => c.requirementKey === 'avg.media.music')!.capabilityHash = wire.route.bindingHash
    } })
  return { ...s, wire }
}
export async function avgSoundReviewHarnessFixtureV1() {
  const s = await avgSoundReviewStartFixtureV1()
  await adoptAvgSoundSourcesV1(s); await cycleAvgSoundUntilV1(s, 'avg.proposal.sound-plan')
  await adoptAvgSoundArtifactV1(s, 'avg.media.sound-plan', s.author.plan)
  await cycleAvgSoundUntilV1(s, 'avg.media.compiled-sound-requirements')
  await cycleAvgSoundUntilV1(s, 'avg.sound.raw.desk.bgm'); await cycleAvgSoundUntilV1(s, 'avg.sound.raw.desk.sfx')
  return s
}
export function avgSoundAuthorReviewFixtureV3(raw: AvgRawSoundPayloadV1, heard = true): AvgSoundReviewIssuesV3 {
  const cycles = raw.requirement.template.cue.loop ? 2 : 1
  return { schema: 'storyforge.avg.review-issues', version: 3, targetKey: raw.requirement.template.requirementKey,
    observations: heard ? ['audio'] : [], unobserved: heard ? [] : ['ENGINEERING unknown hearing'], issues: [], soundEvidence: {
      audioHash: heard ? raw.measurement.contentHash : null, requestIdentityHash: raw.requirement.identityHash,
      audition: heard ? { generation: `audition.${crypto.randomUUID()}`, outcome: 'ended', durationMs: raw.measurement.durationMs,
        playedMs: raw.measurement.durationMs * cycles, completedCycles: cycles, continuousLoops: cycles - 1,
        muted: false, volume: 1, playbackRate: 1, seeked: false } : null,
      checks: avgSoundReviewCriteriaV1(raw).map(criterion => ({ criterion, result: heard ? 'pass' : 'unknown', note: 'ENGINEERING author declaration only' })),
      note: heard ? 'ENGINEERING declared observed; not native playback or real listening' : 'ENGINEERING has not observed the audio' } }
}
export function avgSoundAuthorChoiceFixtureV1(raw: ProductBuildArtifactRecordV1, review: ProductBuildArtifactRecordV1): AvgAuthorSoundChoiceV1 {
  const payload = JSON.parse(raw.payloadJson) as AvgRawSoundPayloadV1
  const ref = (r: ProductBuildArtifactRecordV1) => ({ artifactKey: r.artifactKey, version: r.version, contentHash: r.contentHash })
  return { schema: 'storyforge.avg.sound-choice', version: 1, requirementKey: payload.requirement.template.requirementKey,
    requestIdentityHash: payload.requirement.identityHash, raw: ref(raw), review: ref(review), asset: JSON.parse(raw.metadataJson),
    declaration: 'ENGINEERING author requests preview use of exact original licence/source; no commercial acceptance' }
}
export async function adoptAvgSoundReviewFixtureV3(s: Awaited<ReturnType<typeof avgSoundReviewHarnessFixtureV1>>, key: string, heard = true) {
  const raw = (await acceptedAvgSoundArtifactV1(s, `avg.sound.raw.${key}`))!
  await adoptAvgSoundArtifactV1(s, `avg.review.audio.${key}`, avgSoundAuthorReviewFixtureV3(JSON.parse(raw.payloadJson), heard))
  return { raw, review: (await acceptedAvgSoundArtifactV1(s, `avg.review.audio.${key}`))! }
}
export async function avgSoundChoiceReadInputV1(s: Awaited<ReturnType<typeof avgSoundReviewHarnessFixtureV1>>) {
  const build = (await db.productBuilds.get(s.buildId))!
  return { scope: s.scope, buildId: s.buildId, expectedBuildRevision: build.stateRevision, controlEpoch: build.controlEpoch }
}
