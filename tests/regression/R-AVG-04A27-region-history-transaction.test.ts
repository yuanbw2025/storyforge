import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Dexie, { type Transaction } from 'dexie'
import { db } from '../../src/lib/db/schema'
import { putMediaBlobObject } from '../../src/lib/product-production/media-blob-store'
import { readAvgRegionCompositeInputsV1 } from '../../src/lib/avg/image-region-composite-source'
import { prepareNativeAvgAssembly, startNativeAvgAssembly } from '../helpers/avg-production-assembly-fixture'
import { avgRegionProcessedFixture } from '../helpers/avg-region-processed-fixture'
import { avgProfessionalFamilyScopeFixtureV4 } from '../helpers/avg-professional-family-scope-fixture'

const api = vi.hoisted(() => ({ compiled: vi.fn(), reused: vi.fn(), base: vi.fn(), moduleLoaded: vi.fn() }))
vi.mock('../../src/lib/avg/visual-image-history-v5', () => ({ readAvgHistoricalCompiledImageDefinitionV5: api.compiled, readAvgHistoricalRawImageV5: vi.fn() }))
vi.mock('../../src/lib/avg/media-generated-reference', () => ({ readAvgGeneratedReferenceForPurposeV2: api.base }))
vi.mock('../../src/lib/avg/visual-image-revalidation-v5', async () => {
  // A first native module load can outlive IDB's current event turn. A warm
  // import in an earlier author step must not be required for history reads.
  api.moduleLoaded(); await new Promise(resolve => setTimeout(resolve, 30))
  return { readAvgVisualRawReuseEvidenceV5: api.reused }
})
beforeEach(async () => { await db.delete(); await db.open(); api.compiled.mockReset(); api.reused.mockReset(); api.base.mockReset() })
afterEach(async () => { db.close(); await db.delete() })

describe('V3 historical composition source transaction', () => {
  it('keeps a readonly transaction alive during a cold reuse-module load and rereads both source boundaries without writes', async () => {
    const owner = await startNativeAvgAssembly(await prepareNativeAvgAssembly()), f = await avgRegionProcessedFixture()
    const blob = await putMediaBlobObject({ scope: owner.scope, data: f.pixels.sourceData, mimeType: 'image/png', expectedContentHash: f.pixels.source.contentHash })
    const build = owner.details.build!, template = avgProfessionalFamilyScopeFixtureV4().planning.templates.find(t => t.parameters.mediaKind === 'character-expression')!
    const requirement = { ...template.parameters, requirementKey: f.payload.requirementKey, width: 64, height: 64,
      prompt: 'Synthetic transaction source', negativePrompt: 'None', references: [f.reference], invariants: [], forbiddenDepictions: [] }
    const raw = { ...f.payload.raw, buildId: owner.buildId, controlEpoch: build.controlEpoch, blobObjectId: blob.id! }
    // Synthetic boundary adapters isolate transaction mechanics. These
    // carriers grant no real producer, retained-history or adoption authority.
    let held: Transaction | undefined
    const observe = async () => {
      expect(Dexie.currentTransaction).toBe(held)
      expect((await db.productBuilds.get(owner.buildId))!.id).toBe(owner.buildId)
    }
    api.compiled.mockImplementation(async () => {
      await observe(); return { build, production: owner.details.production, planning: { rawReuse: [{ requirementKey: requirement.requirementKey }] } }
    })
    api.reused.mockImplementation(async () => {
      await observe(); return { raw, asset: f.payload.sourceAsset, payload: { requirement }, requirement }
    })
    api.base.mockImplementation(async () => {
      await observe(); return { asset: f.inputEvidence.base.asset, family: requirement.family, referenceOnly: false, data: f.pixels.baseData }
    })
    const counts = async () => ({ artifacts: await db.productBuildArtifacts.count(), runs: await db.agentRuns.count(), blobs: await db.mediaBlobObjects.count() })
    const before = await counts(); let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await db.transaction('r', db.tables, async () => {
        held = Dexie.currentTransaction; timer = setTimeout(() => held!.abort(), 2000)
        return readAvgRegionCompositeInputsV1({ scope: owner.scope, recipe: f.payload.recipe,
          raw: { buildId: owner.buildId, artifactKey: raw.artifactKey, version: raw.version, contentHash: raw.contentHash },
          source: { mode: 'historical', frozen: { expectedBuildRevision: build.stateRevision,
            expectedBriefHash: build.briefHash, expectedPlanHash: build.planHash, controlEpoch: build.controlEpoch } } })
      })
      expect(result.input.sourceData).toEqual(f.pixels.sourceData)
      expect(result.input.baseData).toEqual(f.pixels.baseData)
    } finally { clearTimeout(timer) }
    expect(api.moduleLoaded).toHaveBeenCalledTimes(1)
    expect(api.compiled).toHaveBeenCalledTimes(2); expect(api.reused).toHaveBeenCalledTimes(2); expect(api.base).toHaveBeenCalledTimes(2)
    expect(await counts()).toEqual(before)
  }, 10_000)
})
