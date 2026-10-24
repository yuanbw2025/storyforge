import type {ChatExperienceInfoV1} from '../../src/lib/character-interaction/experience-info'
import {db} from '../../src/lib/db/schema'
import {hashProductProductionValueV2} from '../../src/lib/product-production/hash'
import {putMediaBlobObject, sha256MediaData} from '../../src/lib/product-production/media-blob-store'
import {verifyProductReleaseManifestV1} from '../../src/lib/product-production/runtime-package'
import {createFixtureProductReleaseManifestV1} from './product-release-v1'
import {seedChatLibraryFixture} from './chat-library-fixture'
import {seedCurrentProductBuild} from './current-product-build'
import {createCurrentProductBriefFixture} from './current-runtime-package'
import {loadCurrentProductWorldSourceCatalogV1} from './current-product-world'
import type {FrozenRuntimeMediaAssetV2} from '../../src/lib/types'

/** Actual PNG bytes and strict release ownership; colored pixels are engineering
 * fixtures only, not artwork or evidence of visual production quality. */
export async function seedChatMediaPlayerFixture(options: {secondOrdinaryScene?: boolean; experienceInfo?: ChatExperienceInfoV1} = {}) {
  const f = await seedChatLibraryFixture(options), old = (await db.productReleases.get(f.releaseId))!
  const original = await verifyProductReleaseManifestV1(old.manifestJson), pkg = structuredClone(original.runtimePackage)
  const pngs = ['iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC']
  const bytes = pngs.map(png => Uint8Array.from(atob(png), c => c.charCodeAt(0)).buffer)
  const assets: FrozenRuntimeMediaAssetV2[] = []
  for (const [index, assetKey] of ['guard.portrait', 'artisan.portrait', 'inn.background'].entries()) {
    const data = bytes[index % 2], hash = await sha256MediaData(data), profile = pkg.interaction!.profiles[index]
    assets.push({assetKey, version: 1, kind: index === 2 ? 'background' : 'character-pose', name: index === 2 ? '驿站' : profile.name,
      mimeType: 'image/png', byteSize: data.byteLength, width: 1, height: 1, durationMs: null, contentHash: hash, blobContentHash: hash,
      source: 'engineering-fixture', license: 'test-only', altText: index === 2 ? '驿站工程背景' : `${profile.name}工程头像与立绘`, characterTag: index === 2 ? '' : profile.characterKey, sceneTag: index === 2 ? 'inn' : ''})
  }
  pkg.presentation = {version: 1, cues: [], assets}; pkg.definition.enabledCapabilities.push('presentation')
  pkg.interaction!.chatMedia = {schema: 'storyforge.chat-media', version: 1,
    participants: pkg.interaction!.profiles.map((p, i) => ({participantKey: p.participantKey, avatarAssetKey: assets[i].assetKey, portraitAssetKey: assets[i].assetKey})),
    scenes: [{sceneKey: 'inn', location: '驿站', backgroundAssetKey: 'inn.background'}]}
  const manifest = await createFixtureProductReleaseManifestV1({runtimePackage: pkg, productionKey: old.productionKey, releaseVersion: 2,
    parentRelease: {releaseUid: original.lineage.releaseUid, releaseHash: original.lineage.releaseHash}})
  const now = Date.now(), releaseId = await db.productReleases.add({...f.scope, productType: 'character-interaction', productionKey: old.productionKey,
    worldReleaseId: null, version: 2, label: '图片工程版本', manifestJson: JSON.stringify(manifest), contentHash: await hashProductProductionValueV2(manifest), createdAt: now}) as number
  const assetIds = []
  for (const [index, asset] of assets.entries()) {
    const blob = await putMediaBlobObject({scope: f.scope, data: bytes[index % 2], mimeType: asset.mimeType, expectedContentHash: asset.contentHash})
    const {blobContentHash: _blobHash, ...metadata} = asset
    const mediaAssetId = await db.productMediaAssets.add({...f.scope, ...metadata, ownerKind: 'release', productType: 'character-interaction',
      productReleaseId: releaseId, productRuntimeSessionId: null, createdAt: now, updatedAt: now}) as number
    await db.productMediaBlobs.add({...f.scope, mediaAssetId, blobObjectId: blob.id!, data: null, createdAt: now})
    assetIds.push(mediaAssetId)
  }
  return {...f, previousReleaseId: f.releaseId, releaseId, assetIds, runtimePackage: manifest.runtimePackage}
}

/** Accepted Build artifacts use the same content-addressed bytes as the
 * engineering Release fixture; no production/model acceptance is asserted. */
export async function seedChatMediaBuildFixture() {
  const f = await seedChatMediaPlayerFixture(), world = (await db.worldReleases.where('projectId').equals(f.scope.projectId).first())!
  const assets = f.runtimePackage.presentation!.assets
  const sourceCatalog = await loadCurrentProductWorldSourceCatalogV1({scope: f.scope, worldReleaseId: world.id!, productType: 'character-interaction'})
  const brief = createCurrentProductBriefFixture({productType: 'character-interaction', worldRelease: {...world, id: world.id!}, sourceCatalog})
  const built = await seedCurrentProductBuild({scope: f.scope, worldRelease: {...world, id: world.id!}, runtimePackage: f.runtimePackage, title: '图片素材工程核验', brief,
    mediaBindings: assets.map(asset => ({assetKey: asset.assetKey, artifactKey: asset.assetKey, blobContentHash: asset.blobContentHash}))})
  for (const [index, asset] of assets.entries()) {
    const blob = (await db.productMediaBlobs.where('mediaAssetId').equals(f.assetIds[index]).first())!, now = Date.now()
    await db.productBuildArtifacts.add({...f.scope, buildId: built.buildId, artifactKey: asset.assetKey, requirementKey: null, version: 1,
      kind: 'image', mediaKind: asset.kind, status: 'accepted', producerRunId: null, producerReceiptHash: null, controlEpoch: 0, inputHash: 'a'.repeat(64),
      contentHash: asset.contentHash, payloadJson: '{}', metadataJson: '{}', qualityJson: '{}', rightsJson: '{}', blobObjectId: blob.blobObjectId,
      mimeType: asset.mimeType, byteSize: asset.byteSize, parentArtifactHash: null, carriedFrom: null, createdAt: now, updatedAt: now})
  }
  return {...f, ...built}
}
