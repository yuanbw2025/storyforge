import type {ChatExperienceInfoV1} from '../../src/lib/character-interaction/experience-info'
import {exportProductDistributionBundleV2} from '../../src/lib/product-platform/distribution-bundle'
import {seedChatMediaPlayerFixture} from './chat-media-fixture'

/** Two related synthetic releases, including real PNG bytes; no model or
 * artwork acceptance. The receiving browser needs neither this fixture nor
 * the author's workspace after the JSON files have been exported. */
export async function seedChatExperiencePackageFixture(options: {secondOrdinaryScene?: boolean; experienceInfo?: ChatExperienceInfoV1} = {}) {
  const f = await seedChatMediaPlayerFixture(options)
  const original = await exportProductDistributionBundleV2({scope: f.scope, productReleaseId: f.previousReleaseId})
  const illustrated = await exportProductDistributionBundleV2({scope: f.scope, productReleaseId: f.releaseId})
  return {sourceScope: f.scope, original, illustrated}
}
