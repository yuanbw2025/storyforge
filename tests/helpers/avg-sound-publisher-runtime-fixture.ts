import { vi } from 'vitest'
import { avgSoundPublisherFixtureV2 } from './avg-sound-publisher-fixture'
import { avgSoundHarnessFixtureV1, adoptAvgSoundSourcesV1, adoptAvgSoundArtifactV1, cycleAvgSoundUntilV1,
  acceptedAvgSoundArtifactV1, confirmAvgSoundCandidateV1 } from './avg-sound-harness-fixture'
import { avgSoundAuthorReviewFixtureV3, avgSoundAuthorChoiceFixtureV1 } from './avg-sound-review-fixture'
import { avgSoundProductionBudgetV1, avgSoundProductionGateIdsV1 } from '../../src/lib/avg/sound-production-policy'
import { configureAvgChosenSoundDraftV1, stageAvgWorkspaceInputV1 } from '../../src/lib/avg/assembly-service'
import { readAvgDraftV1 } from '../../src/lib/avg/draft-service'

/** Actual S2/start/model proposal/author/compiler/raw/choice/CAS Stage path.
 * Only HTTP, the caller's unavailable DOM decoder and explicit ENGINEERING
 * hearing declarations are controlled. No real sample is approved by this. */
export async function avgPublisherSoundRawFixtureV2() {
  const actual = avgSoundPublisherFixtureV2(), audioFetcher = vi.fn(async (target: RequestInfo | URL, init?: RequestInit) => {
    if (String(target) !== `http://127.0.0.1:5298/v1/library/audio/${actual.source.archiveHash}/${actual.source.memberHash}` || init?.method !== 'GET') {
      throw new Error('Only one exact original library source is configured; no music/model/other provider route')
    }
    return new Response(actual.data.slice(0), { headers: { 'content-type': 'audio/ogg', 'x-storyforge-library-result': JSON.stringify(actual.result) } })
  })
  const s = await avgSoundHarnessFixtureV1({ libraryOnly: true, audioFetcher, configureSource: async source => {
    const brief = source.brief, sound = brief.avgSoundPlanning!, t = sound.scope.templates[0], oldAsset = t.assetKey
    sound.scope.librarySources = [actual.source]
    Object.assign(t, { requirementKey: 'desk.ambience', assetKey: 'publisher.desk.ambience', channel: 'ambience',
      purpose: 'ENGINEERING original declared rain ambience; not an actual listening or loop judgement',
      consumer: { ...t.consumer, consumerKey: 'publisher.desk.ambience.consumer', slot: 'ambience' },
      cue: { ...t.cue, cueKey: 'publisher.desk.ambience.cue', loop: false },
      source: { kind: 'licensed-library', allowedSourceKeys: [actual.source.sourceKey] } })
    sound.assembly.mediaAssetKeys = sound.assembly.mediaAssetKeys.map(key => key === oldAsset ? t.assetKey : key)
    source.plan.direction.goal = 'ENGINEERING exact declared publisher rain and external licence witness'
    source.plan.entries = source.plan.entries.filter(e => e.librarySourceKey !== null).map(e => ({ ...e, requirementKey: t.requirementKey,
      designIntent: 'ENGINEERING original rain ambience, not a listener judgement', librarySourceKey: actual.source.sourceKey,
      acceptanceNotes: ['ENGINEERING verify exact original source, independent observations and native ambience channel'] }))
    brief.media.requiredMediaKinds = ['ambience']
    brief.productionBudget = avgSoundProductionBudgetV1(brief)
    brief.completionContract.requiredGateIds = avgSoundProductionGateIdsV1(brief)
  } })
  await adoptAvgSoundSourcesV1(s); await cycleAvgSoundUntilV1(s, 'avg.proposal.sound-plan')
  await adoptAvgSoundArtifactV1(s, 'avg.media.sound-plan', s.author.plan)
  await cycleAvgSoundUntilV1(s, 'avg.media.compiled-sound-requirements')
  await cycleAvgSoundUntilV1(s, 'avg.sound.raw.desk.ambience')
  return { ...s, actual, audioFetcher }
}

export async function avgPublisherSoundStageFixtureV2() {
  const s = await avgPublisherSoundRawFixtureV2(), raw = (await acceptedAvgSoundArtifactV1(s, 'avg.sound.raw.desk.ambience'))!
  await adoptAvgSoundArtifactV1(s, 'avg.review.audio.desk.ambience', avgSoundAuthorReviewFixtureV3(JSON.parse(raw.payloadJson)))
  const review = (await acceptedAvgSoundArtifactV1(s, 'avg.review.audio.desk.ambience'))!
  await adoptAvgSoundArtifactV1(s, 'avg.sound.choice.desk.ambience', avgSoundAuthorChoiceFixtureV1(raw, review))
  const configured = await configureAvgChosenSoundDraftV1({ scope: s.scope, productionId: s.productionId,
    expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision })
  const candidate = await stageAvgWorkspaceInputV1({ scope: s.scope, productionId: s.productionId, expectedDraftRevision: configured.revision,
    artifactKey: 'avg.author.stage', declaration: 'ENGINEERING explicit original publisher Stage choice; controlled observations are not real hearing or commercial acceptance' })
  const adopted = await confirmAvgSoundCandidateV1(s, candidate)
  if (!adopted.ok) throw new Error(JSON.stringify(adopted))
  return { ...s, configured }
}
