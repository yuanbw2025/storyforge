import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {deleteWorkspace} from '../../src/lib/workspace/lifecycle'
import {readProductReleaseMediaBytes} from '../../src/lib/product-production/release-media'
import * as releaseMedia from '../../src/lib/product-production/release-media'
import {createBuildProductMediaResolver, createReleaseProductMediaResolver} from '../../src/lib/product-production/media-resolver'
import {putMediaBlobObject, sha256MediaData} from '../../src/lib/product-production/media-blob-store'
import {verifyProductBuildPreviewManifestV1} from '../../src/lib/product-production/preview-manifest'
import {parseProductRuntimePackageV1, verifyProductReleaseManifestV1} from '../../src/lib/product-production/runtime-package'
import {hashProductProductionValueV2} from '../../src/lib/product-production/hash'
import {createFixtureProductReleaseManifestV1} from '../helpers/product-release-v1'
import {seedChatNarrativeRuntimeFixture} from '../helpers/chat-narrative-fixture'
import {seedCurrentProductBuild} from '../helpers/current-product-build'
import type {FrozenRuntimeMediaAssetV2} from '../../src/lib/types'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close()})

/** Synthetic media fixtures exercise registered storage, not production art quality. */
async function library() {
  const f = await seedChatNarrativeRuntimeFixture(), session = (await db.productRuntimeSessions.get(f.sessionId))!
  const build = (await db.productBuilds.get(session.productBuildId!))!, original = await verifyProductBuildPreviewManifestV1(build.previewManifestJson!)
  const releases = []
  let parentRelease: {releaseUid: string; releaseHash: string} | null = null
  const pngs = ['iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC']
  for (const [index, png] of pngs.entries()) {
    const pkg = structuredClone(original.runtimePackage), data = Uint8Array.from(atob(png), c => c.charCodeAt(0)).buffer
    const hash = await sha256MediaData(data), asset: FrozenRuntimeMediaAssetV2 = {
      assetKey: 'guard.portrait', version: 1, kind: 'character-pose', name: '守卫工程图片', mimeType: 'image/png', byteSize: data.byteLength,
      width: 1, height: 1, durationMs: null, contentHash: hash, blobContentHash: hash, source: 'engineering-fixture', license: 'test-only',
      altText: '单色工程核验图', characterTag: pkg.interaction!.profiles[0].characterKey, sceneTag: '',
    }
    pkg.presentation = {version: 1, cues: [], assets: [asset]}; pkg.definition.enabledCapabilities.push('presentation')
    pkg.interaction!.chatMedia = {schema: 'storyforge.chat-media', version: 1,
      participants: [{participantKey: 'guard', avatarAssetKey: asset.assetKey, portraitAssetKey: asset.assetKey}], scenes: []}
    const runtimePackage = parseProductRuntimePackageV1(pkg)
    const manifest = await createFixtureProductReleaseManifestV1({runtimePackage, productionKey: 'chat.media.lifecycle', releaseVersion: index + 1, parentRelease})
    parentRelease = {releaseUid: manifest.lineage.releaseUid, releaseHash: manifest.lineage.releaseHash}
    const now = Date.now(), releaseId = await db.productReleases.add({...f.scope, productType: 'character-interaction', productionKey: 'chat.media.lifecycle',
      worldReleaseId: null, version: index + 1, label: `图片工程版本 ${index + 1}`, manifestJson: JSON.stringify(manifest), contentHash: await hashProductProductionValueV2(manifest), createdAt: now}) as number
    const blob = await putMediaBlobObject({scope: f.scope, data, mimeType: asset.mimeType, expectedContentHash: hash})
    const {blobContentHash: _blobHash, ...metadata} = asset
    const mediaAssetId = await db.productMediaAssets.add({...f.scope, ...metadata, ownerKind: 'release', productType: 'character-interaction',
      productReleaseId: releaseId, productRuntimeSessionId: null, createdAt: now, updatedAt: now}) as number
    await db.productMediaBlobs.add({...f.scope, mediaAssetId, blobObjectId: blob.id!, data: null, createdAt: now})
    releases.push({releaseId, asset, data, runtimePackage, mediaAssetId, blobId: blob.id!})
  }
  return {...f, releases}
}

it('keeps same-named assets isolated by release through export/import and original workspace deletion', async () => {
  const f = await library(), worlds = await db.worldReleases.where('projectId').equals(f.scope.projectId).toArray()
  const backup = await exportProjectJSON(f.scope.projectId), projectId = await importProjectJSON(backup)
  const restored = (await db.productReleases.where('projectId').equals(projectId).toArray()).sort((a, b) => a.version - b.version)
  expect(restored).toHaveLength(2)
  for (const [index, release] of restored.entries()) {
    const scope = {projectId, workId: release.workId, worldId: release.worldId}, manifest = await verifyProductReleaseManifestV1(release.manifestJson)
    expect(manifest.runtimePackage.interaction!.chatMedia).toEqual(f.releases[index].runtimePackage.interaction!.chatMedia)
    expect(await readProductReleaseMediaBytes({scope, productReleaseId: release.id!, asset: f.releases[index].asset})).toEqual(f.releases[index].data)
    await expect(readProductReleaseMediaBytes({scope, productReleaseId: release.id!, asset: f.releases[1 - index].asset})).rejects.toThrow('不匹配')
  }
  expect(await db.worldReleases.where('projectId').equals(f.scope.projectId).toArray()).toEqual(worlds)
  await deleteWorkspace(f.scope.projectId)
  expect(await db.productMediaAssets.where('projectId').equals(f.scope.projectId).count()).toBe(0)
  for (const [index, release] of restored.entries()) expect(await readProductReleaseMediaBytes({scope: {projectId, workId: release.workId, worldId: release.worldId}, productReleaseId: release.id!, asset: f.releases[index].asset})).toEqual(f.releases[index].data)
})

it('returns a bounded missing-media fallback and does not mutate story state or fetch another release', async () => {
  const f = await library(), [first, second] = f.releases, before = await db.productRuntimeSessions.get(f.sessionId)
  const resolver = await createReleaseProductMediaResolver({scope: f.scope, productReleaseId: first.releaseId, runtimePackage: first.runtimePackage})
  try {
    const tooSmall = await resolver.preload({assetKeys: [first.asset.assetKey], maximumBytes: 0})
    expect(tooSmall).toMatchObject({urls: {}, usedBytes: 0, failures: [{assetKey: first.asset.assetKey, reason: '预加载容量预算已满'}]})
    await db.productMediaBlobs.where('mediaAssetId').equals(first.mediaAssetId).delete()
    const missing = await resolver.preload({assetKeys: [first.asset.assetKey], maximumBytes: 1_000})
    expect(missing.urls).toEqual({}); expect(missing.failures[0].reason).toContain('二进制缺失')
    expect(await readProductReleaseMediaBytes({scope: f.scope, productReleaseId: second.releaseId, asset: second.asset})).toEqual(second.data)
    expect(await db.productRuntimeSessions.get(f.sessionId)).toEqual(before)
  } finally {resolver.dispose()}
})

it('does not create an orphan image URL when a view is disposed during an outstanding read', async () => {
  const f = await library(), first = f.releases[0]
  let finish!: (data: ArrayBuffer) => void
  vi.spyOn(releaseMedia, 'readProductReleaseMediaBytes').mockImplementation(() => new Promise(resolve => {finish = resolve}))
  const createObjectURL = vi.fn(() => 'blob:should-not-exist'), revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', class extends URL {static createObjectURL = createObjectURL; static revokeObjectURL = revokeObjectURL})
  const resolver = await createReleaseProductMediaResolver({scope: f.scope, productReleaseId: first.releaseId, runtimePackage: first.runtimePackage})
  const pending = resolver.preload({assetKeys: [first.asset.assetKey], maximumBytes: 1_000})
  resolver.dispose(); finish(first.data)
  const result = await pending
  expect(result.urls).toEqual({}); expect(result.failures[0].reason).toContain('已释放')
  expect(createObjectURL).not.toHaveBeenCalled(); expect(revokeObjectURL).not.toHaveBeenCalled()
})

it('reads Build images only from the exact accepted artifact and refuses a changed artifact binding', async () => {
  const f = await library(), first = f.releases[0], world = (await db.worldReleases.where('projectId').equals(f.scope.projectId).first())!
  const artifactKey = 'media.guard.portrait', built = await seedCurrentProductBuild({scope: f.scope, worldRelease: {...world, id: world.id!},
    runtimePackage: first.runtimePackage, title: '图片 Build 工程核验', mediaBindings: [{assetKey: first.asset.assetKey, artifactKey, blobContentHash: first.asset.contentHash}]})
  const now = Date.now(), artifactId = await db.productBuildArtifacts.add({...f.scope, buildId: built.buildId, artifactKey, requirementKey: null, version: 1,
    kind: 'image', mediaKind: 'character-pose', status: 'accepted', producerRunId: null, producerReceiptHash: null, controlEpoch: 0, inputHash: 'a'.repeat(64),
    contentHash: first.asset.contentHash, payloadJson: '{}', metadataJson: '{}', qualityJson: '{}', rightsJson: '{}', blobObjectId: first.blobId,
    mimeType: first.asset.mimeType, byteSize: first.asset.byteSize, parentArtifactHash: null, carriedFrom: null, createdAt: now, updatedAt: now}) as number
  const resolver = await createBuildProductMediaResolver({scope: f.scope, productBuildId: built.buildId, preview: built.preview})
  try {
    const blob = await resolver.read(first.asset.assetKey)
    expect(blob.size).toBe(first.data.byteLength); expect(blob.type).toBe(first.asset.mimeType)
    await db.productBuildArtifacts.update(artifactId, {contentHash: f.releases[1].asset.contentHash, blobObjectId: f.releases[1].blobId})
    await expect(resolver.read(first.asset.assetKey)).rejects.toThrow('不匹配')
  } finally {resolver.dispose()}
})
