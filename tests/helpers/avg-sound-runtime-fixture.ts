import { db } from '../../src/lib/db/schema'
import { readProductProductionDetailsV1 } from '../../src/lib/product-production/service'
import { runProductProductionSchedulerCycleV1 } from '../../src/lib/product-production/scheduler'
import { configureAvgChosenSoundDraftV1, stageAvgWorkspaceInputV1 } from '../../src/lib/avg/assembly-service'
import { readAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { avgSoundReviewHarnessFixtureV1, adoptAvgSoundReviewFixtureV3, avgSoundAuthorChoiceFixtureV1 } from './avg-sound-review-fixture'
import { adoptAvgSoundArtifactV1, confirmAvgSoundCandidateV1 } from './avg-sound-harness-fixture'

/** Actual bounded source/model/raw/author/CAS/Stage commands. HTTP/decoder and
 * hearing declarations remain explicitly controlled engineering observations. */
export async function avgSoundRuntimeStageFixtureV1() {
  const s = await avgSoundReviewHarnessFixtureV1()
  for (const key of ['desk.bgm', 'desk.sfx']) {
    const { raw, review } = await adoptAvgSoundReviewFixtureV3(s, key)
    await adoptAvgSoundArtifactV1(s, `avg.sound.choice.${key}`, avgSoundAuthorChoiceFixtureV1(raw, review))
  }
  const configured = await configureAvgChosenSoundDraftV1({ scope: s.scope, productionId: s.productionId,
    expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision })
  const candidate = await stageAvgWorkspaceInputV1({ scope: s.scope, productionId: s.productionId, expectedDraftRevision: configured.revision,
    artifactKey: 'avg.author.stage', declaration: 'ENGINEERING preview-only Stage, all sound hearing declarations are controlled, no commercial acceptance' })
  const adopted = await confirmAvgSoundCandidateV1(s, candidate)
  if (!adopted.ok) throw new Error(JSON.stringify(adopted))
  return { ...s, configured }
}
export async function finishAvgSoundRuntimeFixtureV1(s: Awaited<ReturnType<typeof avgSoundRuntimeStageFixtureV1>>) {
  for (let i = 0; i < 12; i++) {
    const build = (await db.productBuilds.get(s.buildId))!
    if (build.status === 'preview-ready') return readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])
    if (['failed', 'recovery-required', 'cancelled', 'paused'].includes(build.status)) throw new Error(`Actual sound runtime stopped: ${build.status}: ${build.failureJson}`)
    await runProductProductionSchedulerCycleV1(s)
  }
  const build = (await db.productBuilds.get(s.buildId))!
  throw new Error(`Actual sound runtime did not reach Preview in bounded cycles: ${build.status}: ${build.failureJson}`)
}
