import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { assertAdventureRuntimeDiceSupportV1, availableAdventureActions, createInitialAdventureState, parseAdventureContent } from '../../src/lib/adventure/runtime'
import { commitAdventureAction, readProductRuntimeState, readProductRuntimeStateVersion } from '../../src/lib/adventure/runtime-api'
import { parseProductRuntimeDiceExpressionV1 } from '../../src/lib/product/runtime-dice'
import { createProductRuntimeInstanceFromSource } from '../../src/lib/product/runtime-instances'
import { productReleaseUidV1 } from '../../src/lib/product/source-contracts'
import { createProductBuildPreviewManifestV1, verifyProductBuildPreviewManifestV1, verifyRestoredProductBuildPreviewManifestV1 } from '../../src/lib/product-production/preview-manifest'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { createProductReleaseManifestV1, productReleaseIdentityHashV1, verifyProductReleaseManifestV1 } from '../../src/lib/product-production/runtime-package'
import type { ProductRuntimePackageV1 } from '../../src/lib/types'
import { seedCurrentProductBuild } from '../helpers/current-product-build'
import { loadCurrentProductWorldSourceCatalogV1, seedCurrentProductWorld } from '../helpers/current-product-world'
import { createTextAdventureFoundationContentV2, createTextAdventureFoundationRuntimePackageV2 } from '../helpers/text-adventure-v2-foundation'
import { createFixtureProductReleaseManifestV1 } from '../helpers/product-release-v1'

const RANDOM_ACTION = 'action.search.cache'
function setDice(pkg: Pick<ProductRuntimePackageV1, 'adventure'>, expression: string) {
  const action = pkg.adventure!.actions.find(action => action.key === RANDOM_ACTION)!
  if (action.rule.kind !== 'random') throw new Error('Fixture random action is missing')
  action.rule.expression = expression
}
async function fixture() {
  const owned = await seedCurrentProductWorld('SFQA-109 isolated dice admission')
  const sourceCatalog = await loadCurrentProductWorldSourceCatalogV1({ scope: owned.scope, worldReleaseId: owned.release.id!, productType: 'text-adventure' })
  const runtimePackage = createTextAdventureFoundationRuntimePackageV2({ worldRelease: { ...owned.release, id: owned.release.id! }, sourceCatalog })
  return { ...owned, runtimePackage }
}
async function commit(sessionId: number, actionKey: string) {
  const base = await readProductRuntimeStateVersion(sessionId)
  return commitAdventureAction({ sessionId, actionKey, commandId: crypto.randomUUID(), baseSequence: base.sequence, baseStateHash: base.stateHash })
}

// Reconstruct a historically admissible fixture without calling NEW admission.
// Every original preview/release hash and lineage is computed and then verified
// by the production readers; no reader or runtime command is mocked.
async function historicalRelease(f: Awaited<ReturnType<typeof fixture>>) {
  const release = await createFixtureProductReleaseManifestV1({ runtimePackage: f.runtimePackage, productionKey: 'sfqa109-historical' })
  setDice(release.runtimePackage, '1d101')
  release.packageHash = await hashProductProductionValueV2(release.runtimePackage)
  const { releaseIdentityHash: _identity, lineage: oldLineage, ...body } = release
  release.releaseIdentityHash = await productReleaseIdentityHashV1(body)
  if (oldLineage.schema !== 'storyforge.product-release-lineage') throw new Error('Shared fixture lineage required')
  const { lineageHash: _lineageHash, ...lineageBody } = oldLineage
  const lineage = { ...lineageBody, releaseHash: release.releaseIdentityHash,
    releaseUid: productReleaseUidV1({ productType: release.productType, productInstanceKey: oldLineage.productInstanceKey,
      releaseVersion: oldLineage.releaseVersion, releaseHash: release.releaseIdentityHash }) }
  release.lineage = { ...lineage, lineageHash: await hashCanonicalValue(lineage) }
  await verifyProductReleaseManifestV1(release)
  const manifestJson = JSON.stringify(release), contentHash = await hashProductProductionValueV2(release)
  const releaseId = await db.productReleases.add({ ...f.scope, productionKey: release.productionProvenance.productionKey,
    productType: 'text-adventure', worldReleaseId: f.release.id!, version: 1, label: 'Historical unsupported random action',
    manifestJson, contentHash, createdAt: Date.now() }) as number
  return { release, releaseId, manifestJson, contentHash }
}

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => db.close())

describe('SFQA-109 new dice admission and immutable historical reads', () => {
  it('rejects unsupported dice before a new preview can be admitted, preserving the candidate', async () => {
    const f = await fixture()
    setDice(f.runtimePackage, '1d101')
    const raw = JSON.stringify(f.runtimePackage)
    expect(() => parseProductRuntimeDiceExpressionV1('1d101')).toThrow()
    await expect(createProductBuildPreviewManifestV1({ productionKey: 'sfqa109-new', buildNumber: 1,
      buildManifestHash: 'a'.repeat(64), runtimePackage: f.runtimePackage })).rejects.toThrow(/action.search.cache/)
    expect(JSON.stringify(f.runtimePackage)).toBe(raw)
  })

  it('keeps the full old Release readable and good actions usable, but labels its unsupported action unavailable', async () => {
    const f = await fixture(), old = await historicalRelease(f)
    const session = await createProductRuntimeInstanceFromSource({ scope: f.scope,
      source: { kind: 'release', productReleaseId: old.releaseId }, title: 'Read historical release', seed: 'sfqa109-old' })
    await commit(session.id!, 'action.look.harbor')
    const state = await readProductRuntimeState(session.id!)
    expect(state.adventure?.actionHistory.slice(-1)[0]?.actionKey).toBe('action.look.harbor')
    const before = await db.productRuntimeEvents.where('sessionId').equals(session.id!).toArray()
    await expect(commit(session.id!, RANDOM_ACTION)).rejects.toThrow()
    expect(await db.productRuntimeEvents.where('sessionId').equals(session.id!).toArray()).toEqual(before)
    expect(await db.productReleases.get(old.releaseId)).toMatchObject({ manifestJson: old.manifestJson, contentHash: old.contentHash })
    const actions = availableAdventureActions(old.release.runtimePackage.adventure!, state.adventure!)
    expect(actions.find(entry => entry.action.key === 'action.look.harbor')?.available).toBe(true)
    expect(actions.find(entry => entry.action.key === RANDOM_ACTION)).toMatchObject({ available: false, reason: expect.stringContaining(RANDOM_ACTION) })
  })

  it('does not let a verified historical package pass as a new Release', async () => {
    const f = await fixture(), old = await historicalRelease(f)
    await expect(verifyProductReleaseManifestV1(old.manifestJson)).resolves.toEqual(old.release)
    if (!('confirmedBrief' in old.release.sourceContracts) || old.release.lineage.schema !== 'storyforge.product-release-lineage') throw new Error('Shared source required')
    await expect(createProductReleaseManifestV1({ runtimePackage: old.release.runtimePackage,
      productionProvenance: old.release.productionProvenance, sourceContracts: old.release.sourceContracts,
      lineage: old.release.lineage })).rejects.toThrow(/action.search.cache/)
  })

  it('keeps an old Preview verifiable and rejects content tampering without rehashing it', async () => {
    const f = await fixture()
    const built = await seedCurrentProductBuild({ scope: f.scope, worldRelease: { ...f.release, id: f.release.id! },
      runtimePackage: f.runtimePackage, title: 'Preview source' })
    const old = structuredClone(built.preview)
    setDice(old.runtimePackage, '1d101')
    old.packageHash = await hashProductProductionValueV2(old.runtimePackage)
    old.previewHash = await hashProductProductionValueV2({ buildManifestHash: old.buildManifestHash, packageHash: old.packageHash,
      mediaBindings: old.mediaBindings, fallbackSummary: old.fallbackSummary })
    const raw = JSON.stringify(old)
    await expect(verifyProductBuildPreviewManifestV1(raw)).resolves.toEqual(old)
    const tampered = JSON.parse(raw) as typeof old
    setDice(tampered.runtimePackage, '1d100')
    await expect(verifyProductBuildPreviewManifestV1(tampered)).rejects.toThrow('packageHash')
    expect(JSON.stringify(old)).toBe(raw)
  })

  it.each(['0d2', '101d2', '1d1', '1d101', '1d2+10001', '1d2-10001', '999d9999+9999999', '1d20kh1', '1d0002'])(
    'uses the runtime parser to reject the unsupported expression %s', expression => {
      const content = createTextAdventureFoundationContentV2()
      const action = content.actions.find(action => action.key === RANDOM_ACTION)!
      if (action.rule.kind !== 'random') throw new Error('Random fixture missing')
      action.rule.expression = expression
      const raw = JSON.stringify(content)
      expect(() => parseProductRuntimeDiceExpressionV1(expression)).toThrow()
      expect(() => assertAdventureRuntimeDiceSupportV1(content)).toThrow(RANDOM_ACTION)
      expect(JSON.stringify(content)).toBe(raw)
    },
  )

  it.each(['1d2', '100d100', '1d2+10000', '1d2-10000', '001D020+00003'])(
    'admits %s and consumes it through the real preview and formal action', async expression => {
      const f = await fixture()
      setDice(f.runtimePackage, expression)
      const raw = JSON.stringify(f.runtimePackage)
      const expected = parseProductRuntimeDiceExpressionV1(expression)
      const built = await seedCurrentProductBuild({ scope: f.scope, worldRelease: { ...f.release, id: f.release.id! },
        runtimePackage: f.runtimePackage, title: 'Supported boundary', seed: 'sfqa109-boundary' })
      await commit(built.session.id!, RANDOM_ACTION)
      const state = await readProductRuntimeState(built.session.id!)
      const check = state.adventure!.checks.slice(-1)[0]!
      expect(check.expression).toBe(expected.normalized)
      expect(check.dice).toHaveLength(expected.count)
      expect(check.dice.every(die => die >= 1 && die <= expected.sides)).toBe(true)
      expect(JSON.stringify(f.runtimePackage)).toBe(raw)
      expect(built.preview.runtimePackage.adventure!.actions.find(action => action.key === RANDOM_ACTION)!.rule)
        .toMatchObject({ expression })
    },
  )

  it('revalidates the complete imported preview against independently rebuilt content without new admission', async () => {
    const f = await fixture()
    const preview = await createProductBuildPreviewManifestV1({ productionKey: 'sfqa109-import', buildNumber: 1,
      buildManifestHash: 'a'.repeat(64), runtimePackage: f.runtimePackage })
    setDice(preview.runtimePackage, '1d101')
    preview.packageHash = await hashProductProductionValueV2(preview.runtimePackage)
    preview.previewHash = await hashProductProductionValueV2({ buildManifestHash: preview.buildManifestHash,
      packageHash: preview.packageHash, mediaBindings: preview.mediaBindings, fallbackSummary: preview.fallbackSummary })
    const raw = JSON.stringify(preview)
    const input = { productionKey: preview.productionKey, buildNumber: preview.buildNumber,
      buildManifestHash: preview.buildManifestHash, runtimePackage: preview.runtimePackage,
      mediaBindings: preview.mediaBindings, fallbackSummary: preview.fallbackSummary }
    await expect(verifyRestoredProductBuildPreviewManifestV1(raw, input)).resolves.toEqual(preview)
    await expect(createProductBuildPreviewManifestV1(input)).rejects.toThrow(RANDOM_ACTION)
    const changedInputs: typeof input[] = [
      { ...input, productionKey: 'another-production' },
      { ...input, buildNumber: 2 },
      { ...input, buildManifestHash: 'b'.repeat(64) },
      { ...input, runtimePackage: { ...input.runtimePackage, definition: { ...input.runtimePackage.definition, title: 'Changed original' } } },
      { ...input, mediaBindings: [{ assetKey: 'forged', artifactKey: 'media.visual.001', blobContentHash: 'c'.repeat(64) }] },
      { ...input, fallbackSummary: ['changed fallback'] },
    ]
    for (const changed of changedInputs) {
      await expect(verifyRestoredProductBuildPreviewManifestV1(raw, changed)).rejects.toThrow('独立重建')
    }
    await expect(verifyRestoredProductBuildPreviewManifestV1({ ...preview, previewHash: '0'.repeat(64) }, input))
      .rejects.toThrow('previewHash')
    await expect(verifyRestoredProductBuildPreviewManifestV1({ ...preview, packageHash: '0'.repeat(64) }, input))
      .rejects.toThrow('packageHash')
    expect(JSON.stringify(preview)).toBe(raw)
  })

  it('preserves all historical release identity, source and lineage checks despite a restricted action', async () => {
    const f = await fixture(), old = await historicalRelease(f)
    await expect(verifyProductReleaseManifestV1({ ...old.release, releaseIdentityHash: '0'.repeat(64) })).rejects.toThrow()
    await expect(verifyProductReleaseManifestV1({ ...old.release, lineage: { ...old.release.lineage, lineageHash: '0'.repeat(64) } })).rejects.toThrow()
    await expect(verifyProductReleaseManifestV1({ ...old.release, sourceWorldRelease: { contentHash: '0'.repeat(64) } })).rejects.toThrow()
    await expect(verifyProductReleaseManifestV1({ ...old.release, packageHash: '0'.repeat(64) })).rejects.toThrow('packageHash')
    expect(await db.productReleases.get(old.releaseId)).toMatchObject({ manifestJson: old.manifestJson, contentHash: old.contentHash })
  })


  it('preserves legacy V1 reads while applying the same strict new admission', async () => {
    const f = await fixture()
    const legacy = parseAdventureContent({ ...f.runtimePackage.adventure!, version: 1 })
    f.runtimePackage.adventure = legacy
    setDice(f.runtimePackage, '101d2')
    const raw = JSON.stringify(legacy)
    const state = createInitialAdventureState(legacy, 'a'.repeat(64))
    expect(parseAdventureContent(legacy)).toEqual(legacy)
    const actions = availableAdventureActions(legacy, state)
    expect(actions.find(entry => entry.action.key === 'action.look.harbor')?.available).toBe(true)
    expect(actions.find(entry => entry.action.key === RANDOM_ACTION)?.available).toBe(false)
    await expect(createProductBuildPreviewManifestV1({ productionKey: 'sfqa109-v1', buildNumber: 1,
      buildManifestHash: 'a'.repeat(64), runtimePackage: f.runtimePackage })).rejects.toThrow(RANDOM_ACTION)
    expect(JSON.stringify(legacy)).toBe(raw)
  })

})
