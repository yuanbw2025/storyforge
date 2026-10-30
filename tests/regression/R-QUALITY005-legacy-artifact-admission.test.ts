import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  createTextOpenWorldSourcePinCandidateArtifactsV1,
  validateTextOpenWorldSourcePinBundleV1,
} from '../../src/lib/open-world/source-pin'
import { acceptProductBuildArtifact, acceptTextOpenWorldSourcePinBundleArtifactsV1 } from '../../src/lib/product-production/artifact-store'
import type { TextOpenWorldSourcePinBundleV1 } from '../../src/lib/types'
import { seedQuality005LegacyNovelV1, snapshotQuality005RowsV1 } from '../helpers/quality005-legacy-novel'
import { generateTextOpenWorldCreatorArtifactEditCandidateV1 } from '../../src/lib/open-world/creator-artifact-edit'
import { readTextOpenWorldCreatorBuildNewWorkAuthorityV1 } from '../../src/lib/open-world/creator-derived-authority'
import { createTextOpenWorldCreatorReleaseFixtureV1 } from '../helpers/text-open-world-creator-release'

const SOURCE_REQUIRED = /WorldRelease|世界.*封存|派生.*世界|来源.*只读/

async function inputs() {
  const fixture = await seedQuality005LegacyNovelV1()
  // The V1 direct-P0 contract also accepts a producer-free historical envelope.
  // This explicit synthetic variant changes only optional producer locators;
  // all Pin/Unit/Start/hash bytes remain the captured originals. The strict
  // public direct-proof reader below must validate the variant itself.
  await db.productBuildArtifacts.where('buildId').equals(fixture.creator.buildId)
    .modify({ producerRunId: null, producerReceiptHash: null })
  const rows = await db.productBuildArtifacts.where('buildId').equals(fixture.creator.buildId).toArray()
  const pin = rows.find(row => row.kind === 'text-open-world.source-pin')!
  const units = rows.filter(row => row.kind === 'text-open-world.source-pin-unit')
  const bundle: TextOpenWorldSourcePinBundleV1 = await validateTextOpenWorldSourcePinBundleV1({
    pin: JSON.parse(pin.payloadJson), units: units.map(row => ({ payload: JSON.parse(row.payloadJson), artifactContentHash: row.contentHash })),
  })
  const artifact = createTextOpenWorldSourcePinCandidateArtifactsV1(bundle)[0]!
  return {
    fixture, rows, pin, bundle,
    single: {
      ...artifact, scope: fixture.scope, buildId: fixture.creator.buildId, controlEpoch: fixture.creator.controlEpoch,
      inputHash: pin.inputHash,
    },
    whole: {
      scope: fixture.scope, buildId: fixture.creator.buildId, controlEpoch: fixture.creator.controlEpoch, bundle,
    },
  }
}

describe('SFQA-005 · new accepted artifacts versus exact historical reads', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it.each(['direct', 'agent'] as const)('rejects an unmocked public legacy %s edit before context compilation, Run or model allocation', async mode => {
    const f = await seedQuality005LegacyNovelV1(), runAI = vi.fn(async () => 'must never dispatch')
    const before = await snapshotQuality005RowsV1()
    await expect(generateTextOpenWorldCreatorArtifactEditCandidateV1({ mode, runAI,
      selection: { scope: f.scope, productionId: f.creator.productionId, buildId: f.creator.buildId,
        artifactKey: 'text-open-world.story-arc', entityIdentity: 'story-arc.main', expectedSnapshotHash: '0'.repeat(64) },
      ...(mode === 'direct' ? { operations: [] } : { authorInstruction: 'Must use the explicit World source first.' }) }))
      .rejects.toThrow(SOURCE_REQUIRED)
    expect(runAI).not.toHaveBeenCalled()
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it('keeps the actual rich World authorization precondition available to the existing edit state machine', async () => {
    const f = await createTextOpenWorldCreatorReleaseFixtureV1('world-release')
    const before = await snapshotQuality005RowsV1()
    const authority = await readTextOpenWorldCreatorBuildNewWorkAuthorityV1({ scope: f.scope,
      buildId: f.creator.buildId, operation: 'new author edit World control' })
    expect(authority.contracts.sourcePlan.sourceKind).toBe('world-release')
    expect(authority.build.id).toBe(f.creator.buildId)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  }, 30_000)

  it('can strictly return the existing producer-free legacy bundle without changing its source or evidence', async () => {
    const value = await inputs()
    const before = await snapshotQuality005RowsV1()
    expect(await acceptTextOpenWorldSourcePinBundleArtifactsV1(value.whole)).toMatchObject({ pinArtifact: value.pin })
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it('preserves the existing prohibition on admitting individual SourcePin units', async () => {
    const value = await inputs()
    const before = await snapshotQuality005RowsV1()
    await expect(acceptProductBuildArtifact(value.single)).rejects.toThrow(/整包原子验收/)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it('does not let old direct-P0 author evidence recreate a missing bundle as new accepted production', async () => {
    const value = await inputs()
    // Isolated loss fixture: preserve all frozen producer/Start evidence. The
    // old writer could use it to grant a new accepted row; receipt/read APIs
    // must instead diagnose missing historical objects without recreating them.
    await db.productBuildArtifacts.where('buildId').equals(value.fixture.creator.buildId).delete()
    const before = await snapshotQuality005RowsV1()
    await expect(acceptTextOpenWorldSourcePinBundleArtifactsV1(value.whole)).rejects.toThrow(SOURCE_REQUIRED)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })
})
