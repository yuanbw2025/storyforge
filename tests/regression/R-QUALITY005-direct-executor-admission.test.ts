import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import type { ProductProductionTaskExecutionInputV1, ProductProductionTaskExecutorV1 } from '../../src/lib/product-production/scheduler'
import { executeTextOpenWorldProductionModelProtocolV1 } from '../../src/lib/open-world/production-model-protocol'
import { createTextOpenWorldProductionExecutorV1 } from '../../src/lib/open-world/production-executor'
import { readTextOpenWorldCreatorExecutionBriefV1 } from '../../src/lib/open-world/creator-production-start'
import { seedQuality005LegacyNovelV1, snapshotQuality005RowsV1 } from '../helpers/quality005-legacy-novel'
import { createTextOpenWorldSourceLockExecutorV1 } from '../../src/lib/open-world/production-executor'
import { createTextOpenWorldSourceCurationExecutorV1 } from '../../src/lib/open-world/source-curation'
import { createTextOpenWorldExperienceDesignExecutorV1 } from '../../src/lib/open-world/experience-design'
import { createTextOpenWorldGameplayRulesetExecutorV1 } from '../../src/lib/open-world/gameplay-ruleset'
import { createTextOpenWorldPresentationProfileExecutorV1 } from '../../src/lib/open-world/presentation-profile'
import { createTextOpenWorldStoryArchitectureExecutorV1 } from '../../src/lib/open-world/story-architecture'
import { createTextOpenWorldRegionSkeletonExecutorV1 } from '../../src/lib/open-world/region-skeleton'
import { createTextOpenWorldPlayerBuildExecutorV1 } from '../../src/lib/open-world/player-build'
import { createTextOpenWorldMainlineExecutorV1 } from '../../src/lib/open-world/mainline-production'
import { createTextOpenWorldSignificantThreadsExecutorV1 } from '../../src/lib/open-world/significant-threads-production'
import { createTextOpenWorldRegionNarrativePacksExecutorV1 } from '../../src/lib/open-world/region-narrative-packs-production'
import { createTextOpenWorldQuestSkeletonsExecutorV1 } from '../../src/lib/open-world/quest-skeletons-production'
import { createTextOpenWorldProgressionCatalogsExecutorV1 } from '../../src/lib/open-world/progression-catalogs-production'
import { createTextOpenWorldEncounterCatalogExecutorV1 } from '../../src/lib/open-world/encounter-catalog-production'
import { createTextOpenWorldItemRewardCatalogExecutorV1 } from '../../src/lib/open-world/item-reward-catalog-production'
import { createTextOpenWorldCraftingEconomyCatalogExecutorV1 } from '../../src/lib/open-world/crafting-economy-catalog-production'
import { createTextOpenWorldNpcRuntimeCatalogExecutorV1 } from '../../src/lib/open-world/npc-runtime-catalog-production'
import { createTextOpenWorldMapInteractionCatalogExecutorV1 } from '../../src/lib/open-world/map-interaction-catalog-production'
import { createTextOpenWorldQuestFinalizeExecutorV1 } from '../../src/lib/open-world/quest-finalize-production'
import { createTextOpenWorldSceneScriptsExecutorV1 } from '../../src/lib/open-world/scene-scripts-production'
import { createTextOpenWorldSystemFinalizeExecutorV1 } from '../../src/lib/open-world/system-finalize-production'
import { createTextOpenWorldDeterministicPreflightExecutorV1 } from '../../src/lib/open-world/system-finalize-production'
import { createTextOpenWorldBalanceReviewExecutorV1 } from '../../src/lib/open-world/quality-review-production'
import { createTextOpenWorldSemanticReviewExecutorV1 } from '../../src/lib/open-world/quality-review-production'
import { createTextOpenWorldRuntimePackageExecutorV1 } from '../../src/lib/open-world/runtime-package-production'
import { createTextOpenWorldReleaseQaExecutorV1 } from '../../src/lib/open-world/runtime-package-production'
import * as sourceAdmission from '../../src/lib/open-world/source-admission'
import { createTextOpenWorldCreatorReleaseFixtureV1 } from '../helpers/text-open-world-creator-release'

const stages: Array<[string, () => ProductProductionTaskExecutorV1]> = [
  ['p0.source-lock', createTextOpenWorldSourceLockExecutorV1],
  ['p1.source-curation', createTextOpenWorldSourceCurationExecutorV1],
  ['p2.experience-design', createTextOpenWorldExperienceDesignExecutorV1],
  ['p2.gameplay-ruleset', createTextOpenWorldGameplayRulesetExecutorV1],
  ['p2.presentation-profile', createTextOpenWorldPresentationProfileExecutorV1],
  ['p3.story-architecture', createTextOpenWorldStoryArchitectureExecutorV1],
  ['p4.region-skeleton', createTextOpenWorldRegionSkeletonExecutorV1],
  ['p4.player-build', createTextOpenWorldPlayerBuildExecutorV1],
  ['p5.mainline', createTextOpenWorldMainlineExecutorV1],
  ['p6.significant-threads', createTextOpenWorldSignificantThreadsExecutorV1],
  ['p7.region-narrative-packs', createTextOpenWorldRegionNarrativePacksExecutorV1],
  ['p8.quest-skeletons', createTextOpenWorldQuestSkeletonsExecutorV1],
  ['p8.catalog.progression', createTextOpenWorldProgressionCatalogsExecutorV1],
  ['p8.catalog.encounters', createTextOpenWorldEncounterCatalogExecutorV1],
  ['p8.catalog.items-rewards', createTextOpenWorldItemRewardCatalogExecutorV1],
  ['p8.catalog.crafting-economy', createTextOpenWorldCraftingEconomyCatalogExecutorV1],
  ['p8.catalog.npc-runtime', createTextOpenWorldNpcRuntimeCatalogExecutorV1],
  ['p8.catalog.map-interactions', createTextOpenWorldMapInteractionCatalogExecutorV1],
  ['p8f.quest-finalize', createTextOpenWorldQuestFinalizeExecutorV1],
  ['p9.scene-scripts', createTextOpenWorldSceneScriptsExecutorV1],
  ['p10.system-finalize', createTextOpenWorldSystemFinalizeExecutorV1],
  ['v1.deterministic-preflight', createTextOpenWorldDeterministicPreflightExecutorV1],
  ['v2.balance-review', createTextOpenWorldBalanceReviewExecutorV1],
  ['v2.semantic-review', createTextOpenWorldSemanticReviewExecutorV1],
  ['v3.runtime-package', createTextOpenWorldRuntimePackageExecutorV1],
  ['qa.release', createTextOpenWorldReleaseQaExecutorV1],
]

async function execution(taskKey: string) {
  const f = await seedQuality005LegacyNovelV1()
  const build = (await db.productBuilds.get(f.creator.buildId))!
  const task = parseProductProductionPlanV3(build.planJson).tasks.find(row => row.taskKey === taskKey)!
  if (!task) throw new Error('Legacy task absent from the fixed fixture')
  const input: ProductProductionTaskExecutionInputV1 = { scope: f.scope, productionId: f.creator.productionId,
    buildId: build.id!, buildNumber: build.buildNumber, controlEpoch: build.controlEpoch, planHash: build.planHash,
    task, attempt: 1, idempotencyKey: '005-source-admission', contextText: '{}', inputArtifacts: [],
    capabilityBindings: [], authorResolution: null, signal: new AbortController().signal }
  return { f, build, input }
}

describe('SFQA-005 · direct product executors cannot bypass source admission', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => vi.restoreAllMocks())
  afterAll(() => db.close())

  it.each(stages)('rejects legacy %s before stage parsing, model dispatch, Run or Artifact writes', async (taskKey, create) => {
    const { input } = await execution(taskKey)
    const before = await snapshotQuality005RowsV1()
    await expect(create()(input)).rejects.toThrow(/WorldRelease|派生.*世界/)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it('rejects the configured-model protocol before calling its factory or transport', async () => {
    const { input } = await execution('p2.experience-design')
    const modelTransport = vi.fn(async () => { throw new Error('must never dispatch') })
    const factory = vi.fn(() => vi.fn(async () => { throw new Error('must never execute') }))
    const before = await snapshotQuality005RowsV1()
    await expect(executeTextOpenWorldProductionModelProtocolV1({ execution: input, factory, modelTransport }))
      .rejects.toThrow(/WorldRelease|派生.*世界/)
    expect(factory).not.toHaveBeenCalled(); expect(modelTransport).not.toHaveBeenCalled()
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it('rejects an injected direct dispatcher executor before granting its override authority', async () => {
    const { f, build, input } = await execution('p2.experience-design')
    const production = (await db.productProductions.get(f.creator.productionId))!
    const row = (await db.productProductionBriefs.toArray())[0]
    const { executionBrief } = await readTextOpenWorldCreatorExecutionBriefV1({ briefRow: row, planJson: build.planJson })
    const override = vi.fn(async () => { throw new Error('must never execute') })
    const before = await snapshotQuality005RowsV1()
    await expect(createTextOpenWorldProductionExecutorV1({ production, brief: executionBrief,
      taskExecutors: { 'p2.experience-design': override } })(input)).rejects.toThrow(/WorldRelease|派生.*世界/)
    expect(override).not.toHaveBeenCalled()
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it('captures a real World task and scope before the new asynchronous admission gate yields', async () => {
    const f = await createTextOpenWorldCreatorReleaseFixtureV1('world-release')
    const build = (await db.productBuilds.get(f.creator.buildId))!
    const task = parseProductProductionPlanV3(build.planJson).tasks.find(row => row.taskKey === 'p0.source-lock')!
    const input: ProductProductionTaskExecutionInputV1 = { scope: { ...f.scope }, productionId: f.creator.productionId,
      buildId: build.id!, buildNumber: build.buildNumber, controlEpoch: build.controlEpoch, planHash: build.planHash,
      task, attempt: 1, idempotencyKey: '005-captured-world-task', contextText: '{}', inputArtifacts: [],
      capabilityBindings: [], authorResolution: null, signal: new AbortController().signal }
    const actualGate = sourceAdmission.assertTextOpenWorldBuildNewWorkV1
    let injected = 0
    vi.spyOn(sourceAdmission, 'assertTextOpenWorldBuildNewWorkV1').mockImplementation(async value => {
      await actualGate(value)
      if (!injected) { input.scope.workId += 1000; input.task.taskKey = 'p0.changed-after-check'; injected += 1 }
    })
    const before = await snapshotQuality005RowsV1()
    const outcome = await createTextOpenWorldSourceLockExecutorV1({ now: () => f.creator.start.authorizedAt })(input)
      .then(result => ({ ok: true, kinds: result.artifacts.map(row => row.kind), error: '' }),
        (error: unknown) => ({ ok: false, kinds: [], error: String(error) }))
    expect(injected).toBe(1)
    expect(outcome.ok, outcome.error).toBe(true)
    expect(outcome.kinds).toContain('text-open-world.source-pin')
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  }, 30_000)

  it('detaches only plain task data while retaining live AbortSignal and durable writer callback identities', async () => {
    const { input } = await execution('p0.source-lock'), abort = new AbortController()
    const onModelOutput = vi.fn(async (_output: string) => undefined)
    const onMediaOutput = vi.fn(async (_output: string) => undefined)
    const beforeAdditionalModelRequest = vi.fn(async () => 'discarded-stale' as const)
    Object.assign(input, { signal: abort.signal, onModelOutput, onMediaOutput, beforeAdditionalModelRequest })
    const originalTask = structuredClone(input.task), originalScope = structuredClone(input.scope)
    const captured = sourceAdmission.captureTextOpenWorldTaskExecutionInputV1(input)
    input.scope.workId += 1000; input.task.taskKey = 'modified-after-capture'
    input.capabilityBindings.push({ requirementKey: 'later', adapterId: 'later', bindingHash: '0'.repeat(64) })
    expect(captured.scope).toEqual(originalScope); expect(captured.task).toEqual(originalTask)
    expect(captured.capabilityBindings).toEqual([])
    expect(captured.signal).toBe(abort.signal)
    expect(captured.onModelOutput).toBe(onModelOutput); expect(captured.onMediaOutput).toBe(onMediaOutput)
    expect(captured.beforeAdditionalModelRequest).toBe(beforeAdditionalModelRequest)
    abort.abort(); expect(captured.signal.aborted).toBe(true)
    expect(onModelOutput).not.toHaveBeenCalled(); expect(onMediaOutput).not.toHaveBeenCalled()
  })
})
