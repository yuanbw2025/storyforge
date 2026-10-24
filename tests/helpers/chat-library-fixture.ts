import type {ChatExperienceInfoV1} from '../../src/lib/character-interaction/experience-info'
import {db} from '../../src/lib/db/schema'
import {hashProductProductionValueV2} from '../../src/lib/product-production/hash'
import {verifyProductBuildPreviewManifestV1} from '../../src/lib/product-production/preview-manifest'
import {createFixtureProductReleaseManifestV1} from './product-release-v1'
import {seedChatNarrativeRuntimeFixture} from './chat-narrative-fixture'

/** Synthetic five-contract release for player-entry engineering checks.
 * Not an author-approved production or a real-model narrative evaluation. */
export async function seedChatLibraryFixture(options: {secondOrdinaryScene?: boolean; experienceInfo?: ChatExperienceInfoV1; maxActionsPerTrigger?: number} = {}) {
  const f = await seedChatNarrativeRuntimeFixture({maxActionsPerTrigger: options.maxActionsPerTrigger})
  const session = (await db.productRuntimeSessions.get(f.sessionId))!
  const build = (await db.productBuilds.get(session.productBuildId!))!
  const preview = await verifyProductBuildPreviewManifestV1(build.previewManifestJson!)
  if (options.experienceInfo) preview.runtimePackage.interaction!.chatExperienceInfo = structuredClone(options.experienceInfo)
  if (options.secondOrdinaryScene) {
    delete preview.runtimePackage.interaction!.chatNarrative
    preview.runtimePackage.narrative.nodes[0].kind = 'ending'
    preview.runtimePackage.interaction!.sceneTemplates.push({...preview.runtimePackage.interaction!.sceneTemplates[0], sceneKey: 'courtyard', title: '雨后庭院', order: 1})
  }
  const manifest = await createFixtureProductReleaseManifestV1({runtimePackage: preview.runtimePackage, productionKey: 'chat.library.fixture'})
  const releaseId = await db.productReleases.add({...f.scope, productionKey: manifest.productionProvenance.productionKey,
    productType: 'character-interaction', worldReleaseId: null, version: 1, label: '驿站工程核验', manifestJson: JSON.stringify(manifest),
    contentHash: await hashProductProductionValueV2(manifest), createdAt: Date.now()}) as number
  return {...f, releaseId}
}
