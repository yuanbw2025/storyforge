import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { deleteWork } from '../../src/lib/workspace/lifecycle'
import { assertProductReleaseUnchanged, parseAvgProductReleaseManifest } from '../../src/lib/product/releases'
import { createReleasedProductRuntimeSession, createPreviewProductRuntimeSession } from '../../src/lib/product/runtime-core'
import {
  parseProductRuntimePackage, parseProductRuntimePackageV1, parseProductRuntimePackageV2,
  parseProductReleaseManifest, parseProductReleaseManifestV1,
  verifyProductReleaseManifest,
} from '../../src/lib/product-production/runtime-package'
import {
  createProductBuildPreviewManifestV1,
  parseProductBuildPreviewManifest, verifyProductBuildPreviewManifest,
} from '../../src/lib/product-production/preview-manifest'
import { verifyProductRuntimeSourceEnvelope, verifyProductRuntimeSource } from '../../src/lib/product-production/preview-source'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { createFixtureProductReleaseManifestV1 } from '../helpers/product-release-v1'
import { fixture, legacyPackage, seedRelease, seedBuild } from '../helpers/avg-carrier-fixture'

const HASH = 'a'.repeat(64)

// Captured with the original e40fadce codecs before enabling V2 dispatch.
const V1_GOLDEN = {
  packageHash: '25f1af26a336fdc68b27f10b14fc80fbabcb5ebfba1197d4bd565438f66950fb',
  packageWireHash: '639ab1a2083f6eec75a85931906d9e696952c07835cb34d5b2fa0ce428b8473c',
  previewHash: '16a058503c965277dc0cfe44d371b55b967a2fb8f0923b3c00a957cd97f667c9',
  previewWireHash: '5b6e74c10d1cb55172b3344b371c92adc5b5e1b7f1cb386b99e0b73bba075a4a',
  releaseContentHash: 'bef3f03f85a3e7dd094bdf348409a5ebe0af036712d33dfae04b01865e6f6b45',
  releaseWireHash: '4e1d638ee3f7b5d719547e849577d3736908e1f81df048fef38daf8d4d098c78',
}

async function wireHash(value: unknown): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))
  return [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('')
}

describe('AVG-BASE-00A · strict versioned carriers, not a runnable V2 game', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('preserves V1 package and preview wire values through the new dispatcher', async () => {
    const raw = legacyPackage()
    expect(JSON.stringify(parseProductRuntimePackage(raw))).toBe(JSON.stringify(parseProductRuntimePackageV1(raw)))
    const legacy = await createFixtureProductReleaseManifestV1({ runtimePackage: raw })
    expect(parseProductReleaseManifest(legacy)).toEqual(parseProductReleaseManifestV1(legacy))
    expect(await verifyProductReleaseManifest(JSON.stringify(legacy))).toEqual(legacy)
    const preview = await createProductBuildPreviewManifestV1({ productionKey: 'fixture.product', buildNumber: 1,
      buildManifestHash: HASH, runtimePackage: parseProductRuntimePackageV1(raw) })
    expect(await verifyProductBuildPreviewManifest(JSON.stringify(preview))).toEqual(preview)
    expect(parseProductBuildPreviewManifest(preview)).toEqual(preview)
    expect(await hashProductProductionValueV2(parseProductRuntimePackage(raw))).toBe(V1_GOLDEN.packageHash)
    expect(await wireHash(parseProductRuntimePackage(raw))).toBe(V1_GOLDEN.packageWireHash)
    expect(preview.previewHash).toBe(V1_GOLDEN.previewHash)
    expect(await wireHash(parseProductBuildPreviewManifest(preview))).toBe(V1_GOLDEN.previewWireHash)
    expect(await hashProductProductionValueV2(parseProductReleaseManifest(legacy))).toBe(V1_GOLDEN.releaseContentHash)
    expect(await wireHash(parseProductReleaseManifest(legacy))).toBe(V1_GOLDEN.releaseWireHash)
  })

  it('round-trips V2 package, preview and source-bound release without rewriting their version', async () => {
    const f = await fixture()
    expect(parseProductRuntimePackage(JSON.stringify(f.runtimePackage))).toEqual(f.runtimePackage)
    expect(await verifyProductBuildPreviewManifest(f.preview)).toEqual(f.preview)
    expect(await verifyProductReleaseManifest(f.release)).toEqual(f.release)
    expect(f.release.packageHash).toBe(f.preview.packageHash)
    expect(f.release.lineage.releaseHash).toBe(f.release.releaseIdentityHash)
  })

  it.each([0, 3, '2', null])('rejects unsupported protocol version %s, rather than trying V1', async version => {
    const f = await fixture()
    expect(() => parseProductRuntimePackage({ ...f.runtimePackage, version })).toThrow(/schema\/version/)
    await expect(verifyProductBuildPreviewManifest({ ...f.preview, version })).rejects.toThrow(/schema\/version/)
    await expect(verifyProductReleaseManifest({ ...f.release, version })).rejects.toThrow(/schema\/version/)
  })

  it('rejects unregistered modules, capabilities, bindings and non-AVG V2 identities', async () => {
    const f = await fixture()
    expect(() => parseProductRuntimePackageV2({ ...f.runtimePackage, modules: [{ schema: 'unknown', version: 1 }] })).toThrow(/未登记模块/)
    expect(() => parseProductRuntimePackageV2({ ...f.runtimePackage,
      definition: { ...f.runtimePackage.definition, enabledCapabilities: ['narrative', 'inventory'] } })).toThrow(/未登记能力/)
    expect(() => parseProductRuntimePackageV2({ ...f.runtimePackage, productType: 'ai-town' })).toThrow(/AVG/)
    expect(() => parseProductBuildPreviewManifest({ ...f.preview, mediaBindings: [{ consumer: 'inventory' }] })).toThrow(/未登记媒资绑定/)
    expect(() => parseProductRuntimePackageV2({ ...f.runtimePackage, workId: 123 })).toThrow(/字段不符合合同/)
  })

  it('rejects mixed nested versions instead of normalizing an outer V2 to V1', async () => {
    const f = await fixture()
    expect(() => parseProductReleaseManifest({ ...f.release, runtimePackage: f.legacy.runtimePackage })).toThrow()
    expect(() => parseProductReleaseManifest({ ...f.legacy, runtimePackage: f.runtimePackage })).toThrow()
    expect(() => parseProductBuildPreviewManifest({ ...f.preview, runtimePackage: f.legacy.runtimePackage })).toThrow()
    expect(() => parseProductRuntimePackageV1(f.runtimePackage)).toThrow()
  })

  it('authenticates the V2 preview coordinates and raw package, not just its content subset', async () => {
    const f = await fixture()
    await expect(verifyProductBuildPreviewManifest({ ...f.preview, buildNumber: 2 })).rejects.toThrow(/previewHash/)
    await expect(verifyProductBuildPreviewManifest({ ...f.preview, productionKey: 'another.production' })).rejects.toThrow(/previewHash/)
    await expect(verifyProductBuildPreviewManifest({ ...f.preview,
      runtimePackage: { ...f.runtimePackage, definition: { ...f.runtimePackage.definition, title: 'Changed' } } })).rejects.toThrow(/packageHash/)
    await expect(verifyProductReleaseManifest({ ...f.release, releaseIdentityHash: HASH })).rejects.toThrow(/identity|lineage/)
    await expect(verifyProductReleaseManifest({ ...f.release,
      sourceContracts: { ...f.release.sourceContracts, sourcePlan: { ...f.release.sourceContracts.sourcePlan, planHash: HASH } } })).rejects.toThrow()
  })

  it('verifies release ownership/hash while keeping V2 runtime admission closed', async () => {
    const s = await seedRelease()
    expect((await assertProductReleaseUnchanged(s.id)).id).toBe(s.id)
    const source = { kind: 'release' as const, productReleaseId: s.id }
    expect((await verifyProductRuntimeSourceEnvelope({ scope: s.scope, source })).runtimePackage.version).toBe(2)
    await expect(verifyProductRuntimeSource({ scope: s.scope, source })).rejects.toThrow(/未登记可玩模块/)
    expect(() => parseAvgProductReleaseManifest(JSON.stringify(s.release))).toThrow(/不能启动运行/)
    await expect(createReleasedProductRuntimeSession({ ...s.scope, productReleaseId: s.id,
      origin: 'release', kind: 'avg', title: 'Must not start' })).rejects.toThrow(/未登记可玩模块/)
    expect(await db.productRuntimeSessions.count()).toBe(0)
    const another = await createWorkspace({ name: 'Another owner', genres: [], status: 'drafting', description: '',
      targetWordCount: 1, enableMultiWorld: false }, { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
    await expect(verifyProductRuntimeSourceEnvelope({ scope: another.scope, source })).rejects.toThrow(/不属于当前 Work/)
  })

  it('round-trips a self-contained V2 release through the registry and deletes only its imported Work', async () => {
    const s = await seedRelease()
    const snapshot = await exportProjectJSON(s.scope.projectId)
    const importedId = await importProjectJSON(snapshot)
    const imported = await db.productReleases.where('projectId').equals(importedId).first()
    expect(imported?.id).not.toBe(s.id)
    expect(imported?.manifestJson).toBe(canonicalProductProductionJsonV2(s.release))
    expect(imported?.contentHash).toBe(await hashProductProductionValueV2(s.release))
    expect(imported?.worldReleaseId).toBeNull()
    await assertProductReleaseUnchanged(imported!.id!)
    await deleteWork(imported!.workId)
    expect(await db.productReleases.get(imported!.id!)).toBeUndefined()
    expect(await db.productReleases.get(s.id)).toBeDefined()
  })

  it('pins a V2 Build preview to its owner, hashes and Brief without admitting a runtime session', async () => {
    const s = await seedBuild()
    const source = { kind: 'build' as const, productBuildId: s.buildId, expectedPreviewHash: s.preview.previewHash }
    expect((await verifyProductRuntimeSourceEnvelope({ scope: s.scope, source })).runtimePackage).toEqual(s.runtimePackage)
    await expect(verifyProductRuntimeSourceEnvelope({ scope: s.scope,
      source: { ...source, expectedPreviewHash: HASH } })).rejects.toThrow(/指针或 hash/)
    await expect(createPreviewProductRuntimeSession({ ...s.scope, ...source, runtimeSourceHash: s.preview.packageHash,
      origin: 'preview', kind: 'avg', title: 'Must not start' })).rejects.toThrow(/未登记可玩模块/)
    expect(await db.productRuntimeSessions.count()).toBe(0)
    const another = await createWorkspace({ name: 'Other Build owner', genres: [], status: 'drafting',
      description: '', targetWordCount: 1, enableMultiWorld: false },
    { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
    await expect(verifyProductRuntimeSourceEnvelope({ scope: another.scope, source })).rejects.toThrow(/跨 Work/)
    await db.productBuilds.update(s.buildId, { previewManifestJson: JSON.stringify({ ...s.preview, version: 3 }) })
    await expect(exportProjectJSON(s.scope.projectId)).rejects.toThrow(/ProductBuild Preview/)
  })

  it('preserves nested V2 Build bytes and pointer hashes through export/import and rejects tampered previews atomically', async () => {
    const s = await seedBuild()
    const snapshot = await exportProjectJSON(s.scope.projectId)
    const importedId = await importProjectJSON(snapshot)
    const build = await db.productBuilds.where('projectId').equals(importedId).first()
    expect(build?.id).not.toBe(s.buildId)
    expect(build?.previewManifestJson).toBe(canonicalProductProductionJsonV2(s.preview))
    const source = { kind: 'build' as const, productBuildId: build!.id!, expectedPreviewHash: s.preview.previewHash }
    expect((await verifyProductRuntimeSourceEnvelope({ scope: build!, source })).runtimePackage).toEqual(s.runtimePackage)
    const forged = structuredClone(snapshot)
    forged.productBuilds![0].previewManifestJson = JSON.stringify({ ...s.preview, version: 3 })
    const count = await db.projects.count()
    await expect(importProjectJSON(forged)).rejects.toThrow(/ProductBuild Preview/)
    expect(await db.projects.count()).toBe(count)
    forged.productBuilds![0].previewManifestJson = JSON.stringify({ ...s.preview, buildNumber: 2 })
    await expect(importProjectJSON(forged)).rejects.toThrow(/ProductBuild Preview/)
    expect(await db.projects.count()).toBe(count)
    await deleteWork(build!.workId)
    expect(await db.productBuilds.get(build!.id!)).toBeUndefined()
    expect(await db.productBuilds.get(s.buildId)).toBeDefined()
  })

  it.each(['release', 'build'] as const)('rejects forged %s-bound V2 sessions in both backup directions', async kind => {
    const s = await seedBuild()
    const snapshot = await exportProjectJSON(s.scope.projectId)
    const base = { worldGroupId: null, runtimeSourceHash: s.preview.packageHash, kind: 'avg' as const,
      title: 'Forged session', status: 'active' as const, rulesetVersion: 1, seed: 'fixture',
      canonSnapshotJson: '{}', initialStateJson: '{}', runtimeHeadSequence: 0,
      runtimeHeadStateJson: '{}', runtimeHeadStateHash: HASH, parentSessionId: null,
      parentThroughSequence: null, createdAt: 1, updatedAt: 1 }
    snapshot.productRuntimeSessions = [{ ...base, _exportId: 0,
      _worldExportId: snapshot.productBuilds![0]._worldExportId,
      _workExportId: snapshot.productBuilds![0]._workExportId,
      _productReleaseExportId: kind === 'release' ? snapshot.productReleases![0]._exportId : null,
      _productBuildExportId: kind === 'build' ? snapshot.productBuilds![0]._exportId : null,
      _parentSessionExportId: null }]
    const count = await db.projects.count()
    await expect(importProjectJSON(snapshot)).rejects.toThrow(/V2 未登记可玩模块/)
    expect(await db.projects.count()).toBe(count)
    await db.productRuntimeSessions.add({ ...s.scope, ...base,
      productReleaseId: kind === 'release' ? s.id : null,
      productBuildId: kind === 'build' ? s.buildId : null } as never)
    await expect(exportProjectJSON(s.scope.projectId)).rejects.toThrow(/V2 未登记可玩模块/)
  })

  it.each(['{}', '{"version":1}'])('preserves the opaque legacy Preview placeholder %s without treating it as playable', async placeholder => {
    const s = await seedBuild()
    await db.productBuilds.update(s.buildId, { previewManifestJson: placeholder })
    const snapshot = await exportProjectJSON(s.scope.projectId)
    const importedId = await importProjectJSON(snapshot)
    const build = await db.productBuilds.where('projectId').equals(importedId).first()
    expect(build?.previewManifestJson).toBe(placeholder)
    expect(build?.previewHash).toBe(s.preview.previewHash)
    await expect(verifyProductRuntimeSourceEnvelope({ scope: build!, source: { kind: 'build',
      productBuildId: build!.id!, expectedPreviewHash: build!.previewHash } })).rejects.toThrow()
    expect(await db.productRuntimeSessions.count()).toBe(0)
  })

  it('rejects a tampered V2 snapshot before writing a new project', async () => {
    const s = await seedRelease()
    const snapshot = await exportProjectJSON(s.scope.projectId)
    const target = snapshot.productReleases!.find(row => row.productType === 'avg')!
    const forged = JSON.parse(target.manifestJson)
    forged.runtimePackage.modules = [{ schema: 'unknown', version: 1 }]
    target.manifestJson = JSON.stringify(forged)
    const before = await db.projects.count()
    await expect(importProjectJSON(snapshot)).rejects.toThrow(/ProductRelease/)
    expect(await db.projects.count()).toBe(before)
    expect(await db.productReleases.get(s.id)).toBeDefined()
  })
})
